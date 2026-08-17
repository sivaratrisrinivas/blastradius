import { readFileSync } from "node:fs";
import {
  ARTIFACT_SCHEMA_VERSION,
  assertVendorNoticeArtifact,
  asString,
  isChangeType,
  isRecord,
  isExactDate,
  parseJson,
  SLACK_VENDOR_NOTICE_EXCERPT,
  SLACK_VENDOR_NOTICE_SOURCE_URL,
  type JsonValue,
  type VendorNoticeArtifact
} from "../domain/artifacts.js";

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
  const changeTypeValue = asString(fixture.changeType, "changeType");
  if (!isChangeType(changeTypeValue)) throw new Error("collection fixture has an unsupported change type");
  const deadlineOriginal = asString(fixture.deadlineOriginal, "deadlineOriginal");
  const deadlineIso = fixture.deadlineIso === null ? null : asString(fixture.deadlineIso, "deadlineIso");

  if (vendor !== "Slack" || sourceUrl !== SLACK_VENDOR_NOTICE_SOURCE_URL) {
    throw new Error("collection fixture is not an allowed first-party Slack source");
  }
  if (excerpt !== SLACK_VENDOR_NOTICE_EXCERPT) throw new Error("collection excerpt is not the committed verbatim Slack evidence");
  if (capabilityIdentifier !== "slack.files.upload") {
    throw new Error("collection fixture does not name Slack files.upload");
  }
  if (changeTypeValue !== "shutdown" || deadlineIso === null || !isExactDate(deadlineIso)) {
    throw new Error("collection fixture does not contain an allowed change and exact deadline");
  }

  return assertVendorNoticeArtifact({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "vendor-notice",
    notice: { vendor: "Slack", sourceUrl, retrievedAt, excerpt },
    capabilityChange: {
      vendor: "Slack",
      canonicalIdentifier: "slack.files.upload",
      changeType: changeTypeValue,
      deadlineOriginal,
      deadlineIso
    }
  });
}
