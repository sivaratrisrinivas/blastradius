#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectBrightDataVendorNotice, brightDataConfigFromEnvironment, loadEnvironmentFile } from "./collection/bright-data.js";
import { collectVendorNotice } from "./collection/collect.js";
import { brightDataHealDriver, recordedHealDriver, type CollectorHealDriver } from "./collection/bright-data-heal.js";
import { detectCollectorHeal, rerunCollectorHeal, resolveCollectorHeal, runCollectorHeal } from "./collection/heal.js";
import { capabilitiesProvable, curatedSourceUrlForVendor, isVendor, matcherForIdentifier, curatedVendorCount, type Vendor } from "./domain/capabilities.js";
import { assertCollectorHealArtifact, assertCollectorHealthArtifact, assertVendorNoticeArtifact, collectorLabel, HEAL_PROMPT_MAX_LENGTH, HEALTHY_COLLECTOR_HEALTH_MESSAGE, isRecord, parseJson, type CollectorHealArtifact, type CollectorHealthArtifact, type JsonValue, type ScanArtifact, type VendorNoticeArtifact } from "./domain/artifacts.js";
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
  if (isVendor(value)) return value;
  throw new Error(`${value} is not a curated vendor; ${curatedVendorCount()} vendors are watched and ${capabilitiesProvable()} capabilities are provable`);
}

function writeJson(path: string, value: CollectorHealArtifact | CollectorHealthArtifact | VendorNoticeArtifact | ScanArtifact): void {
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

/** Both numbers, every time. ADR 0002 forbids letting the larger one stand in for the smaller. */
function coverageSummary(): string {
  return `Coverage: ${curatedVendorCount()} vendors watched, ${capabilitiesProvable()} capabilities provable.`;
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

/**
 * Bright Data can approve and save a heal without a human. Amendment 1 section 2 keeps those
 * switches off the product path entirely, so the CLI refuses them rather than ignoring them.
 */
function refuseAutomaticApproval(args: string[]): void {
  for (const flag of ["--auto-approve", "--auto-save"]) {
    if (args.includes(flag)) throw new Error(`${flag} is not available: a healed template is saved only after an explicit human approval`);
  }
}

function healDriver(args: string[]): CollectorHealDriver {
  const recordedPath = optionalOption(args, "--recorded");
  if (recordedPath !== undefined) return recordedHealDriver(recordedPath);
  loadEnvironmentFile(resolve(process.cwd(), ".env"));
  return brightDataHealDriver(brightDataConfigFromEnvironment());
}

/**
 * How the post-approval rerun collects. `--live` runs the healed collector for real; otherwise a
 * stored fixture stands in, which is what the offline suite and the demo use.
 */
function healRerunCollection(args: string[], heal: CollectorHealArtifact): () => Promise<VendorNoticeArtifact> {
  if (!args.includes("--live")) {
    const fixturePath = option(args, "--fixture");
    return async () => collectVendorNotice(fixturePath);
  }
  const vendor = heal.detected.vendor;
  const sourceUrl = heal.detected.sourceUrl;
  if (!vendor || !sourceUrl) throw new Error("a live rerun needs the detected vendor and curated source recorded on the heal");
  loadEnvironmentFile(resolve(process.cwd(), ".env"));
  const config = brightDataConfigFromEnvironment();
  return () => collectBrightDataVendorNotice({ vendor, sourceUrl }, config);
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
        collectorHealthSummary(),
        coverageSummary()
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
    const watchedOnly = matcherForIdentifier(result.capabilityChange.canonicalIdentifier, result.capabilityChange.vendor) === null;
    const provenDetails = result.impact === null
      ? watchedOnly
        ? `No Impact: ${result.capabilityChange.vendor} is a WatchedVendor with no repository matcher, so this source can never produce an Impact.`
        : "No Impact: no proven CodeMatch was found."
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
      coverageSummary(),
      "Privacy: Repository analysis stayed local; source, paths, snippets, and scan artifacts were not sent externally."
    ].join("\n") + "\n");
    return;
  }
  if (command === "report") {
    const healPath = optionalOption(args, "--heal");
    const report = renderImpactReport(readJson(option(args, "--scan")), new Date(), healPath ? readJson(healPath) : undefined);
    const outputPath = option(args, "--output");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, report, "utf8");
    process.stdout.write(`Generated local Impact Report at ${outputPath}. Confirmed Impact: ${report.includes("Confirmed Impact") ? "yes" : "no"}. Privacy: repository analysis stayed local.\n`);
    return;
  }
  if (command === "heal") {
    refuseAutomaticApproval(args);
    const action = args[1] && !args[1].startsWith("--") ? args[1] : "detect";
    const outputPath = option(args, "--output");
    if (action === "detect") {
      const lastKnownGoodPath = optionalOption(args, "--last-known-good");
      const heal = detectCollectorHeal(
        readJson(option(args, "--diagnostic")),
        lastKnownGoodPath === undefined ? undefined : readJson(lastKnownGoodPath)
      );
      writeJson(outputPath, heal);
      process.stdout.write([
        `CollectorHealth ${heal.detected.signal} detected for ${collectorLabel(heal.collector)}.`,
        `Diagnosis: ${heal.diagnosis}`,
        `Composed heal prompt (${heal.prompt.text.length}/${HEAL_PROMPT_MAX_LENGTH} characters): ${heal.prompt.text}`,
        heal.heal.message
      ].join("\n") + "\n");
      return;
    }
    if (action === "run" || action === "approve" || action === "reject") {
      const healPath = option(args, "--heal");
      const stored = readJson(healPath);
      const driver = healDriver(args);
      try {
        const heal = action === "run"
          ? await runCollectorHeal(stored, driver)
          : await resolveCollectorHeal(stored, action, driver);
        writeJson(outputPath, heal);
        process.stdout.write([
          heal.heal.message,
          heal.approval.message,
          action === "run" ? `Heal evidence source: ${heal.heal.source}.` : `Bright Data steps completed: ${heal.heal.completedSteps.join(", ")}.`
        ].join("\n") + "\n");
      } catch (error) {
        writeJson(outputPath, assertCollectorHealArtifact(stored));
        throw error;
      }
      return;
    }
    if (action === "rerun") {
      const stored = assertCollectorHealArtifact(readJson(option(args, "--heal")));
      const reran = await rerunCollectorHeal(stored, healRerunCollection(args, stored));
      writeJson(outputPath, reran);
      if (reran.rerun.status !== "healthy") throw new Error(`collector heal rerun failed: ${reran.rerun.message}`);
      process.stdout.write([
        reran.rerun.message,
        `Collector: ${collectorLabel(reran.collector)}.`
      ].join("\n") + "\n");
      return;
    }
    throw new Error(`unknown heal action ${action}; expected detect, run, approve, reject, or rerun`);
  }
  throw new Error(`unknown command ${command ?? ""}; expected collect, scan, report, or heal`);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`blast: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
