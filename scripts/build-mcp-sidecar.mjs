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
  // Not a real rustc/cargo target — Tauri's own universal macOS build lipo's
  // together separate x86_64/aarch64 binaries, so do the same here.
  const arches = ["x86_64-apple-darwin", "aarch64-apple-darwin"];
  const builtBins = arches.map(buildForTriple);
  console.log(`[sidecar] lipo -create ${builtBins.join(" ")} -output ${destBin}`);
  execFileSync("lipo", ["-create", ...builtBins, "-output", destBin]);
} else {
  const builtBin = buildForTriple(requestedTriple);
  copyFileSync(builtBin, destBin);
}

// externalBin requires the sidecar to be executable; copyFileSync/lipo output
// inherits the process umask, so restore the executable bit on Unix targets.
if (!isWindows) chmodSync(destBin, 0o755);
console.log(`[sidecar] staged ${destBin}`);
