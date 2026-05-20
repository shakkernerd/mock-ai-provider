#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const allowDirty = args.has("--allow-dirty");
const skipVersionCheck = args.has("--skip-version-check");

const requiredPackFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/cli.js",
  "media/default-image.png",
  "media/default-video.mp4",
  "media/hero.svg"
];

const forbiddenPackPrefixes = [
  ".artifacts/",
  "src/",
  "test/",
  "node_modules/",
  ".mock-ai-provider/"
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageName = packageJson.name;
  const version = packageJson.version;
  if (!packageName || !version) {
    throw new Error("package.json must include name and version");
  }

  log(`package check for ${packageName}@${version}`);
  await ensureCleanGitTree();
  if (skipVersionCheck) {
    log("npm version availability check skipped because --skip-version-check was provided");
  } else {
    await ensureVersionNotPublished(packageName, version);
  }
  await run("pnpm", ["run", "check"]);

  const packDir = await mkdtemp(join(tmpdir(), "mock-ai-provider-release-"));
  try {
    const pack = await npmPack(packDir);
    inspectPack(pack);
    await smokeInstalledPackage(pack.filename, version);

    log("package check passed");
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
}

async function ensureCleanGitTree() {
  if (allowDirty) {
    log("git cleanliness skipped because --allow-dirty was provided");
    return;
  }
  const status = await run("git", ["status", "--short"], { capture: true });
  if (status.stdout.trim()) {
    throw new Error(`release requires a clean git tree:\n${status.stdout}`);
  }
}

async function ensureVersionNotPublished(packageName, version) {
  const result = await run("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
    capture: true,
    allowFailure: true
  });
  if (result.code === 0 && result.stdout.trim()) {
    throw new Error(`${packageName}@${version} is already published on npm`);
  }
  if (result.code !== 0 && !/E404|404 Not Found|No match found/.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`could not verify npm version availability:\n${result.stderr || result.stdout}`);
  }
  log(`${packageName}@${version} is available on npm`);
}

async function npmPack(packDir) {
  const result = await run("npm", ["pack", "--json", "--pack-destination", packDir], { capture: true });
  const parsed = JSON.parse(result.stdout);
  const pack = parsed[0];
  if (!pack?.filename || !Array.isArray(pack.files)) {
    throw new Error("npm pack did not return the expected JSON shape");
  }
  log(`packed ${pack.filename} (${pack.entryCount} files, ${pack.size} bytes)`);
  return {
    ...pack,
    filename: join(packDir, pack.filename)
  };
}

function inspectPack(pack) {
  const files = pack.files.map((file) => file.path);
  const missing = requiredPackFiles.filter((file) => !files.includes(file));
  if (missing.length) {
    throw new Error(`packed tarball is missing required files: ${missing.join(", ")}`);
  }

  const forbidden = files.filter((file) => forbiddenPackPrefixes.some((prefix) => file.startsWith(prefix)));
  if (forbidden.length) {
    throw new Error(`packed tarball includes forbidden files: ${forbidden.join(", ")}`);
  }

  log("packed tarball file list is clean");
}

async function smokeInstalledPackage(tarball, expectedVersion) {
  const smokeDir = await mkdtemp(join(tmpdir(), "mock-ai-provider-smoke-"));
  try {
    await run("npm", ["init", "-y"], { cwd: smokeDir, quiet: true });
    await run("npm", ["install", tarball], { cwd: smokeDir, quiet: true });

    const bin = join(smokeDir, "node_modules", ".bin", "mock-ai-provider");
    const version = await run(bin, ["--version"], { cwd: smokeDir, capture: true });
    if (version.stdout.trim() !== expectedVersion) {
      throw new Error(`installed CLI version mismatch: expected ${expectedVersion}, got ${version.stdout.trim()}`);
    }

    await smokeServer(bin, smokeDir);
    log("installed tarball smoke passed");
  } finally {
    await rm(smokeDir, { recursive: true, force: true });
  }
}

async function smokeServer(bin, cwd) {
  const requestLog = join(cwd, "requests.jsonl");
  const child = spawn(bin, ["serve", "--providers", "openai", "--port", "0", "--request-log", requestLog], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const startup = await waitForStartup(() => stdout, () => stderr);
    const models = await fetch(`${startup.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer release-secret" }
    });
    if (models.status !== 200) {
      throw new Error(`/v1/models smoke failed with ${models.status}`);
    }

    const chat = await fetch(`${startup.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer release-secret",
        "content-type": "application/json",
        "x-client-request-id": "release-smoke"
      },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }],
        metadata: {
          apiKey: "sk-release",
          access_token: "oauth-release"
        }
      })
    });
    const body = await chat.json();
    if (chat.status !== 200 || body.choices?.[0]?.message?.content !== "Hello from mock AI provider") {
      throw new Error(`/v1/chat/completions smoke failed: ${JSON.stringify(body)}`);
    }

    child.kill("SIGTERM");
    await waitForExit(child);

    const rows = (await readFile(requestLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const chatRow = rows.find((row) => row.path === "/v1/chat/completions");
    if (!chatRow) {
      throw new Error("request journal did not capture chat request");
    }
    const serialized = JSON.stringify(chatRow);
    if (serialized.includes("release-secret") || serialized.includes("sk-release") || serialized.includes("oauth-release")) {
      throw new Error("request journal leaked a secret during smoke");
    }
    if (chatRow.requestHeaders?.authorization !== "present") {
      throw new Error("request journal did not preserve auth presence summary");
    }
  } finally {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child).catch(() => {});
    }
  }
}

async function waitForStartup(readStdout, readStderr) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const line = readStdout().split("\n").find(Boolean);
    if (line) {
      return JSON.parse(line);
    }
    await sleep(25);
  }
  throw new Error(`server did not start:\n${readStderr()}`);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(command, commandArgs, options = {}) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? root,
      stdio: options.capture || options.quiet ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!options.capture && !options.quiet) {
          process.stdout.write(chunk);
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (!options.capture && !options.quiet) {
          process.stderr.write(chunk);
        }
      });
    }
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });

  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.code}`);
  }
  return result;
}

function log(message) {
  console.log(`[package-check] ${message}`);
}

function printHelp() {
  console.log(`Usage:
  pnpm run package:check

Options:
  --allow-dirty             allow a dirty git tree, useful while testing this script
  --skip-version-check      skip npm version availability check, useful for CI after release
`);
}
