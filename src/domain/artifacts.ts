import { evaluateCapabilityChangeCandidate, explicitDeadlineIso } from "./assertions.js";
import { curatedSourceForIdentifier, curatedSourceForUrl, type Vendor } from "./capabilities.js";

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

/** Bright Data caps a self-healing prompt at 1000 characters; verified against the live API. */
export const HEAL_PROMPT_MAX_LENGTH = 1000;

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

export type CollectorHealthSignal = "zero-results" | "required-field-collapse" | "schema-failure";
export type CollectorHealthCheckState = "passed" | "failed" | "not-evaluated";

export interface CollectorHealth {
  status: "healthy" | "drifted";
  signal: CollectorHealthSignal | null;
  collector: CollectorIdentity;
  checks: {
    zeroResults: CollectorHealthCheckState;
    requiredFields: CollectorHealthCheckState;
    schema: CollectorHealthCheckState;
  };
  /**
   * Collector output fields the signal names, so a CollectorHeal prompt can name them without
   * re-parsing the prose message. Empty when the signal is not about specific fields.
   */
  fields: readonly string[];
  message: string;
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
  collectorHealth?: CollectorHealth;
  notice: VendorNotice;
  capabilityChange: CapabilityChange;
}

export interface CollectorHealthArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "collector-health";
  collectorHealth: CollectorHealth;
  vendor?: Vendor;
  sourceUrl?: string;
}

export type CollectorHealStage = "detected" | "awaiting-approval" | "approved" | "rejected" | "rerun-failed" | "rerun-healthy";
export type CollectorHealApprovalStatus = "not-requested" | "requested" | "approved" | "rejected";
export type CollectorHealRerunStatus = "not-run" | "healthy" | "failed";

/** Whether the heal evidence came from a live Bright Data call or from a recorded response. */
export type CollectorHealSource = "not-requested" | "bright-data" | "recorded";

/** The human-legible half of a Bright Data refactor: `steps[0].parse_code` before and after. */
export interface CollectorHealDiff {
  parseCodeBefore: string;
  parseCodeAfter: string;
}

export interface CollectorHealArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "collector-heal";
  stage: CollectorHealStage;
  detected: {
    signal: CollectorHealthSignal;
    collectorHealth: CollectorHealth;
    vendor?: Vendor;
    sourceUrl?: string;
  };
  /** Healing moves a collector's template, never its identity: this is the same collector throughout. */
  collector: CollectorIdentity;
  diagnosis: string;
  prompt: {
    text: string;
    fields: readonly string[];
  };
  heal: {
    source: CollectorHealSource;
    jobId: string | null;
    completedSteps: readonly string[];
    diff: CollectorHealDiff | null;
    message: string;
  };
  approval: {
    status: CollectorHealApprovalStatus;
    message: string;
  };
  rerun: {
    status: CollectorHealRerunStatus;
    collectorHealth?: CollectorHealth;
    message: string;
  };
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
  collectorHealth?: CollectorHealth;
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

export function isStringValue(value: JsonValue): value is string {
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
const ALLOWED_HEALTH_SIGNALS: ReadonlySet<string> = new Set(["zero-results", "required-field-collapse", "schema-failure"]);
const ALLOWED_HEALTH_STATES: ReadonlySet<string> = new Set(["passed", "failed", "not-evaluated"]);
const ALLOWED_HEAL_STAGES: ReadonlySet<string> = new Set(["detected", "awaiting-approval", "approved", "rejected", "rerun-failed", "rerun-healthy"]);
const ALLOWED_HEAL_APPROVAL_STATUSES: ReadonlySet<string> = new Set(["not-requested", "requested", "approved", "rejected"]);
const ALLOWED_HEAL_SOURCES: ReadonlySet<string> = new Set(["not-requested", "bright-data", "recorded"]);
const ALLOWED_HEAL_RERUN_STATUSES: ReadonlySet<string> = new Set(["not-run", "healthy", "failed"]);
export const HEALTHY_COLLECTOR_HEALTH_MESSAGE = "CollectorHealth: passed zero-results, required-field-collapse, and schema-failure checks only; this does not establish semantic correctness or completeness.";

function isCollectorHealStage(value: string): value is CollectorHealStage {
  return ALLOWED_HEAL_STAGES.has(value);
}

function isCollectorHealApprovalStatus(value: string): value is CollectorHealApprovalStatus {
  return ALLOWED_HEAL_APPROVAL_STATUSES.has(value);
}

function isCollectorHealSource(value: string): value is CollectorHealSource {
  return ALLOWED_HEAL_SOURCES.has(value);
}

function isCollectorHealRerunStatus(value: string): value is CollectorHealRerunStatus {
  return ALLOWED_HEAL_RERUN_STATUSES.has(value);
}

export function isChangeType(value: string): value is ChangeType {
  return ALLOWED_CHANGE_TYPES.has(value);
}

function isEvidenceStrength(value: string): value is EvidenceStrength {
  return ALLOWED_EVIDENCE_STRENGTHS.has(value);
}

function isMatchContext(value: string): value is MatchContext {
  return ALLOWED_CONTEXTS.has(value);
}

function isCollectorHealthSignal(value: string): value is CollectorHealthSignal {
  return ALLOWED_HEALTH_SIGNALS.has(value);
}

function isCollectorHealthCheckState(value: string): value is CollectorHealthCheckState {
  return ALLOWED_HEALTH_STATES.has(value);
}

/** The canonical display form for a collector, shared by the CLI, the workflow and the report. */
export function collectorLabel(collector: CollectorIdentity): string {
  return `${collector.identity}@${collector.version}`;
}

export function healthyCollectorHealth(collector: CollectorIdentity): CollectorHealth {
  return {
    status: "healthy",
    signal: null,
    collector,
    checks: { zeroResults: "passed", requiredFields: "passed", schema: "passed" },
    fields: [],
    message: HEALTHY_COLLECTOR_HEALTH_MESSAGE
  };
}

export function driftedCollectorHealth(
  collector: CollectorIdentity,
  signal: CollectorHealthSignal,
  message: string,
  fields: readonly string[] = []
): CollectorHealth {
  const checks: CollectorHealth["checks"] = {
    zeroResults: "not-evaluated",
    requiredFields: "not-evaluated",
    schema: "not-evaluated"
  };
  if (signal === "zero-results") checks.zeroResults = "failed";
  if (signal === "required-field-collapse") checks.requiredFields = "failed";
  if (signal === "schema-failure") checks.schema = "failed";
  return { status: "drifted", signal, collector, checks, fields: [...fields], message };
}

export function collectorHealthArtifact(
  collectorHealth: CollectorHealth,
  vendor?: Vendor,
  sourceUrl?: string
): CollectorHealthArtifact {
  const artifact: CollectorHealthArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "collector-health",
    collectorHealth
  };
  if (vendor) artifact.vendor = vendor;
  if (sourceUrl) artifact.sourceUrl = sourceUrl;
  return artifact;
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
  const curatedSource = curatedSourceForUrl(sourceUrl);
  if (!curatedSource || curatedSource.vendor !== vendorValue) throw new Error(`notice.sourceUrl is not the curated ${vendorValue} source`);
  const vendor = curatedSource.vendor;
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

function parseCollectorHealth(value: JsonValue, expectedCollector?: CollectorIdentity): CollectorHealth {
  if (!isRecord(value)) throw new Error("collectorHealth must be an object");
  const status = asString(value.status, "collectorHealth.status");
  if (status !== "healthy" && status !== "drifted") throw new Error("collectorHealth.status is not allowed");
  const signalValue = value.signal === null ? null : asString(value.signal, "collectorHealth.signal");
  if (signalValue !== null && !isCollectorHealthSignal(signalValue)) throw new Error("collectorHealth.signal is not allowed");
  if (!isRecord(value.checks)) throw new Error("collectorHealth.checks must be an object");
  const zeroResults = asString(value.checks.zeroResults, "collectorHealth.checks.zeroResults");
  const requiredFields = asString(value.checks.requiredFields, "collectorHealth.checks.requiredFields");
  const schema = asString(value.checks.schema, "collectorHealth.checks.schema");
  if (!isCollectorHealthCheckState(zeroResults) || !isCollectorHealthCheckState(requiredFields) || !isCollectorHealthCheckState(schema)) {
    throw new Error("collectorHealth.checks contains an unsupported state");
  }
  const collector = parseCollectorIdentity(value.collector);
  if (expectedCollector && (collector.identity !== expectedCollector.identity || collector.version !== expectedCollector.version)) {
    throw new Error("collectorHealth does not match the collection collector");
  }
  const message = asString(value.message, "collectorHealth.message");
  if (!Array.isArray(value.fields)) throw new Error("collectorHealth.fields must be an array");
  const fields = value.fields.map((field, index) => asString(field, `collectorHealth.fields[${index}]`));
  if (status === "healthy" && (signalValue !== null || zeroResults !== "passed" || requiredFields !== "passed" || schema !== "passed" || message !== HEALTHY_COLLECTOR_HEALTH_MESSAGE)) {
    throw new Error("healthy collectorHealth must pass all supported checks and have no signal");
  }
  if (status === "healthy" && fields.length > 0) throw new Error("healthy collectorHealth cannot name failed fields");
  if (status === "drifted" && signalValue === null) throw new Error("drifted collectorHealth must identify a signal");
  if (status === "drifted" && signalValue !== null) {
    const failedCheck = signalValue === "zero-results" ? zeroResults : signalValue === "required-field-collapse" ? requiredFields : schema;
    if (failedCheck !== "failed") throw new Error("drifted collectorHealth must fail the reported check");
  }
  if (signalValue === "zero-results" && fields.length > 0) throw new Error("a zero-results signal cannot name failed fields");
  return {
    status,
    signal: signalValue,
    collector,
    checks: { zeroResults, requiredFields, schema },
    fields,
    message
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
  const curatedSource = curatedSourceForUrl(sourceUrl);
  if (!curatedSource || curatedSource.vendor !== vendorValue) throw new Error("collection.sourceUrl is not a curated first-party source");
  const vendor = curatedSource.vendor;
  const retrievedAt = asString(value.retrievedAt, "collection.retrievedAt");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("collection.retrievedAt must be an ISO timestamp");
  const collector = parseCollectorIdentity(value.collector);
  const content = asString(value.content, "collection.content");
  const excerpt = asString(value.excerpt, "collection.excerpt");
  const capabilityIdentifier = asString(value.capabilityIdentifier, "collection.capabilityIdentifier");
  if (!curatedSource.acceptedIdentifiers.includes(capabilityIdentifier)) throw new Error("collection.capabilityIdentifier is not curated");
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
  const curatedSource = curatedSourceForIdentifier(canonicalIdentifier, vendorValue);
  if (!curatedSource) throw new Error("capabilityChange does not name a curated capability");
  const vendor = curatedSource.vendor;
  if (notice && (notice.vendor !== vendor || notice.sourceUrl !== curatedSource.sourceUrl)) {
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
  const curatedSource = curatedSourceForIdentifier(capabilityIdentifier, vendorValue);
  if (!curatedSource) throw new Error("codeMatch provenance does not match a curated capability");
  // A WatchedVendor has no matcher, so no CodeMatch against it can have been proved. Artifacts are
  // read off disk, so this boundary refuses one even though the scanner would never emit it.
  if (curatedSource.matcher === null) throw new Error("codeMatch names a WatchedVendor, which has no repository matcher and can never produce an Impact");
  const vendor = curatedSource.vendor;
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
  const collectorHealth = value.collectorHealth === undefined
    ? undefined
    : parseCollectorHealth(value.collectorHealth, collection?.collector);
  if (collectorHealth?.status === "drifted") throw new Error(`drifted CollectorHealth output cannot be scanned or treated as a VendorNotice (${collectorHealth.signal})`);
  const artifact: VendorNoticeArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "vendor-notice",
    collection,
    notice,
    capabilityChange
  };
  if (collectorHealth) artifact.collectorHealth = collectorHealth;
  return artifact;
}

export function assertCollectorHealthArtifact(value: JsonValue): CollectorHealthArtifact {
  if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.kind !== "collector-health") {
    throw new Error("collector-health artifact has an unsupported schema");
  }
  const collectorHealth = parseCollectorHealth(value.collectorHealth);
  if (collectorHealth.status !== "drifted") throw new Error("collector-health artifact must describe drift");
  let vendor: Vendor | undefined;
  let sourceUrl: string | undefined;
  if (value.vendor !== undefined || value.sourceUrl !== undefined) {
    const vendorValue = asString(value.vendor ?? null, "collector-health.vendor");
    sourceUrl = asString(value.sourceUrl ?? null, "collector-health.sourceUrl");
    const curatedSource = curatedSourceForUrl(sourceUrl);
    if (!curatedSource || curatedSource.vendor !== vendorValue) throw new Error("collector-health source is not a curated first-party source");
    vendor = curatedSource.vendor;
  }
  const artifact: CollectorHealthArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "collector-health",
    collectorHealth
  };
  if (vendor) artifact.vendor = vendor;
  if (sourceUrl) artifact.sourceUrl = sourceUrl;
  return artifact;
}

function parseHealDiff(value: JsonValue): CollectorHealDiff {
  if (!isRecord(value)) throw new Error("collector-heal.heal.diff must be an object");
  return {
    parseCodeBefore: asString(value.parseCodeBefore, "collector-heal.heal.diff.parseCodeBefore"),
    parseCodeAfter: asString(value.parseCodeAfter, "collector-heal.heal.diff.parseCodeAfter")
  };
}

function parseStringArray(value: JsonValue, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => asString(entry, `${field}[${index}]`));
}

export function assertCollectorHealArtifact(value: JsonValue | CollectorHealArtifact): CollectorHealArtifact {
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new Error("collector-heal artifact has an unsupported schema");
  }
  // SAFETY: the runtime object check above establishes the record boundary before field validation.
  const record = value as JsonObject;
  if (record.schemaVersion !== ARTIFACT_SCHEMA_VERSION || record.kind !== "collector-heal") {
    throw new Error("collector-heal artifact has an unsupported schema");
  }
  const stage = asString(record.stage, "collector-heal.stage");
  if (!isCollectorHealStage(stage)) throw new Error("collector-heal.stage is not allowed");

  if (!isRecord(record.detected)) throw new Error("collector-heal.detected must be an object");
  const collector = parseCollectorIdentity(record.collector);
  const detectedHealth = parseCollectorHealth(record.detected.collectorHealth, collector);
  if (detectedHealth.status !== "drifted" || detectedHealth.signal === null) {
    throw new Error("collector-heal.detected must describe a supported CollectorHealth failure");
  }
  const detectedSignal = asString(record.detected.signal, "collector-heal.detected.signal");
  if (!isCollectorHealthSignal(detectedSignal) || detectedSignal !== detectedHealth.signal) {
    throw new Error("collector-heal.detected.signal must match the detected CollectorHealth signal");
  }
  let detectedVendor: Vendor | undefined;
  let detectedSourceUrl: string | undefined;
  if (record.detected.vendor !== undefined || record.detected.sourceUrl !== undefined) {
    const detectedVendorValue = asString(record.detected.vendor ?? null, "collector-heal.detected.vendor");
    detectedSourceUrl = asString(record.detected.sourceUrl ?? null, "collector-heal.detected.sourceUrl");
    const curatedSource = curatedSourceForUrl(detectedSourceUrl);
    if (!curatedSource || curatedSource.vendor !== detectedVendorValue) throw new Error("collector-heal detected source is not a curated first-party source");
    detectedVendor = curatedSource.vendor;
  }
  const diagnosis = asString(record.diagnosis, "collector-heal.diagnosis");

  if (!isRecord(record.prompt)) throw new Error("collector-heal.prompt must be an object");
  const promptText = asString(record.prompt.text, "collector-heal.prompt.text");
  if (promptText.length > HEAL_PROMPT_MAX_LENGTH) {
    throw new Error(`collector-heal.prompt.text exceeds the ${HEAL_PROMPT_MAX_LENGTH} character Bright Data limit`);
  }
  const promptFields = parseStringArray(record.prompt.fields, "collector-heal.prompt.fields");
  if (promptFields.join(" ") !== detectedHealth.fields.join(" ")) {
    throw new Error("collector-heal.prompt.fields must be the fields the detected CollectorHealth names");
  }
  for (const field of promptFields) {
    if (!promptText.includes(field)) throw new Error(`collector-heal.prompt.text must name the collapsed field ${field}`);
  }

  if (!isRecord(record.heal)) throw new Error("collector-heal.heal must be an object");
  const healSource = asString(record.heal.source, "collector-heal.heal.source");
  if (!isCollectorHealSource(healSource)) throw new Error("collector-heal.heal.source is not allowed");
  const jobId = record.heal.jobId === null ? null : asString(record.heal.jobId, "collector-heal.heal.jobId");
  const completedSteps = parseStringArray(record.heal.completedSteps, "collector-heal.heal.completedSteps");
  const diff = record.heal.diff === null ? null : parseHealDiff(record.heal.diff);
  const healMessage = asString(record.heal.message, "collector-heal.heal.message");

  if (!isRecord(record.approval)) throw new Error("collector-heal.approval must be an object");
  const approvalStatus = asString(record.approval.status, "collector-heal.approval.status");
  if (!isCollectorHealApprovalStatus(approvalStatus)) throw new Error("collector-heal.approval.status is not allowed");
  const approvalMessage = asString(record.approval.message, "collector-heal.approval.message");

  if (!isRecord(record.rerun)) throw new Error("collector-heal.rerun must be an object");
  const rerunStatus = asString(record.rerun.status, "collector-heal.rerun.status");
  if (!isCollectorHealRerunStatus(rerunStatus)) throw new Error("collector-heal.rerun.status is not allowed");
  const rerunHealth = record.rerun.collectorHealth === undefined ? undefined : parseCollectorHealth(record.rerun.collectorHealth, collector);
  const rerunMessage = asString(record.rerun.message, "collector-heal.rerun.message");

  const healRequested = stage !== "detected";
  if (healRequested === (healSource === "not-requested")) {
    throw new Error("collector-heal.heal.source must record how the heal evidence was obtained once a heal has run");
  }
  if (healRequested && (diff === null || jobId === null || completedSteps.length === 0)) {
    throw new Error("a collector-heal past detection must carry the Bright Data job, its completed steps, and the reviewed diff");
  }
  if (!healRequested && (diff !== null || jobId !== null || completedSteps.length > 0)) {
    throw new Error("a detected collector-heal cannot carry heal evidence before the heal runs");
  }

  const expectedApproval = {
    "detected": "not-requested",
    "awaiting-approval": "requested",
    "approved": "approved",
    "rejected": "rejected",
    "rerun-healthy": "approved",
    "rerun-failed": "approved"
  } satisfies Record<CollectorHealStage, CollectorHealApprovalStatus>;
  if (approvalStatus !== expectedApproval[stage]) {
    throw new Error(`collector-heal stage ${stage} requires approval status ${expectedApproval[stage]}`);
  }

  const expectedRerun = {
    "detected": "not-run",
    "awaiting-approval": "not-run",
    "approved": "not-run",
    "rejected": "not-run",
    "rerun-healthy": "healthy",
    "rerun-failed": "failed"
  } satisfies Record<CollectorHealStage, CollectorHealRerunStatus>;
  if (rerunStatus !== expectedRerun[stage]) {
    throw new Error(`collector-heal stage ${stage} requires rerun status ${expectedRerun[stage]}`);
  }
  if (rerunStatus === "healthy" && (!rerunHealth || rerunHealth.status !== "healthy")) {
    throw new Error("a healthy collector-heal rerun requires a healthy rerun health record for the same collector");
  }

  const detected: CollectorHealArtifact["detected"] = {
    signal: detectedSignal,
    collectorHealth: detectedHealth
  };
  if (detectedVendor !== undefined) detected.vendor = detectedVendor;
  if (detectedSourceUrl !== undefined) detected.sourceUrl = detectedSourceUrl;
  const rerun: CollectorHealArtifact["rerun"] = { status: rerunStatus, message: rerunMessage };
  if (rerunHealth !== undefined) rerun.collectorHealth = rerunHealth;
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "collector-heal",
    stage,
    detected,
    collector,
    diagnosis,
    prompt: { text: promptText, fields: promptFields },
    heal: { source: healSource, jobId, completedSteps, diff, message: healMessage },
    approval: { status: approvalStatus, message: approvalMessage },
    rerun
  };
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
  const collectorHealth = value.collectorHealth === undefined
    ? undefined
    : parseCollectorHealth(value.collectorHealth, collection?.collector);
  if (collectorHealth?.status === "drifted") throw new Error("drifted CollectorHealth output cannot be rendered as a confirmed Impact");
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
  const artifact: ScanArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "scan-result",
    collection,
    notice,
    capabilityChange,
    codeMatches,
    limitations,
    impact
  };
  if (collectorHealth) artifact.collectorHealth = collectorHealth;
  return artifact;
}
