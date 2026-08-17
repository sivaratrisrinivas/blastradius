#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { collectSlackNotice } from "./collection/collect.js";
import { assertScanArtifact, assertVendorNoticeArtifact } from "./domain/artifacts.js";
import { renderImpactReport } from "./report/render.js";
import { scanLocalRepository } from "./scan/scan.js";

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index === -1 || !value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return value;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read artifact ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function run(args: string[]): void {
  const command = args[0];
  if (command === "collect") {
    const artifact = collectSlackNotice(option(args, "--fixture"));
    writeJson(option(args, "--output"), artifact);
    process.stdout.write(`Verified Slack VendorNotice and stored ${artifact.capabilityChange.canonicalIdentifier}.\n`);
    return;
  }
  if (command === "scan") {
    const repositoryPath = args[1];
    if (!repositoryPath || repositoryPath.startsWith("--")) throw new Error("missing repository path");
    const notice = assertVendorNoticeArtifact(readJson(option(args, "--collection")));
    const result = scanLocalRepository(repositoryPath, notice);
    writeJson(option(args, "--output"), result);
    process.stdout.write(`Scanned local repository: ${result.codeMatches.length} proven CodeMatch.\n`);
    return;
  }
  if (command === "report") {
    const report = renderImpactReport(assertScanArtifact(readJson(option(args, "--scan"))));
    const outputPath = option(args, "--output");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, report, "utf8");
    process.stdout.write(`Generated local Impact Report at ${outputPath}.\n`);
    return;
  }
  throw new Error(`unknown command ${command ?? ""}; expected collect, scan, or report`);
}

try {
  run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`blast: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
