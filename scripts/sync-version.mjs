#!/usr/bin/env node
// Sync the app version across package.json files, tauri.conf.json, and Cargo.toml.
// Single source of truth for what version the Tauri build will report.
//
// Usage:
//   node scripts/sync-version.mjs <version>          # write <version> (also rewrites preview-base-version.txt with the base portion)
//   node scripts/sync-version.mjs --from-package     # read from packages/app/package.json
//   node scripts/sync-version.mjs --preview <num>    # append -<num> to base from preview-base-version.txt
//                                                    # (numeric-only pre-release: the Windows MSI/WiX target
//                                                    #  rejects non-numeric pre-release identifiers like "-preview.N")

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
  coreCargo: resolve(repoRoot, "crates/core/Cargo.toml"),
  reporterHostCargo: resolve(repoRoot, "crates/reporter-host/Cargo.toml"),
};

const PREVIEW_BASE_FILE = resolve(repoRoot, "packages/app/preview-base-version.txt");

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

async function updatePreviewBaseFile(path, baseVersion) {
  const current = (await readFile(path, "utf8")).trim();
  if (current === baseVersion) return false;
  await writeFile(path, baseVersion + "\n");
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
    if (!argv[1]) throw new Error("--preview requires a numeric id argument");
    if (!/^\d+$/.test(argv[1])) {
      throw new Error(`--preview id must be numeric (got "${argv[1]}")`);
    }
    if (Number(argv[1]) > 65535) {
      throw new Error(
        `--preview id ${argv[1]} exceeds 65535 (MSI bundler limit). ` +
          `Bump the base version in packages/app/preview-base-version.txt.`,
      );
    }
    return { mode: "preview", num: argv[1] };
  }
  return { mode: "explicit", version: argv[0] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let version;
  if (args.mode === "preview") {
    const base = (await readFile(PREVIEW_BASE_FILE, "utf8")).trim();
    if (!/^\d+\.\d+\.\d+$/.test(base)) {
      throw new Error(
        `preview-base-version.txt must contain a bare MAJOR.MINOR.PATCH (got "${base}")`,
      );
    }
    // Numeric-only pre-release (e.g. 0.1.0-42). The Windows MSI/WiX bundler
    // rejects non-numeric pre-release identifiers, so "-preview.42" can't be used.
    version = `${base}-${args.num}`;
  } else if (args.needRead) {
    version = (await readJson(TARGETS.appPackage)).version;
  } else {
    version = args.version;
  }

  // Validate. Tauri requires SemVer; pre-release suffix allowed.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid SemVer: ${version}`);
  }

  const baseForPreview = version.replace(/[-+].*$/, "");

  const results = await Promise.all([
    updateJsonVersion(TARGETS.rootPackage, version),
    updateJsonVersion(TARGETS.appPackage, version),
    updateJsonVersion(TARGETS.tauriConf, version),
    updateCargoVersion(TARGETS.tauriCargo, version),
    updateCargoVersion(TARGETS.coreCargo, version),
    updateCargoVersion(TARGETS.reporterHostCargo, version),
    // Preview baseline is updated only on explicit-version runs, not on
    // each preview build — otherwise the file's git history (which the
    // workflow uses to count commits) would reset every build.
    args.mode === "explicit"
      ? updatePreviewBaseFile(PREVIEW_BASE_FILE, baseForPreview)
      : Promise.resolve(false),
  ]);

  const labels = [
    "package.json",
    "app/package.json",
    "tauri.conf.json",
    "src-tauri/Cargo.toml",
    "crates/core/Cargo.toml",
    "crates/reporter-host/Cargo.toml",
    "preview-base-version.txt",
  ];
  for (const [i, changed] of results.entries()) {
    console.log(`${changed ? "updated" : "unchanged"}: ${labels[i]}`);
  }
  console.log(`version: ${version}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
