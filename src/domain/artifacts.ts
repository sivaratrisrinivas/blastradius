import { evaluateCapabilityChangeCandidate, explicitDeadlineIso } from "./assertions.js";
import { capabilityForIdentifier, capabilityForSourceUrl, type Vendor } from "./capabilities.js";

export const ARTIFACT_SCHEMA_VERSION = 1 as const;
export const COLLECTION_SCHEMA_VERSION = 1 as const;
export const SLACK_VENDOR_NOTICE_SOURCE_URL = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
export const SLACK_VENDOR_NOTICE_EXCERPT = "The files.upload method stopped functioning on November 12, 2025.";
export const OPENAI_VENDOR_NOTICE_SOURCE_URL = "https://developers.openai.com/api/docs/assistants/migration";
export const OPENAI_VENDOR_NOTICE_EXCERPT = "After achieving feature parity in the Responses API, we've deprecated the Assistants API. It will shut down on August 26, 2026.";
export const CLOUDFLARE_VENDOR_NOTICE_SOURCE_URL = "https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/";
export const CLOUDFLARE_VENDOR_NOTICE_EXCERPT = "The legacy Workers KV API routes under /accounts/{account_id}/workers/namespaces/* are deprecated as of July 15, 2026, and will stop working on October 15, 2026.";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChangeType = "deprecation" | "sunset" | "shutdown" | "removal";

export interface VendorNotice {
  vendor: Vendor;
  sourceUrl: string;
  retrievedAt: string;
  excerpt: string;
}

export interface CollectorIdentity extends JsonObject {
  identity: string;
  version: string;
}

export interface VendorNoticeCollection extends JsonObject {
  schemaVersion: typeof COLLECTION_SCHEMA_VERSION;
  kind: "vendor-notice-collection";
  vendor: Vendor;
  sourceUrl: string;
  retrievedAt: string;
  collector: CollectorIdentity;
  content: string;
  excerpt: string;
  capabilityIdentifier: string;
  changeType: string;
  deadlineOriginal: string;
  deadlineIso: string | null;
}

export interface CapabilityChange {
  vendor: Vendor;
  canonicalIdentifier: string;
  changeType: ChangeType;
  deadlineOriginal: string;
  deadlineIso: string | null;
}

export interface VendorNoticeArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "vendor-notice";
  collection?: VendorNoticeCollection;
  notice: VendorNotice;
  capabilityChange: CapabilityChange;
}

export type EvidenceStrength = "direct" | "alias-traced";
export type MatchContext = "source" | "test" | "example";
export type DeadlineStatus = "upcoming" | "past" | "date-not-stated";

export interface CodeMatch {
  vendor: Vendor;
  capabilityIdentifier: string;
  file: string;
  line: number;
  evidenceStrength: EvidenceStrength;
  context: MatchContext;
  evidence: string;
}

export interface AnalysisLimitation {
  file: string;
  line: number;
  reason: string;
}

export interface Impact {
  capabilityChange: CapabilityChange;
  codeMatches: CodeMatch[];
}

export interface ScanArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "scan-result";
  collection?: VendorNoticeCollection;
  notice: VendorNotice;
  capabilityChange: CapabilityChange;
  codeMatches: CodeMatch[];
  limitations: AnalysisLimitation[];
  impact: Impact | null;
}

export function parseJson(text: string): JsonValue {
  return JSON.parse(text);
}

export function isRecord(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

function isStringValue(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isNumberValue(value: JsonValue): value is number {
  return Object.prototype.toString.call(value) === "[object Number]" && Number.isFinite(value);
}

export function asString(value: JsonValue, field: string): string {
  if (!isStringValue(value) || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asPositiveInteger(value: JsonValue, field: string): number {
  if (!isNumberValue(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

const ALLOWED_CHANGE_TYPES: ReadonlySet<string> = new Set(["deprecation", "sunset", "shutdown", "removal"]);
const ALLOWED_EVIDENCE_STRENGTHS: ReadonlySet<string> = new Set(["direct", "alias-traced"]);
const ALLOWED_CONTEXTS: ReadonlySet<string> = new Set(["source", "test", "example"]);

export function isChangeType(value: string): value is ChangeType {
  return ALLOWED_CHANGE_TYPES.has(value);
}

function isEvidenceStrength(value: string): value is EvidenceStrength {
  return ALLOWED_EVIDENCE_STRENGTHS.has(value);
}

function isMatchContext(value: string): value is MatchContext {
  return ALLOWED_CONTEXTS.has(value);
}

export function isExactDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseNotice(value: JsonValue): VendorNotice {
  if (!isRecord(value)) throw new Error("notice must be an object");
  const vendorValue = asString(value.vendor, "notice.vendor");
  const sourceUrl = asString(value.sourceUrl, "notice.sourceUrl");
  const capability = capabilityForSourceUrl(sourceUrl);
  if (!capability || capability.vendor !== vendorValue) throw new Error(`notice.sourceUrl is not the curated ${vendorValue} source`);
  const vendor = capability.vendor;
  const retrievedAt = asString(value.retrievedAt, "notice.retrievedAt");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("notice.retrievedAt must be an ISO timestamp");
  const excerpt = asString(value.excerpt, "notice.excerpt");
  return { vendor, sourceUrl, retrievedAt, excerpt };
}

function parseCollectorIdentity(value: JsonValue): CollectorIdentity {
  if (!isRecord(value)) throw new Error("collection.collector must be an object");
  return {
    identity: asString(value.identity, "collection.collector.identity"),
    version: asString(value.version, "collection.collector.version")
  };
}

function parseCollection(
  value: JsonValue,
  expectedNotice: VendorNotice,
  expectedChange: CapabilityChange
): VendorNoticeCollection {
  if (!isRecord(value) || value.schemaVersion !== COLLECTION_SCHEMA_VERSION || value.kind !== "vendor-notice-collection") {
    throw new Error("vendor-notice collection has an unsupported schema");
  }
  const vendorValue = asString(value.vendor, "collection.vendor");
  const sourceUrl = asString(value.sourceUrl, "collection.sourceUrl");
  const capability = capabilityForSourceUrl(sourceUrl);
  if (!capability || capability.vendor !== vendorValue) throw new Error("collection.sourceUrl is not a curated first-party source");
  const vendor = capability.vendor;
  const retrievedAt = asString(value.retrievedAt, "collection.retrievedAt");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("collection.retrievedAt must be an ISO timestamp");
  const collector = parseCollectorIdentity(value.collector);
  const content = asString(value.content, "collection.content");
  const excerpt = asString(value.excerpt, "collection.excerpt");
  const capabilityIdentifier = asString(value.capabilityIdentifier, "collection.capabilityIdentifier");
  if (!capability.acceptedIdentifiers.includes(capabilityIdentifier)) throw new Error("collection.capabilityIdentifier is not curated");
  const changeType = asString(value.changeType, "collection.changeType");
  if (!isChangeType(changeType)) throw new Error("collection.changeType is not allowed");
  const deadlineOriginal = asString(value.deadlineOriginal, "collection.deadlineOriginal");
  const deadlineIso = value.deadlineIso === null ? null : asString(value.deadlineIso, "collection.deadlineIso");
  if (vendor !== expectedNotice.vendor || sourceUrl !== expectedNotice.sourceUrl || retrievedAt !== expectedNotice.retrievedAt || excerpt !== expectedNotice.excerpt) {
    throw new Error("collection does not match the VendorNotice");
  }
  if (vendor !== expectedChange.vendor || capabilityIdentifier !== expectedChange.canonicalIdentifier || changeType !== expectedChange.changeType || deadlineOriginal !== expectedChange.deadlineOriginal || deadlineIso !== expectedChange.deadlineIso) {
    throw new Error("collection does not match the CapabilityChange");
  }
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    kind: "vendor-notice-collection",
    vendor,
    sourceUrl,
    retrievedAt,
    collector,
    content,
    excerpt,
    capabilityIdentifier,
    changeType,
    deadlineOriginal,
    deadlineIso
  };
}

function parseCapabilityChange(value: JsonValue, notice?: VendorNotice): CapabilityChange {
  if (!isRecord(value)) throw new Error("capabilityChange must be an object");
  const vendorValue = asString(value.vendor, "capabilityChange.vendor");
  const canonicalIdentifier = asString(value.canonicalIdentifier, "capabilityChange.canonicalIdentifier");
  const capability = capabilityForIdentifier(canonicalIdentifier, vendorValue);
  if (!capability) throw new Error("capabilityChange does not name a curated capability");
  const vendor = capability.vendor;
  if (notice && (notice.vendor !== vendor || notice.sourceUrl !== capability.sourceUrl)) {
    throw new Error("capabilityChange provenance does not match the VendorNotice");
  }
  const changeTypeValue = asString(value.changeType, "capabilityChange.changeType");
  if (!isChangeType(changeTypeValue)) throw new Error("capabilityChange.changeType is not allowed");
  const deadlineOriginal = asString(value.deadlineOriginal, "capabilityChange.deadlineOriginal");
  const deadlineIso = value.deadlineIso === null ? null : asString(value.deadlineIso, "capabilityChange.deadlineIso");
  const expectedDeadlineIso = explicitDeadlineIso(deadlineOriginal);
  if (deadlineIso !== expectedDeadlineIso) {
    throw new Error(expectedDeadlineIso === null
      ? "capabilityChange.deadlineIso must be null when the deadline wording is not an unambiguous full date"
      : "capabilityChange.deadlineIso must match an exact deadline wording");
  }
  if (deadlineIso !== null && !isExactDate(deadlineIso)) throw new Error("capabilityChange.deadlineIso must be a valid exact date");
  return { vendor, canonicalIdentifier, changeType: changeTypeValue, deadlineOriginal, deadlineIso };
}

function assertCapabilityChangeGates(notice: VendorNotice, capabilityChange: CapabilityChange): void {
  const result = evaluateCapabilityChangeCandidate({
    vendor: notice.vendor,
    sourceUrl: notice.sourceUrl,
    retrievedAt: notice.retrievedAt,
    excerpt: notice.excerpt,
    capabilityIdentifier: capabilityChange.canonicalIdentifier,
    changeType: capabilityChange.changeType,
    deadlineOriginal: capabilityChange.deadlineOriginal,
    deadlineIso: capabilityChange.deadlineIso
  });
  if (!result.accepted) {
    throw new Error(`CapabilityChange assertion gates failed: ${result.failures.map(failure => `${failure.gate}: ${failure.message}`).join("; ")}`);
  }
}

function parseCodeMatch(value: JsonValue, expectedChange?: CapabilityChange): CodeMatch {
  if (!isRecord(value)) throw new Error("codeMatch must be an object");
  const vendorValue = asString(value.vendor, "codeMatch.vendor");
  const capabilityIdentifier = asString(value.capabilityIdentifier, "codeMatch.capabilityIdentifier");
  const capability = capabilityForIdentifier(capabilityIdentifier, vendorValue);
  if (!capability) throw new Error("codeMatch provenance does not match a curated capability");
  const vendor = capability.vendor;
  if (expectedChange && (expectedChange.vendor !== vendor || expectedChange.canonicalIdentifier !== capabilityIdentifier)) {
    throw new Error("codeMatch provenance does not match the CapabilityChange");
  }
  const file = asString(value.file, "codeMatch.file");
  if (file.startsWith("/") || file.startsWith("\\") || file.split(/[\\/]/).includes("..")) {
    throw new Error("codeMatch.file must be repository-relative");
  }
  const line = asPositiveInteger(value.line, "codeMatch.line");
  const evidenceStrengthValue = asString(value.evidenceStrength, "codeMatch.evidenceStrength");
  if (!isEvidenceStrength(evidenceStrengthValue)) throw new Error("codeMatch.evidenceStrength is not allowed");
  const contextValue = asString(value.context, "codeMatch.context");
  if (!isMatchContext(contextValue)) throw new Error("codeMatch.context is not allowed");
  return { vendor, capabilityIdentifier, file, line, evidenceStrength: evidenceStrengthValue, context: contextValue, evidence: asString(value.evidence, "codeMatch.evidence") };
}

function parseLimitation(value: JsonValue): AnalysisLimitation {
  if (!isRecord(value)) throw new Error("analysis limitation must be an object");
  return { file: asString(value.file, "analysis limitation.file"), line: asPositiveInteger(value.line, "analysis limitation.line"), reason: asString(value.reason, "analysis limitation.reason") };
}

export function assertVendorNoticeArtifact(value: JsonValue): VendorNoticeArtifact {
  if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.kind !== "vendor-notice") {
    throw new Error("vendor-notice artifact has an unsupported schema");
  }
  if (!isRecord(value.notice) || !isRecord(value.capabilityChange)) {
    throw new Error("vendor-notice artifact is missing notice or capabilityChange");
  }
  const notice = parseNotice(value.notice);
  const capabilityChange = parseCapabilityChange(value.capabilityChange, notice);
  assertCapabilityChangeGates(notice, capabilityChange);
  const collection = value.collection === undefined ? undefined : parseCollection(value.collection, notice, capabilityChange);
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, kind: "vendor-notice", collection, notice, capabilityChange };
}

export function assertScanArtifact(value: JsonValue): ScanArtifact {
  if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.kind !== "scan-result") {
    throw new Error("scan-result artifact has an unsupported schema");
  }
  if (!Array.isArray(value.codeMatches) || !Array.isArray(value.limitations)) {
    throw new Error("scan-result artifact is missing required fields");
  }
  const notice = parseNotice(value.notice);
  const capabilityChange = parseCapabilityChange(value.capabilityChange, notice);
  assertCapabilityChangeGates(notice, capabilityChange);
  const collection = value.collection === undefined ? undefined : parseCollection(value.collection, notice, capabilityChange);
  const codeMatches = value.codeMatches.map(codeMatch => parseCodeMatch(codeMatch, capabilityChange));
  const limitations = value.limitations.map(parseLimitation);
  if (codeMatches.length > 0 && value.impact === null) throw new Error("scan-result with proven CodeMatches must contain an Impact");
  if (codeMatches.length === 0 && value.impact !== null) throw new Error("scan-result without a proven CodeMatch cannot contain an Impact");
  let impact: Impact | null = null;
  if (value.impact !== null) {
    if (!isRecord(value.impact) || !Array.isArray(value.impact.codeMatches)) throw new Error("scan-result impact is malformed");
    const impactChange = parseCapabilityChange(value.impact.capabilityChange, notice);
    const impactMatches = value.impact.codeMatches.map(codeMatch => parseCodeMatch(codeMatch, impactChange));
    if (JSON.stringify(impactChange) !== JSON.stringify(capabilityChange) || JSON.stringify(impactMatches) !== JSON.stringify(codeMatches)) {
      throw new Error("Impact does not exactly match the proven scan result");
    }
    if (impactMatches.length === 0) throw new Error("Impact requires at least one proven CodeMatch");
    impact = { capabilityChange: impactChange, codeMatches: impactMatches };
  }
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, kind: "scan-result", collection, notice, capabilityChange, codeMatches, limitations, impact };
}
