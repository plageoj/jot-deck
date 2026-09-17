#!/usr/bin/env node
// Build the jot-deck-mcp bridge and stage it as a Tauri sidecar (externalBin).
//
// Tauri's `externalBin` expects each binary to exist with a target-triple
// suffix (e.g. jot-deck-mcp-x86_64-unknown-linux-gnu). This script compiles the
// `jot-deck-mcp` workspace member in release mode and copies the result into
// packages/app/src-tauri/binaries/ with the correct suffix so the bundler picks
// it up. Run automatically from tauri.conf.json's beforeBuildCommand.
//
// Target triple: uses TAURI_ENV_TARGET_TRIPLE when Tauri provides it (including
// cross-compiles), otherwise the host triple from `rustc -vV`.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const destDir = join(repoRoot, "packages", "app", "src-tauri", "binaries");

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/^host:\s*(.+)$/m);
  if (!match) throw new Error("Could not determine host target triple from rustc -vV");
  return match[1].trim();
}

function buildForTriple(triple) {
  // Build. Pass --target only when a specific triple is requested so a plain host
  // build lands in target/release (no triple subdir).
  const cargoArgs = ["build", "-p", "jot-deck-mcp", "--release"];
  if (triple) {
    cargoArgs.push("--target", triple);
  }
  console.log(`[sidecar] cargo ${cargoArgs.join(" ")}`);
  execFileSync("cargo", cargoArgs, { cwd: repoRoot, stdio: "inherit" });

  const builtDir = triple
    ? join(repoRoot, "target", triple, "release")
    : join(repoRoot, "target", "release");
  return join(builtDir, `jot-deck-mcp${exeSuffix}`);
}

const requestedTriple = process.env.TAURI_ENV_TARGET_TRIPLE;
const triple = requestedTriple || hostTriple();
const isWindows = triple.includes("windows");
const exeSuffix = isWindows ? ".exe" : "";
const destBin = join(destDir, `jot-deck-mcp-${triple}${exeSuffix}`);

mkdirSync(destDir, { recursive: true });

if (triple === "universal-apple-darwin") {
  // Not a real rustc/cargo target: Tauri's universal macOS build compiles the
  // app twice, once per real arch, and each of those two cargo invocations
  // asks tauri-build for the sidecar under ITS OWN `TARGET` env var (never
  // "universal-apple-darwin") — so stage both real-triple binaries here
  // rather than lipo-ing them into a single universal-named file no build
  // ever looks for.
  const arches = ["x86_64-apple-darwin", "aarch64-apple-darwin"];
  for (const arch of arches) {
    const builtBin = buildForTriple(arch);
    const archDestBin = join(destDir, `jot-deck-mcp-${arch}`);
    copyFileSync(builtBin, archDestBin);
    chmodSync(archDestBin, 0o755);
    console.log(`[sidecar] staged ${archDestBin}`);
  }
} else {
  const builtBin = buildForTriple(requestedTriple);
  copyFileSync(builtBin, destBin);

  // externalBin requires the sidecar to be executable; copyFileSync output
  // inherits the process umask, so restore the executable bit on Unix targets.
  if (!isWindows) chmodSync(destBin, 0o755);
  console.log(`[sidecar] staged ${destBin}`);
}
