import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { assertScanArtifact } from "../src/domain/artifacts.js";
import { brightDataConfigForVendor, vendorCollectorEnvironmentName } from "../src/collection/bright-data.js";
import { collectVendorNotice } from "../src/collection/collect.js";
import { renderImpactReport } from "../src/report/render.js";
import { scanLocalRepository } from "../src/scan/scan.js";
import {
  capabilitiesProvable,
  curatedSourceForUrl,
  curatedSources,
  curatedVendorCount,
  watchedVendors
} from "../src/domain/capabilities.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const watchedFixtureDirectory = resolve(repositoryRoot, "fixtures/watched");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const slackRepository = resolve(repositoryRoot, "fixtures/repository");

function watchedFixtures(): string[] {
  return readdirSync(watchedFixtureDirectory)
    .filter(entry => entry.endsWith(".json"))
    .map(entry => resolve(watchedFixtureDirectory, entry))
    .sort();
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repositoryRoot, encoding: "utf8" });
}

test("the fleet is ten to twelve curated first-party sources while the matchers stay at three", () => {
  assert.ok(curatedVendorCount() >= 10 && curatedVendorCount() <= 12, `fleet is ${curatedVendorCount()}`);
  assert.equal(capabilitiesProvable(), 3);
  assert.equal(watchedVendors().length, curatedVendorCount() - capabilitiesProvable());

  const matchers = new Set(curatedSources().map(source => source.matcher).filter(matcher => matcher !== null));
  assert.deepEqual([...matchers].sort(), ["cloudflare-kv-legacy-routes", "openai-assistants", "slack-files-upload"]);

  const vendors = curatedSources().map(source => source.vendor);
  assert.equal(new Set(vendors).size, vendors.length, "each curated source names a distinct vendor");
  const sourceUrls = curatedSources().map(source => source.sourceUrl);
  assert.equal(new Set(sourceUrls).size, sourceUrls.length);
});

test("every watched source is a real first-party notice that passes the existing assertion gates", () => {
  const fixtures = watchedFixtures();
  assert.equal(fixtures.length, watchedVendors().length);

  const collected = fixtures.map(fixture => collectVendorNotice(fixture));
  for (const artifact of collected) {
    const source = curatedSourceForUrl(artifact.notice.sourceUrl);
    assert.ok(source, `${artifact.notice.sourceUrl} is on the curated allowlist`);
    assert.equal(source.matcher, null, `${artifact.notice.vendor} is watched, not matched`);
    assert.equal(artifact.notice.vendor, source.vendor);
    assert.ok(artifact.notice.excerpt.includes(source.evidenceIdentifier));
    assert.ok(["deprecation", "sunset", "shutdown", "removal"].includes(artifact.capabilityChange.changeType));
    assert.equal(artifact.collectorHealth?.status, "healthy");
  }

  const watchedVendorNames = watchedVendors().map(vendor => vendor.vendor).sort();
  assert.deepEqual(collected.map(artifact => artifact.notice.vendor).sort(), watchedVendorNames);
});

test("every curated source has its own collector, because one collector holds one parse template", () => {
  const environment: NodeJS.ProcessEnv = { BRIGHTDATA_API_KEY: "token", BRIGHTDATA_COLLECTOR_ID: "c_shared" };
  for (const source of curatedSources()) {
    environment[vendorCollectorEnvironmentName(source.vendor)] = `c_${source.vendor.toLowerCase().replaceAll(/[^a-z0-9]+/g, "")}`;
  }

  for (const source of curatedSources()) {
    const config = brightDataConfigForVendor(source.vendor, environment);
    assert.notEqual(config.collectorId, "c_shared", `${source.vendor} fell back to the shared collector`);
    assert.equal(config.collectorId, environment[vendorCollectorEnvironmentName(source.vendor)]);
  }

  assert.equal(vendorCollectorEnvironmentName("Google Maps Platform"), "BRIGHTDATA_COLLECTOR_ID_GOOGLE_MAPS_PLATFORM");
  const identifiers = curatedSources().map(source => vendorCollectorEnvironmentName(source.vendor));
  assert.equal(new Set(identifiers).size, identifiers.length, "two vendors share one collector variable");
});

test("each watched fixture is a real capture from that vendor's own collector", () => {
  const collectorIds = new Set<string>();
  for (const fixture of watchedFixtures()) {
    const artifact = collectVendorNotice(fixture);
    const collector = artifact.collection?.collector.identity ?? "";
    assert.match(collector, /^c_[a-z0-9]+$/, `${fixture} was not captured from a real Bright Data collector`);
    collectorIds.add(collector);
    assert.notEqual(artifact.collection?.retrievedAt, undefined);
  }
  assert.equal(collectorIds.size, watchedVendors().length, "watched fixtures must not share a collector");
});

test("faithful deadline wording survives collection, ordinals and partial dates included", () => {
  const byIdentifier = new Map(watchedFixtures()
    .map(fixture => collectVendorNotice(fixture))
    .map(artifact => [artifact.capabilityChange.canonicalIdentifier, artifact.capabilityChange]));

  const vercel = byIdentifier.get("vercel.config.now-json");
  assert.equal(vercel?.deadlineOriginal, "March 31st, 2026");
  assert.equal(vercel?.deadlineIso, null, "an ordinal date is not normalized into a claim we cannot make");

  const maps = byIdentifier.get("google-maps.javascript.heatmap-layer");
  assert.equal(maps?.deadlineIso, null, "a month-only deadline stays unnormalized");

  const hubspot = byIdentifier.get("hubspot.contacts.lists-v1");
  assert.equal(hubspot?.deadlineOriginal, "April 30, 2026");
  assert.equal(hubspot?.deadlineIso, "2026-04-30");
});

test("a WatchedVendor with no matcher yields no Impact, in any repository", () => {
  for (const fixture of watchedFixtures()) {
    const notice = collectVendorNotice(fixture);
    for (const repository of [slackRepository, repositoryRoot]) {
      const scan = scanLocalRepository(repository, notice);
      assert.equal(scan.impact, null, `${notice.notice.vendor} produced an Impact against ${repository}`);
      assert.deepEqual(scan.codeMatches, []);
      assert.deepEqual(scan.limitations, []);
      assert.throws(() => renderImpactReport(JSON.parse(JSON.stringify(scan))), /without a proven CodeMatch/);
    }
  }
});

test("a stored artifact cannot smuggle in a CodeMatch against a watched source", () => {
  const notice = collectVendorNotice(resolve(watchedFixtureDirectory, "firebase-ml.json"));
  const scan = scanLocalRepository(slackRepository, notice);
  const codeMatch = {
    vendor: "Firebase",
    capabilityIdentifier: "firebase.ml",
    file: "src/invented.ts",
    line: 1,
    evidenceStrength: "direct",
    context: "source",
    evidence: "firebase.ml()"
  };
  const forged = {
    ...JSON.parse(JSON.stringify(scan)),
    codeMatches: [codeMatch],
    impact: { capabilityChange: scan.capabilityChange, codeMatches: [codeMatch] }
  };

  assert.throws(() => assertScanArtifact(forged), /WatchedVendor/);
});

test("a watched source contributes CollectorHealth and CollectorHeal evidence like any other", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-13-heal-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const healPath = resolve(directory, "heal.json");

  const collected = runCli([
    "collect",
    "--fixture", resolve(repositoryRoot, "fixtures/collector-health/watched-zero-results.json"),
    "--output", diagnosticPath
  ]);
  assert.notEqual(collected.status, 0, "drifted watched output must not be publishable");
  const diagnostic = JSON.parse(readFileSync(diagnosticPath, "utf8"));
  assert.equal(diagnostic.kind, "collector-health");
  assert.equal(diagnostic.collectorHealth.signal, "zero-results");
  assert.equal(diagnostic.vendor, "Firebase");

  const detected = runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--output", healPath]);
  assert.equal(detected.status, 0, detected.stderr);
  assert.match(detected.stdout, /CollectorHealth zero-results detected/);

  const heal = JSON.parse(readFileSync(healPath, "utf8"));
  assert.equal(heal.detected.vendor, "Firebase");
  assert.equal(heal.detected.sourceUrl, "https://firebase.google.com/docs/ml?hl=en");
  assert.ok(heal.prompt.text.length > 0);
});

test("the CLI reports a watched source as watched rather than as an empty scan", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-13-watched-");
  const collectionPath = resolve(directory, "collection.json");
  const scanPath = resolve(directory, "scan.json");

  const collected = runCli(["collect", "--fixture", resolve(watchedFixtureDirectory, "firebase-ml.json"), "--output", collectionPath]);
  assert.equal(collected.status, 0, collected.stderr);
  assert.match(collected.stdout, /Verified Firebase VendorNotice/);

  const scanned = runCli(["scan", slackRepository, "--collection", collectionPath, "--output", scanPath]);
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.match(scanned.stdout, /WatchedVendor with no repository matcher/);
  assert.doesNotMatch(scanned.stdout, /Impact: firebase\.ml/);

  const stored = JSON.parse(readFileSync(scanPath, "utf8"));
  assert.equal(stored.impact, null);
});

test("both numbers are published together and the larger never stands in for the smaller", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-13-coverage-");
  const collectionPath = resolve(directory, "collection.json");
  const scanPath = resolve(directory, "scan.json");
  const reportPath = resolve(directory, "report.html");

  const collected = runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  assert.equal(collected.status, 0, collected.stderr);
  assert.match(collected.stdout, new RegExp(`Coverage: ${curatedVendorCount()} vendors watched, ${capabilitiesProvable()} capabilities provable\\.`));

  const scanned = runCli(["scan", slackRepository, "--collection", collectionPath, "--output", scanPath]);
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.match(scanned.stdout, new RegExp(`Coverage: ${curatedVendorCount()} vendors watched, ${capabilitiesProvable()} capabilities provable\\.`));

  const reported = runCli(["report", "--scan", scanPath, "--output", reportPath]);
  assert.equal(reported.status, 0, reported.stderr);

  const report = readFileSync(reportPath, "utf8");
  assert.match(report, new RegExp(`data-coverage="vendors-watched">${curatedVendorCount()}<`));
  assert.match(report, new RegExp(`data-coverage="capabilities-provable">${capabilitiesProvable()}<`));
  assert.match(report, /A WatchedVendor contributes CollectorHealth and CollectorHeal evidence and nothing else\./);
});
