#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectBrightDataVendorNotice, brightDataConfigFromEnvironment, loadEnvironmentFile } from "./collection/bright-data.js";
import { collectVendorNotice } from "./collection/collect.js";
import { approveCollectorRepair, proposeCollectorRepair, rerunCollectorRepair, validateCollectorRepair } from "./collection/repair.js";
import { curatedSourceUrlForVendor, type Vendor } from "./domain/capabilities.js";
import { assertCollectorHealthArtifact, assertCollectorRepairArtifact, assertVendorNoticeArtifact, HEALTHY_COLLECTOR_HEALTH_MESSAGE, isRecord, parseJson, type CollectorHealthArtifact, type CollectorRepairArtifact, type JsonValue, type ScanArtifact, type VendorNoticeArtifact } from "./domain/artifacts.js";
import { CollectorHealthError } from "./domain/collector-health.js";
import { renderImpactReport } from "./report/render.js";
import { scanLocalRepository } from "./scan/scan.js";

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index === -1) throw new Error(`missing ${name}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return value;
}

function optionalOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return value;
}

function vendorOption(value: string): Vendor {
  if (value === "Slack" || value === "OpenAI" || value === "Cloudflare") return value;
  throw new Error(`unsupported vendor ${value}; expected Slack, OpenAI, or Cloudflare`);
}

function writeJson(path: string, value: CollectorHealthArtifact | CollectorRepairArtifact | VendorNoticeArtifact | ScanArtifact): void {
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

function collectorHealthSummary(): string {
  return HEALTHY_COLLECTOR_HEALTH_MESSAGE;
}

function missingCollectorHealthSummary(): string {
  return "CollectorHealth: no stored health record was provided; health checks were not asserted.";
}

function readVendorNotice(path: string): VendorNoticeArtifact {
  const value = readJson(path);
  if (isRecord(value) && value.kind === "collector-health") {
    const diagnostic = assertCollectorHealthArtifact(value);
    throw new Error(`cannot scan drifted collector output (${diagnostic.collectorHealth.signal}); affected output was withheld`);
  }
  return assertVendorNoticeArtifact(value);
}

function readCollectorRepair(path: string): CollectorRepairArtifact {
  return assertCollectorRepairArtifact(readJson(path));
}

function collectorLabel(collector: { identity: string; version: string }): string {
  return `${collector.identity}@${collector.version}`;
}

async function run(args: string[]): Promise<void> {
  const command = args[0];
  if (command === "collect") {
    loadEnvironmentFile(resolve(process.cwd(), ".env"));
    const outputPath = option(args, "--output");
    try {
      const artifact = args.includes("--live")
        ? await collectBrightDataVendorNotice(
          (() => {
            const vendor = vendorOption(option(args, "--vendor"));
            const sourceUrl = optionalOption(args, "--source-url") ?? curatedSourceUrlForVendor(vendor);
            if (!sourceUrl) throw new Error(`no curated source is configured for ${vendor}`);
            return { vendor, sourceUrl };
          })(),
          brightDataConfigFromEnvironment()
        )
        : collectVendorNotice(option(args, "--fixture"));
      writeJson(outputPath, artifact);
      process.stdout.write([
        `Verified ${artifact.notice.vendor} VendorNotice from ${artifact.collection?.collector.identity ?? "stored collection"} and stored ${artifact.capabilityChange.canonicalIdentifier}.`,
        `Source: ${artifact.notice.sourceUrl}`,
        `Evidence: ${artifact.notice.excerpt}`,
        `Deadline: ${artifact.capabilityChange.deadlineOriginal} (${artifact.capabilityChange.deadlineIso ?? "not stated"})`,
        collectorHealthSummary()
      ].join("\n") + "\n");
    } catch (error) {
      if (error instanceof CollectorHealthError) {
        writeJson(outputPath, error.artifact);
        process.stderr.write(`CollectorHealth diagnostic stored at ${outputPath}.\n`);
      }
      throw error;
    }
    return;
  }
  if (command === "scan") {
    const repositoryPath = args[1];
    if (!repositoryPath || repositoryPath.startsWith("--")) throw new Error("missing repository path");
    const notice = readVendorNotice(option(args, "--collection"));
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
      `Scanned local repository: ${result.codeMatches.length} proven CodeMatch${result.codeMatches.length > 1 ? "es" : ""}; ${result.limitations.length} unresolved usage(s).`,
      provenDetails,
      limitationDetails,
      result.collectorHealth ? collectorHealthSummary() : missingCollectorHealthSummary(),
      "Privacy: Repository analysis stayed local; source, paths, snippets, and scan artifacts were not sent externally."
    ].join("\n") + "\n");
    return;
  }
  if (command === "report") {
    const repairPath = optionalOption(args, "--repair");
    const report = renderImpactReport(readJson(option(args, "--scan")), new Date(), repairPath ? readJson(repairPath) : undefined);
    const outputPath = option(args, "--output");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, report, "utf8");
    process.stdout.write(`Generated local Impact Report at ${outputPath}. Confirmed Impact: ${report.includes("Confirmed Impact") ? "yes" : "no"}. Privacy: repository analysis stayed local.\n`);
    return;
  }
  if (command === "repair") {
    const action = args[1] && !args[1].startsWith("--")
      ? args[1]
      : args.includes("--approve") ? "approve" : args.includes("--validate") ? "validate" : args.includes("--rerun") ? "rerun" : "diagnose";
    const outputPath = option(args, "--output");
    if (action === "diagnose") {
      const proposal = proposeCollectorRepair(readJson(option(args, "--diagnostic")), optionalOption(args, "--proposed-version"));
      writeJson(outputPath, proposal);
      process.stdout.write([
        `CollectorHealth ${proposal.detected.collectorHealth.signal} diagnosed for ${collectorLabel(proposal.activeCollector)}.`,
        `Proposed collector: ${collectorLabel(proposal.proposedCollector)}.`,
        `Diagnosis: ${proposal.diagnosis}`,
        proposal.activation.message,
        "Validation has not run; approval cannot be requested yet."
      ].join("\n") + "\n");
      return;
    }
    if (action === "validate") {
      const validation = validateCollectorRepair(readJson(option(args, "--proposal")), option(args, "--fixture"));
      writeJson(outputPath, validation);
      if (validation.validation.status !== "passed") throw new Error(`collector repair validation failed: ${validation.validation.message}`);
      process.stdout.write([
        validation.validation.message,
        validation.approval.message,
        `Active collector remains ${collectorLabel(validation.activeCollector)}.`
      ].join("\n") + "\n");
      return;
    }
    if (action === "approve") {
      const proposal = readCollectorRepair(option(args, "--proposal"));
      try {
        const activation = approveCollectorRepair(proposal);
        writeJson(outputPath, activation);
        process.stdout.write([
          activation.approval.message,
          activation.activation.message,
          "Run a healthy rerun to observe recovery."
        ].join("\n") + "\n");
      } catch (error) {
        writeJson(outputPath, proposal);
        throw error;
      }
      return;
    }
    if (action === "rerun") {
      const recovered = rerunCollectorRepair(readJson(option(args, "--proposal")), option(args, "--fixture"));
      writeJson(outputPath, recovered);
      if (recovered.rerun.status !== "healthy") throw new Error(`collector repair healthy rerun failed: ${recovered.rerun.message}`);
      process.stdout.write([
        recovered.rerun.message,
        `Active collector: ${collectorLabel(recovered.activeCollector)}.`
      ].join("\n") + "\n");
      return;
    }
    throw new Error(`unknown repair action ${action}; expected diagnose, validate, approve, or rerun`);
  }
  throw new Error(`unknown command ${command ?? ""}; expected collect, scan, report, or repair`);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`blast: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
