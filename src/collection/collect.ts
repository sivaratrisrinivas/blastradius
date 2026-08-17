import { readFileSync } from "node:fs";
import {
  ARTIFACT_SCHEMA_VERSION,
  assertVendorNoticeArtifact,
  asString,
  isRecord,
  type ChangeType,
  type VendorNoticeArtifact
} from "../domain/artifacts.js";

const SLACK_SOURCE_PREFIX = "https://docs.slack.dev/";

function exactDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function collectSlackNotice(fixturePath: string): VendorNoticeArtifact {
  let fixture: unknown;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(`could not read collection fixture: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(fixture)) throw new Error("collection fixture must be a JSON object");

  const vendor = asString(fixture.vendor, "vendor");
  const sourceUrl = asString(fixture.sourceUrl, "sourceUrl");
  const retrievedAt = asString(fixture.retrievedAt, "retrievedAt");
  const excerpt = asString(fixture.excerpt, "excerpt");
  const capabilityIdentifier = asString(fixture.capabilityIdentifier, "capabilityIdentifier");
  const changeType = asString(fixture.changeType, "changeType") as ChangeType;
  const deadlineOriginal = asString(fixture.deadlineOriginal, "deadlineOriginal");
  const deadlineIso = asString(fixture.deadlineIso, "deadlineIso");

  if (vendor !== "Slack" || !sourceUrl.startsWith(SLACK_SOURCE_PREFIX)) {
    throw new Error("collection fixture is not an allowed first-party Slack source");
  }
  if (!excerpt.includes("files.upload") || !/stopped functioning|deprecat|sunset|shut down|shutdown|remov/i.test(excerpt)) {
    throw new Error("collection excerpt does not prove an allowed lifecycle change");
  }
  if (capabilityIdentifier !== "slack.files.upload") {
    throw new Error("collection fixture does not name Slack files.upload");
  }
  if (changeType !== "shutdown" || !exactDate(deadlineIso)) {
    throw new Error("collection fixture does not contain an allowed change and exact deadline");
  }

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
