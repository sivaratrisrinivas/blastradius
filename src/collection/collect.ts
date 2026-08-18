import { readFileSync } from "node:fs";
import {
  ARTIFACT_SCHEMA_VERSION,
  assertVendorNoticeArtifact,
  asString,
  isChangeType,
  isRecord,
  parseJson,
  type JsonValue,
  type VendorNoticeArtifact
} from "../domain/artifacts.js";
import { evaluateCapabilityChangeCandidate, type CapabilityChangeCandidate } from "../domain/assertions.js";

export function collectSlackNotice(fixturePath: string): VendorNoticeArtifact {
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
  const candidate: CapabilityChangeCandidate = {
    vendor,
    sourceUrl,
    retrievedAt,
    excerpt,
    capabilityIdentifier,
    changeType,
    deadlineOriginal,
    deadlineIso
  };
  const assertion = evaluateCapabilityChangeCandidate(candidate);

  if (assertion.failures.some(failure => failure.gate === "provenance")) {
    throw new Error("collection fixture is not an allowed first-party Slack source");
  }
  if (!assertion.accepted) {
    throw new Error(`collection candidate failed assertion gates: ${assertion.failures.map(failure => `${failure.gate}: ${failure.message}`).join("; ")}`);
  }
  if (!isChangeType(changeType)) throw new Error("collection candidate has an unsupported change type");
  if (vendor !== "Slack" || capabilityIdentifier !== "slack.files.upload") throw new Error("collection candidate is not the supported Slack capability");

  return assertVendorNoticeArtifact({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "vendor-notice",
    notice: { vendor: "Slack", sourceUrl, retrievedAt, excerpt },
    capabilityChange: {
      vendor: "Slack",
      canonicalIdentifier: "slack.files.upload",
      changeType,
      deadlineOriginal,
      deadlineIso
    }
  });
}
