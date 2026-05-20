#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.version) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!isSemverLike(options.version)) {
    throw new Error("version must look like 1.2.3 or 1.2.3-beta.1");
  }

  const version = options.version;
  const remote = options.remote;
  const tag = `v${version}`;
  const releaseCommitMessage = `chore: bump version to ${version}`;

  const branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true })).stdout.trim();
  if (branch !== "main") {
    throw new Error(`releases must be prepared from the main branch (current: ${branch || "detached"})`);
  }
  await git(["remote", "get-url", remote]);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageName = packageJson.name;
  const currentVersion = packageJson.version;
  if (!packageName || !currentVersion) {
    throw new Error("package.json must include name and version");
  }

  const dirtyFiles = await trackedDirtyFiles();
  const headSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const headSubject = (await git(["log", "-1", "--pretty=%s"])).stdout.trim();
  const headIsReleaseCommit = headSubject === releaseCommitMessage;
  let localTagSha = await refCommit(tag);
  let remoteTagSha = await remoteTagCommit(remote, tag);
  let remoteMainSha = await remoteRefCommit(remote, "refs/heads/main");

  if (localTagSha && localTagSha !== headSha) {
    throw new Error(`local tag ${tag} already exists and does not point at HEAD`);
  }
  if (remoteTagSha && remoteTagSha !== headSha) {
    throw new Error(`remote tag ${tag} already exists on ${remote} and does not point at HEAD`);
  }

  let needUpdateVersion = false;
  let needChecks = false;
  let needCommit = false;

  log(`Preparing release ${tag} from branch ${branch} using remote ${remote}`);

  if (currentVersion === version) {
    if (dirtyFiles.length > 0) {
      if (!onlyVersionFilesDirty(dirtyFiles)) {
        throw new Error("tracked changes are present; commit or stash them before running release prep");
      }
      if (headIsReleaseCommit || localTagSha || remoteTagSha) {
        throw new Error(`version files are dirty for ${version}, but a release commit or tag already exists`);
      }
      log(`resume state: version files already updated to ${version}`);
      needChecks = true;
      needCommit = true;
    } else {
      if (!headIsReleaseCommit) {
        throw new Error(`${packageName} is already on ${version}, but HEAD is not the expected release commit`);
      }
      log(`resume state: release commit already exists at ${headSha.slice(0, 7)}`);
      if (localTagSha) log(`resume state: local tag ${tag} already exists`);
      if (remoteTagSha) log(`resume state: remote tag ${tag} already exists on ${remote}`);
      if (remoteMainSha === headSha) log(`resume state: main is already pushed to ${remote}`);
    }
  } else {
    if (dirtyFiles.length > 0) {
      throw new Error("tracked changes are present; commit or stash them before running release prep");
    }
    if (localTagSha || remoteTagSha) {
      throw new Error(`release tag ${tag} already exists, but package.json is still on ${currentVersion}`);
    }
    needUpdateVersion = true;
    needChecks = true;
    needCommit = true;
  }

  if (options.skipChecks) {
    log("Local checks are skipped");
    needChecks = false;
  } else if (needChecks) {
    log("Local checks are enabled");
  } else {
    log("skip: local checks already passed before this resume point");
  }

  if (needUpdateVersion) {
    await runStep(`Updating version files to ${version}`, "node", ["scripts/update-version.mjs", version]);
  } else {
    log(`skip: version files are already set to ${version}`);
  }

  if (needChecks) {
    await runStep("Running package verification", "pnpm", ["run", "package:check", "--", "--allow-dirty"]);
  }

  if (needCommit) {
    await runStep("Staging version files", "git", ["add", "package.json", "pnpm-lock.yaml"]);
    const staged = await git(["diff", "--cached", "--name-only", "--", "package.json", "pnpm-lock.yaml"]);
    if (!staged.stdout.trim()) {
      throw new Error(`no staged version changes remain for ${version}; cannot create the release commit`);
    }
    await runStep("Creating release commit", "git", ["commit", "-m", releaseCommitMessage]);
  } else {
    log("skip: release commit already exists");
  }

  const newHeadSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  if (!localTagSha && remoteTagSha) {
    await runStep(`Fetching existing tag ${tag} from ${remote}`, "git", [
      "fetch",
      remote,
      `refs/tags/${tag}:refs/tags/${tag}`
    ]);
    localTagSha = await refCommit(tag);
  }

  if (!localTagSha) {
    log(`Creating signed tag ${tag}; git signing may prompt here`);
    await git(["-c", "tag.gpgSign=true", "tag", "-a", tag, "-m", tag]);
    if (!(await tagHasSignature(tag))) {
      await git(["tag", "-d", tag], { allowFailure: true });
      throw new Error(`created tag ${tag} was not signed; configure git tag signing before retrying`);
    }
    log(`done: Creating signed tag ${tag}`);
  } else {
    log(`skip: local tag ${tag} already exists`);
  }

  remoteMainSha = await remoteRefCommit(remote, "refs/heads/main");
  remoteTagSha = await remoteTagCommit(remote, tag);
  const pushTargets = [];
  if (remoteMainSha !== newHeadSha) pushTargets.push("main");
  if (remoteTagSha !== newHeadSha) pushTargets.push(tag);
  if (pushTargets.length > 0) {
    await runStep(`Pushing ${pushTargets.join(" ")} to ${remote}`, "git", ["push", remote, ...pushTargets]);
  } else {
    log(`skip: main and ${tag} are already pushed to ${remote}`);
  }

  console.log(`Release prep complete for ${tag}.

Next:
  1. Open GitHub Releases
  2. Create or publish the release ${tag} from the existing tag
  3. The release workflow will publish the npm package

Optional GitHub CLI:
  gh release create ${tag} --title ${tag} --generate-notes
`);
}

function parseArgs(args) {
  const parsed = { remote: "origin", skipChecks: false, help: false, version: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "--skip-checks") {
      parsed.skipChecks = true;
    } else if (arg === "--remote") {
      index += 1;
      if (!args[index]) throw new Error("--remote requires a value");
      parsed.remote = args[index];
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown argument: ${arg}`);
    } else if (parsed.version) {
      throw new Error(`version was already provided: ${parsed.version}`);
    } else {
      parsed.version = arg;
    }
  }
  return parsed;
}

function isSemverLike(value) {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(value);
}

async function trackedDirtyFiles() {
  const unstaged = await git(["diff", "--name-only", "--ignore-submodules", "--"]);
  const staged = await git(["diff", "--cached", "--name-only", "--ignore-submodules", "--"]);
  return [...new Set(`${unstaged.stdout}\n${staged.stdout}`.split("\n").filter(Boolean))].sort();
}

function onlyVersionFilesDirty(files) {
  return files.length > 0 && files.every((file) => file === "package.json" || file === "pnpm-lock.yaml");
}

async function refCommit(ref) {
  const result = await git(["rev-list", "-n1", ref], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function remoteRefCommit(remote, ref) {
  const result = await git(["ls-remote", remote, ref], { allowFailure: true });
  return result.stdout.trim().split(/\s+/)[0] ?? "";
}

async function remoteTagCommit(remote, tag) {
  const result = await git(["ls-remote", remote, `refs/tags/${tag}^{}`, `refs/tags/${tag}`], { allowFailure: true });
  let first = "";
  for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    if (!first) first = sha;
    if (ref?.endsWith("^{}")) return sha;
  }
  return first;
}

async function tagHasSignature(tag) {
  const result = await git(["cat-file", "-p", tag]);
  return /-----BEGIN (?:PGP|SSH) SIGNATURE-----/.test(result.stdout);
}

async function runStep(description, command, args) {
  const startedAt = Date.now();
  log(description);
  await run(command, args);
  log(`done: ${description} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
}

async function git(args, options = {}) {
  return run("git", args, { ...options, capture: true });
}

async function run(command, args, options = {}) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
  if (result.code !== 0 && !options.allowFailure) {
    const output = result.stderr || result.stdout;
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}${output ? `\n${output}` : ""}`);
  }
  return result;
}

function log(message) {
  const time = new Date().toTimeString().slice(0, 8);
  console.error(`[${time}] ${message}`);
}

function printHelp() {
  console.log(`Prepare or resume a signed mock-ai-provider release from the current main branch.

Usage:
  pnpm run release -- <version> [--remote <name>] [--skip-checks]

Examples:
  pnpm run release -- 0.2.0
  pnpm run release -- 1.0.0-beta.1 --remote upstream
`);
}
