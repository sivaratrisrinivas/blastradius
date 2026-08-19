import { readFileSync } from "node:fs";
import {
  ARTIFACT_SCHEMA_VERSION,
  COLLECTION_SCHEMA_VERSION,
  assertVendorNoticeArtifact,
  asString,
  isChangeType,
  isRecord,
  isStringValue,
  parseJson,
  type CollectorIdentity,
  type JsonObject,
  type JsonValue,
  type VendorNoticeArtifact,
  type VendorNoticeCollection,
  healthyCollectorHealth
} from "../domain/artifacts.js";
import { evaluateCapabilityChangeCandidate, type CapabilityChangeCandidate } from "../domain/assertions.js";
import { capabilityForSourceUrl, type Vendor } from "../domain/capabilities.js";
import { collectorHealthError } from "../domain/collector-health.js";

const DEFAULT_FIXTURE_COLLECTOR: CollectorIdentity = { identity: "deterministic-fixture", version: "fixture-v1" };

interface FixtureMetadata {
  collector: CollectorIdentity;
  vendor?: Vendor;
  sourceUrl?: string;
}

function fixtureMetadata(value: JsonValue): FixtureMetadata {
  if (!isRecord(value)) return { collector: DEFAULT_FIXTURE_COLLECTOR };
  let collector = DEFAULT_FIXTURE_COLLECTOR;
  if (isRecord(value.collector) && isStringValue(value.collector.identity) && isStringValue(value.collector.version) && value.collector.identity.trim() !== "" && value.collector.version.trim() !== "") {
    collector = { identity: value.collector.identity, version: value.collector.version };
  }
  const vendor: Vendor | undefined = value.vendor === "Slack" || value.vendor === "OpenAI" || value.vendor === "Cloudflare" ? value.vendor : undefined;
  const sourceUrl = isStringValue(value.sourceUrl) && value.sourceUrl.trim() !== "" ? value.sourceUrl : undefined;
  const metadata: FixtureMetadata = { collector };
  if (vendor) metadata.vendor = vendor;
  if (sourceUrl) metadata.sourceUrl = sourceUrl;
  return metadata;
}

function fixtureHealthError(value: JsonValue, signal: "zero-results" | "required-field-collapse" | "schema-failure", message: string): never {
  const metadata = fixtureMetadata(value);
  throw collectorHealthError(metadata.collector, signal, message, metadata.vendor, metadata.sourceUrl);
}

function assertFixtureRequiredFields(value: JsonObject): void {
  const requiredFields = ["vendor", "sourceUrl", "retrievedAt", "content", "excerpt", "deadlineOriginal"] as const;
  const collapsed = requiredFields.filter(field => {
    const fieldValue = value[field];
    return fieldValue === undefined || fieldValue === null || (isStringValue(fieldValue) && fieldValue.trim() === "");
  });
  const malformed = requiredFields.filter(field => {
    const fieldValue = value[field];
    return fieldValue !== undefined && fieldValue !== null && !isStringValue(fieldValue);
  });
  if (collapsed.length > 0) fixtureHealthError(value, "required-field-collapse", `Required collection field(s) were missing or empty: ${collapsed.join(", ")}.`);
  if (malformed.length > 0) fixtureHealthError(value, "schema-failure", `Required collection field(s) had an unsupported shape: ${malformed.join(", ")}.`);
  if (value.deadlineIso === undefined || value.deadlineIso === "") fixtureHealthError(value, "required-field-collapse", "Required collection field(s) were missing or empty: deadlineIso.");
  if (value.deadlineIso !== null && value.deadlineIso !== undefined && !isStringValue(value.deadlineIso)) fixtureHealthError(value, "schema-failure", "Required collection field(s) had an unsupported shape: deadlineIso.");
}

export function collectVendorNotice(fixturePath: string): VendorNoticeArtifact {
  let contents: string;
  try {
    contents = readFileSync(fixturePath, "utf8");
  } catch (error) {
    throw new Error(`could not read collection fixture: ${error instanceof Error ? error.message : String(error)}`);
  }
  let fixture: JsonValue;
  try {
    fixture = parseJson(contents);
  } catch {
    fixtureHealthError(null, "schema-failure", "Collection fixture was not valid JSON.");
  }
  if (Array.isArray(fixture)) {
    if (fixture.length === 0) fixtureHealthError(fixture, "zero-results", "The collection returned zero results while one VendorNotice was required.");
    fixtureHealthError(fixture, "schema-failure", "Collection fixture results must use one supported object record.");
  }
  if (!isRecord(fixture)) fixtureHealthError(fixture, "schema-failure", "Collection fixture must be a supported object record.");
  if (fixture.schemaVersion !== undefined) fixtureHealthError(fixture, "schema-failure", "Collection fixture used an unsupported response schema.");
  if (fixture.records !== undefined) {
    if (Array.isArray(fixture.records) && fixture.records.length === 0) fixtureHealthError(fixture, "zero-results", "The collection returned zero results while one VendorNotice was required.");
    fixtureHealthError(fixture, "schema-failure", "Collection fixture used an unsupported response schema.");
  }
  if (fixture.results !== undefined) {
    if (Array.isArray(fixture.results) && fixture.results.length === 0) fixtureHealthError(fixture, "zero-results", "The collection returned zero results while one VendorNotice was required.");
    fixtureHealthError(fixture, "schema-failure", "Collection fixture used an unsupported response schema.");
  }
  const vendor = asString(fixture.vendor, "vendor");
  const sourceUrl = asString(fixture.sourceUrl, "sourceUrl");
  const sourceCapability = capabilityForSourceUrl(sourceUrl);
  if (!sourceCapability || sourceCapability.vendor !== vendor) {
    throw new Error(`collection fixture is not an allowed first-party ${vendor} source`);
  }
  assertFixtureRequiredFields(fixture);
  const retrievedAt = asString(fixture.retrievedAt, "retrievedAt");
  const excerpt = asString(fixture.excerpt, "excerpt");
  const capabilityIdentifier = asString(fixture.capabilityIdentifier, "capabilityIdentifier");
  const changeType = asString(fixture.changeType, "changeType");
  const deadlineOriginal = asString(fixture.deadlineOriginal, "deadlineOriginal");
  const deadlineIso = fixture.deadlineIso === null ? null : asString(fixture.deadlineIso, "deadlineIso");
  const collection: VendorNoticeCollection = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    kind: "vendor-notice-collection",
    vendor: sourceCapability.vendor,
    sourceUrl,
    retrievedAt,
    collector: fixture.collector === undefined
      ? DEFAULT_FIXTURE_COLLECTOR
      : parseFixtureCollector(fixture.collector),
    content: fixture.content === undefined ? excerpt : asString(fixture.content, "content"),
    excerpt,
    capabilityIdentifier,
    changeType,
    deadlineOriginal,
    deadlineIso
  };
  return vendorNoticeArtifactFromCollection(collection);
}

function parseFixtureCollector(value: JsonValue): CollectorIdentity {
  if (!isRecord(value)) fixtureHealthError(value, "schema-failure", "Collector metadata must be an object with identity and version.");
  if (!isStringValue(value.identity) || !isStringValue(value.version) || value.identity.trim() === "" || value.version.trim() === "") {
    fixtureHealthError(value, "schema-failure", "Collector metadata must contain non-empty identity and version fields.");
  }
  return {
    identity: asString(value.identity, "collector.identity"),
    version: asString(value.version, "collector.version")
  };
}

export function vendorNoticeArtifactFromCollection(collection: VendorNoticeCollection): VendorNoticeArtifact {
  const candidate: CapabilityChangeCandidate = {
    vendor: collection.vendor,
    sourceUrl: collection.sourceUrl,
    retrievedAt: collection.retrievedAt,
    excerpt: collection.excerpt,
    capabilityIdentifier: collection.capabilityIdentifier,
    changeType: collection.changeType,
    deadlineOriginal: collection.deadlineOriginal,
    deadlineIso: collection.deadlineIso
  };
  const assertion = evaluateCapabilityChangeCandidate(candidate);

  const capability = capabilityForSourceUrl(collection.sourceUrl);
  if (assertion.failures.some(failure => failure.gate === "provenance")) {
    throw new Error(`collection is not an allowed first-party ${collection.vendor} source`);
  }
  if (!assertion.accepted) {
    throw new Error(`collection candidate failed assertion gates: ${assertion.failures.map(failure => `${failure.gate}: ${failure.message}`).join("; ")}`);
  }
  if (!isChangeType(collection.changeType)) throw new Error("collection candidate has an unsupported change type");
  if (!capability || capability.vendor !== collection.vendor || !capability.acceptedIdentifiers.includes(collection.capabilityIdentifier)) {
    throw new Error(`collection candidate is not the supported ${collection.vendor} capability`);
  }

  const artifact = assertVendorNoticeArtifact({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "vendor-notice",
    collection,
    notice: { vendor: capability.vendor, sourceUrl: collection.sourceUrl, retrievedAt: collection.retrievedAt, excerpt: collection.excerpt },
    capabilityChange: {
      vendor: capability.vendor,
      canonicalIdentifier: collection.capabilityIdentifier,
      changeType: collection.changeType,
      deadlineOriginal: collection.deadlineOriginal,
      deadlineIso: collection.deadlineIso
    }
  });
  return { ...artifact, collectorHealth: healthyCollectorHealth(collection.collector) };
}

export function collectSlackNotice(fixturePath: string): VendorNoticeArtifact {
  const artifact = collectVendorNotice(fixturePath);
  if (artifact.notice.vendor !== "Slack") throw new Error("collection fixture is not a Slack notice");
  return artifact;
}

export function collectOpenAINotice(fixturePath: string): VendorNoticeArtifact {
  const artifact = collectVendorNotice(fixturePath);
  if (artifact.notice.vendor !== "OpenAI") throw new Error("collection fixture is not an OpenAI notice");
  return artifact;
}

export function collectCloudflareNotice(fixturePath: string): VendorNoticeArtifact {
  const artifact = collectVendorNotice(fixturePath);
  if (artifact.notice.vendor !== "Cloudflare") throw new Error("collection fixture is not a Cloudflare notice");
  return artifact;
}
