import { readFileSync } from "node:fs";
import {
  ARTIFACT_SCHEMA_VERSION,
  COLLECTION_SCHEMA_VERSION,
  assertVendorNoticeArtifact,
  asString,
  isChangeType,
  isRecord,
  parseJson,
  type CollectorIdentity,
  type JsonValue,
  type VendorNoticeArtifact,
  type VendorNoticeCollection
} from "../domain/artifacts.js";
import { evaluateCapabilityChangeCandidate, type CapabilityChangeCandidate } from "../domain/assertions.js";
import { capabilityForSourceUrl } from "../domain/capabilities.js";

export function collectVendorNotice(fixturePath: string): VendorNoticeArtifact {
  let fixture: JsonValue;
  try {
    fixture = parseJson(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(`could not read collection fixture: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(fixture)) throw new Error("collection fixture must be a JSON object");

  const vendor = asString(fixture.vendor, "vendor");
  const sourceUrl = asString(fixture.sourceUrl, "sourceUrl");
  const retrievedAt = asString(fixture.retrievedAt, "retrievedAt");
  const excerpt = asString(fixture.excerpt, "excerpt");
  const capabilityIdentifier = asString(fixture.capabilityIdentifier, "capabilityIdentifier");
  const changeType = asString(fixture.changeType, "changeType");
  const deadlineOriginal = asString(fixture.deadlineOriginal, "deadlineOriginal");
  const deadlineIso = fixture.deadlineIso === null ? null : asString(fixture.deadlineIso, "deadlineIso");
  const sourceCapability = capabilityForSourceUrl(sourceUrl);
  if (!sourceCapability || sourceCapability.vendor !== vendor) {
    throw new Error(`collection fixture is not an allowed first-party ${vendor} source`);
  }
  const collection: VendorNoticeCollection = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    kind: "vendor-notice-collection",
    vendor: sourceCapability.vendor,
    sourceUrl,
    retrievedAt,
    collector: fixture.collector === undefined
      ? { identity: "deterministic-fixture", version: "fixture-v1" }
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
  if (!isRecord(value)) throw new Error("collector must be an object");
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

  return assertVendorNoticeArtifact({
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
