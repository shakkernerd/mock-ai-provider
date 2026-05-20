#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const version = process.argv[2];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (!version || process.argv.length !== 3) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!isSemverLike(version)) {
    throw new Error("version must look like 1.2.3 or 1.2.3-beta.1");
  }

  const packagePath = join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const currentVersion = packageJson.version;
  if (!currentVersion) {
    throw new Error("could not read package version from package.json");
  }
  if (currentVersion === version) {
    console.log(`mock-ai-provider is already on ${version}`);
    return;
  }

  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await run("pnpm", ["install", "--lockfile-only"]);
  console.log(`Updated mock-ai-provider version: ${currentVersion} -> ${version}`);
}

function isSemverLike(value) {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(value);
}

async function run(command, args) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 0));
  });
  if (result !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result}`);
  }
}

function printHelp() {
  console.log(`Update the mock-ai-provider package version safely.

Usage:
  node scripts/update-version.mjs <version>

Examples:
  node scripts/update-version.mjs 1.2.3
  node scripts/update-version.mjs 1.0.0-beta.1
`);
}
