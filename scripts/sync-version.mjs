#!/usr/bin/env node
// Sync the app version across package.json files, tauri.conf.json, and Cargo.toml.
// Single source of truth for what version the Tauri build will report.
//
// Usage:
//   node scripts/sync-version.mjs <version>          # write <version>
//   node scripts/sync-version.mjs --from-package     # read from packages/app/package.json
//   node scripts/sync-version.mjs --preview <sha>    # append -preview.<sha7> to package version

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const TARGETS = {
  rootPackage: resolve(repoRoot, "package.json"),
  appPackage: resolve(repoRoot, "packages/app/package.json"),
  tauriConf: resolve(repoRoot, "packages/app/src-tauri/tauri.conf.json"),
  tauriCargo: resolve(repoRoot, "packages/app/src-tauri/Cargo.toml"),
};

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

async function updateJsonVersion(path, version) {
  const data = await readJson(path);
  if (data.version === version) return false;
  data.version = version;
  await writeJson(path, data);
  return true;
}

async function updateCargoVersion(path, version) {
  const original = await readFile(path, "utf8");
  // Only the first [package] version — workspace tables would use different headers.
  const pattern = /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
  const match = original.match(pattern);
  if (!match) {
    throw new Error(`Failed to find [package] version in ${path}`);
  }
  if (match[2] === version) return false;
  const updated = original.replace(pattern, `$1${version}$3`);
  await writeFile(path, updated);
  return true;
}

function parseArgs(argv) {
  if (argv.length === 0) {
    throw new Error("Missing argument. See file header for usage.");
  }
  if (argv[0] === "--from-package") {
    return { mode: "explicit", needRead: true };
  }
  if (argv[0] === "--preview") {
    if (!argv[1]) throw new Error("--preview requires a sha argument");
    return { mode: "preview", sha: argv[1] };
  }
  return { mode: "explicit", version: argv[0] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let version;
  if (args.mode === "preview") {
    const base = (await readJson(TARGETS.appPackage)).version.replace(
      /-.*$/,
      "",
    );
    const sha = args.sha.slice(0, 7);
    version = `${base}-preview.${sha}`;
  } else if (args.needRead) {
    version = (await readJson(TARGETS.appPackage)).version;
  } else {
    version = args.version;
  }

  // Validate. Tauri requires SemVer; pre-release suffix allowed.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid SemVer: ${version}`);
  }

  const results = await Promise.all([
    updateJsonVersion(TARGETS.rootPackage, version),
    updateJsonVersion(TARGETS.appPackage, version),
    updateJsonVersion(TARGETS.tauriConf, version),
    updateCargoVersion(TARGETS.tauriCargo, version),
  ]);

  const labels = ["package.json", "app/package.json", "tauri.conf.json", "Cargo.toml"];
  for (const [i, changed] of results.entries()) {
    console.log(`${changed ? "updated" : "unchanged"}: ${labels[i]}`);
  }
  console.log(`version: ${version}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
