#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { collectSlackNotice } from "./collection/collect.js";
import { assertVendorNoticeArtifact, parseJson, type JsonValue, type ScanArtifact, type VendorNoticeArtifact } from "./domain/artifacts.js";
import { renderImpactReport } from "./report/render.js";
import { scanLocalRepository } from "./scan/scan.js";

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index === -1) throw new Error(`missing ${name}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return value;
}

function writeJson(path: string, value: VendorNoticeArtifact | ScanArtifact): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): JsonValue {
  try {
    return parseJson(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read artifact ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function run(args: string[]): void {
  const command = args[0];
  if (command === "collect") {
    const artifact = collectSlackNotice(option(args, "--fixture"));
    writeJson(option(args, "--output"), artifact);
    process.stdout.write([
      `Verified Slack VendorNotice and stored ${artifact.capabilityChange.canonicalIdentifier}.`,
      `Source: ${artifact.notice.sourceUrl}`,
      `Evidence: ${artifact.notice.excerpt}`,
      `Deadline: ${artifact.capabilityChange.deadlineOriginal} (${artifact.capabilityChange.deadlineIso ?? "not stated"})`
    ].join("\n") + "\n");
    return;
  }
  if (command === "scan") {
    const repositoryPath = args[1];
    if (!repositoryPath || repositoryPath.startsWith("--")) throw new Error("missing repository path");
    const notice = assertVendorNoticeArtifact(readJson(option(args, "--collection")));
    const result = scanLocalRepository(repositoryPath, notice);
    writeJson(option(args, "--output"), result);
    const provenDetails = result.impact === null
      ? "No Impact: no proven CodeMatch was found."
      : [
        `Impact: ${result.capabilityChange.canonicalIdentifier}`,
        `Evidence: ${result.impact.codeMatches.map(match => match.evidence).join(" | ")}`,
        `Locations: ${result.impact.codeMatches.map(match => `${match.file}:${match.line}`).join(", ")}`,
        `Deadline: ${result.capabilityChange.deadlineOriginal} (${result.capabilityChange.deadlineIso ?? "not stated"})`
      ].join("\n");
    const limitationDetails = result.limitations.length === 0
      ? "Analysis Limitations: none."
      : [
        "Analysis Limitations:",
        ...result.limitations.map(limitation => `- ${limitation.file}:${limitation.line}: ${limitation.reason}`)
      ].join("\n");
    process.stdout.write([
      `Scanned local repository: ${result.codeMatches.length} proven CodeMatch; ${result.limitations.length} unresolved usage(s).`,
      provenDetails,
      limitationDetails,
      "Privacy: Repository analysis stayed local; source, paths, snippets, and scan artifacts were not sent externally."
    ].join("\n") + "\n");
    return;
  }
  if (command === "report") {
    const report = renderImpactReport(readJson(option(args, "--scan")));
    const outputPath = option(args, "--output");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, report, "utf8");
    process.stdout.write(`Generated local Impact Report at ${outputPath}. Confirmed Impact: ${report.includes("Confirmed Impact") ? "yes" : "no"}. Privacy: repository analysis stayed local.\n`);
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
