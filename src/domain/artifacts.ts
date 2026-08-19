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

export type CollectorRepairStage = "proposed" | "validation-failed" | "approval-requested" | "activated" | "rerun-failed" | "recovered";
export type CollectorRepairValidationStatus = "not-run" | "passed" | "failed";
export type CollectorRepairApprovalStatus = "not-requested" | "requested" | "approved";
export type CollectorRepairActivationStatus = "not-activated" | "activated";
export type CollectorRepairRerunStatus = "not-run" | "healthy" | "failed";

export interface CollectorRepairArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "collector-repair";
  stage: CollectorRepairStage;
  detected: {
    signal: CollectorHealthSignal;
    collectorHealth: CollectorHealth;
    vendor?: Vendor;
    sourceUrl?: string;
  };
  activeCollector: CollectorIdentity;
  proposedCollector: CollectorIdentity;
  diagnosis: string;
  validation: {
    status: CollectorRepairValidationStatus;
    checks: {
      collectionContract: CollectorHealthCheckState;
      zeroResults: CollectorHealthCheckState;
      requiredFields: CollectorHealthCheckState;
      schema: CollectorHealthCheckState;
    };
    message: string;
  };
  approval: {
    status: CollectorRepairApprovalStatus;
    message: string;
  };
  activation: {
    status: CollectorRepairActivationStatus;
    previousCollector?: CollectorIdentity;
    message: string;
  };
  rerun: {
    status: CollectorRepairRerunStatus;
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
const ALLOWED_REPAIR_STAGES: ReadonlySet<string> = new Set(["proposed", "validation-failed", "approval-requested", "activated", "rerun-failed", "recovered"]);
const ALLOWED_REPAIR_VALIDATION_STATUSES: ReadonlySet<string> = new Set(["not-run", "passed", "failed"]);
const ALLOWED_REPAIR_APPROVAL_STATUSES: ReadonlySet<string> = new Set(["not-requested", "requested", "approved"]);
const ALLOWED_REPAIR_ACTIVATION_STATUSES: ReadonlySet<string> = new Set(["not-activated", "activated"]);
const ALLOWED_REPAIR_RERUN_STATUSES: ReadonlySet<string> = new Set(["not-run", "healthy", "failed"]);
export const HEALTHY_COLLECTOR_HEALTH_MESSAGE = "CollectorHealth: passed zero-results, required-field-collapse, and schema-failure checks only; this does not establish semantic correctness or completeness.";

function isCollectorRepairStage(value: string): value is CollectorRepairStage {
  return ALLOWED_REPAIR_STAGES.has(value);
}

function isCollectorRepairValidationStatus(value: string): value is CollectorRepairValidationStatus {
  return ALLOWED_REPAIR_VALIDATION_STATUSES.has(value);
}

function isCollectorRepairApprovalStatus(value: string): value is CollectorRepairApprovalStatus {
  return ALLOWED_REPAIR_APPROVAL_STATUSES.has(value);
}

function isCollectorRepairActivationStatus(value: string): value is CollectorRepairActivationStatus {
  return ALLOWED_REPAIR_ACTIVATION_STATUSES.has(value);
}

function isCollectorRepairRerunStatus(value: string): value is CollectorRepairRerunStatus {
  return ALLOWED_REPAIR_RERUN_STATUSES.has(value);
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

export function healthyCollectorHealth(collector: CollectorIdentity): CollectorHealth {
  return {
    status: "healthy",
    signal: null,
    collector,
    checks: { zeroResults: "passed", requiredFields: "passed", schema: "passed" },
    message: HEALTHY_COLLECTOR_HEALTH_MESSAGE
  };
}

export function driftedCollectorHealth(
  collector: CollectorIdentity,
  signal: CollectorHealthSignal,
  message: string
): CollectorHealth {
  const checks: CollectorHealth["checks"] = {
    zeroResults: "not-evaluated",
    requiredFields: "not-evaluated",
    schema: "not-evaluated"
  };
  if (signal === "zero-results") checks.zeroResults = "failed";
  if (signal === "required-field-collapse") checks.requiredFields = "failed";
  if (signal === "schema-failure") checks.schema = "failed";
  return { status: "drifted", signal, collector, checks, message };
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
  if (status === "healthy" && (signalValue !== null || zeroResults !== "passed" || requiredFields !== "passed" || schema !== "passed" || message !== HEALTHY_COLLECTOR_HEALTH_MESSAGE)) {
    throw new Error("healthy collectorHealth must pass all supported checks and have no signal");
  }
  if (status === "drifted" && signalValue === null) throw new Error("drifted collectorHealth must identify a signal");
  if (status === "drifted" && signalValue !== null) {
    const failedCheck = signalValue === "zero-results" ? zeroResults : signalValue === "required-field-collapse" ? requiredFields : schema;
    if (failedCheck !== "failed") throw new Error("drifted collectorHealth must fail the reported check");
  }
  return {
    status,
    signal: signalValue,
    collector,
    checks: { zeroResults, requiredFields, schema },
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
    const capability = capabilityForSourceUrl(sourceUrl);
    if (!capability || capability.vendor !== vendorValue) throw new Error("collector-health source is not a curated first-party source");
    vendor = capability.vendor;
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

function sameCollector(left: CollectorIdentity, right: CollectorIdentity): boolean {
  return left.identity === right.identity && left.version === right.version;
}

function parseRepairChecks(value: JsonValue): CollectorRepairArtifact["validation"]["checks"] {
  if (!isRecord(value)) throw new Error("collector-repair validation checks must be an object");
  const collectionContract = asString(value.collectionContract, "collector-repair.validation.checks.collectionContract");
  const zeroResults = asString(value.zeroResults, "collector-repair.validation.checks.zeroResults");
  const requiredFields = asString(value.requiredFields, "collector-repair.validation.checks.requiredFields");
  const schema = asString(value.schema, "collector-repair.validation.checks.schema");
  if (!isCollectorHealthCheckState(collectionContract) || !isCollectorHealthCheckState(zeroResults) || !isCollectorHealthCheckState(requiredFields) || !isCollectorHealthCheckState(schema)) {
    throw new Error("collector-repair validation checks contain an unsupported state");
  }
  return { collectionContract, zeroResults, requiredFields, schema };
}

export function assertCollectorRepairArtifact(value: JsonValue | CollectorRepairArtifact): CollectorRepairArtifact {
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new Error("collector-repair artifact has an unsupported schema");
  }
  // SAFETY: the runtime object check above establishes the record boundary before field validation.
  const record = value as JsonObject;
  if (record.schemaVersion !== ARTIFACT_SCHEMA_VERSION || record.kind !== "collector-repair") {
    throw new Error("collector-repair artifact has an unsupported schema");
  }
  const stageValue = asString(record.stage, "collector-repair.stage");
  if (!isCollectorRepairStage(stageValue)) throw new Error("collector-repair.stage is not allowed");
  if (!isRecord(record.detected)) throw new Error("collector-repair.detected must be an object");
  const activeCollector = parseCollectorIdentity(record.activeCollector);
  const proposedCollector = parseCollectorIdentity(record.proposedCollector);
  const previousCollector = isRecord(record.activation) && record.activation.previousCollector !== undefined
    ? parseCollectorIdentity(record.activation.previousCollector)
    : undefined;
  if (sameCollector(activeCollector, proposedCollector) && !previousCollector) throw new Error("collector-repair proposed collector must differ from the active collector");
  const detectedHealth = parseCollectorHealth(record.detected.collectorHealth, previousCollector ?? activeCollector);
  if (detectedHealth.status !== "drifted" || detectedHealth.signal === null) throw new Error("collector-repair.detected must describe a supported CollectorHealth failure");
  const detectedSignal = asString(record.detected.signal, "collector-repair.detected.signal");
  if (!isCollectorHealthSignal(detectedSignal) || detectedSignal !== detectedHealth.signal) throw new Error("collector-repair.detected.signal must match the detected CollectorHealth signal");
  const diagnosis = asString(record.diagnosis, "collector-repair.diagnosis");

  let detectedVendor: Vendor | undefined;
  let detectedSourceUrl: string | undefined;
  if (record.detected.vendor !== undefined || record.detected.sourceUrl !== undefined) {
    const detectedVendorValue = asString(record.detected.vendor ?? null, "collector-repair.detected.vendor");
    if (detectedVendorValue !== "Slack" && detectedVendorValue !== "OpenAI" && detectedVendorValue !== "Cloudflare") {
      throw new Error("collector-repair detected vendor is not supported");
    }
    detectedVendor = detectedVendorValue;
    detectedSourceUrl = asString(record.detected.sourceUrl ?? null, "collector-repair.detected.sourceUrl");
    const capability = capabilityForSourceUrl(detectedSourceUrl);
    if (!capability || capability.vendor !== detectedVendor) throw new Error("collector-repair detected source is not a curated first-party source");
  }

  if (!isRecord(record.validation)) throw new Error("collector-repair.validation must be an object");
  const validationStatus = asString(record.validation.status, "collector-repair.validation.status");
  if (!isCollectorRepairValidationStatus(validationStatus)) throw new Error("collector-repair.validation.status is not allowed");
  const validationChecks = parseRepairChecks(record.validation.checks);
  const validationMessage = asString(record.validation.message, "collector-repair.validation.message");

  if (!isRecord(record.approval)) throw new Error("collector-repair.approval must be an object");
  const approvalStatus = asString(record.approval.status, "collector-repair.approval.status");
  if (!isCollectorRepairApprovalStatus(approvalStatus)) throw new Error("collector-repair.approval.status is not allowed");
  const approvalMessage = asString(record.approval.message, "collector-repair.approval.message");

  if (!isRecord(record.activation)) throw new Error("collector-repair.activation must be an object");
  const activationStatus = asString(record.activation.status, "collector-repair.activation.status");
  if (!isCollectorRepairActivationStatus(activationStatus)) throw new Error("collector-repair.activation.status is not allowed");
  const activationMessage = asString(record.activation.message, "collector-repair.activation.message");

  if (!isRecord(record.rerun)) throw new Error("collector-repair.rerun must be an object");
  const rerunStatus = asString(record.rerun.status, "collector-repair.rerun.status");
  if (!isCollectorRepairRerunStatus(rerunStatus)) throw new Error("collector-repair.rerun.status is not allowed");
  const rerunHealth = record.rerun.collectorHealth === undefined ? undefined : parseCollectorHealth(record.rerun.collectorHealth, activeCollector);
  const rerunMessage = asString(record.rerun.message, "collector-repair.rerun.message");

  const checksPassed = Object.values(validationChecks).every(check => check === "passed");
  if (validationStatus === "passed" && !checksPassed) throw new Error("passed collector-repair validation must pass the collection contract and supported health checks");
  if (validationStatus !== "passed" && checksPassed) throw new Error("collector-repair validation checks cannot all pass without passed validation");
  if ((approvalStatus === "requested" || approvalStatus === "approved") && validationStatus !== "passed") {
    throw new Error("collector-repair approval requires passed validation");
  }
  if (approvalStatus === "approved" && activationStatus !== "activated") throw new Error("approved collector-repair must be activated");
  if (activationStatus === "activated") {
    if (approvalStatus !== "approved" || !previousCollector || !sameCollector(previousCollector, detectedHealth.collector) || !sameCollector(activeCollector, proposedCollector)) {
      throw new Error("activated collector-repair must retain the previous collector and activate the proposed collector");
    }
  } else if (!sameCollector(activeCollector, detectedHealth.collector)) {
    throw new Error("collector-repair must retain the detected collector until activation");
  }
  if (rerunStatus === "healthy" && (activationStatus !== "activated" || !rerunHealth || rerunHealth.status !== "healthy" || !sameCollector(rerunHealth.collector, activeCollector))) {
    throw new Error("healthy collector-repair rerun requires an activated collector and healthy matching health record");
  }
  if (stageValue === "proposed" && (validationStatus !== "not-run" || approvalStatus !== "not-requested" || activationStatus !== "not-activated" || rerunStatus !== "not-run")) {
    throw new Error("proposed collector-repair has advanced state");
  }
  if (stageValue === "validation-failed" && (validationStatus !== "failed" || approvalStatus !== "not-requested" || activationStatus !== "not-activated" || rerunStatus !== "not-run")) {
    throw new Error("failed collector-repair validation has invalid state");
  }
  if (stageValue === "approval-requested" && (validationStatus !== "passed" || approvalStatus !== "requested" || activationStatus !== "not-activated" || rerunStatus !== "not-run")) {
    throw new Error("collector-repair approval request has invalid state");
  }
  if (stageValue === "activated" && (activationStatus !== "activated" || rerunStatus !== "not-run")) {
    throw new Error("activated collector-repair has invalid state");
  }
  if (stageValue === "rerun-failed" && (activationStatus !== "activated" || rerunStatus !== "failed")) {
    throw new Error("failed collector-repair rerun has invalid state");
  }
  if (stageValue === "recovered" && (activationStatus !== "activated" || rerunStatus !== "healthy")) {
    throw new Error("recovered collector-repair has invalid state");
  }

  const detected: CollectorRepairArtifact["detected"] = {
    signal: detectedSignal,
    collectorHealth: detectedHealth
  };
  if (detectedVendor !== undefined) detected.vendor = detectedVendor;
  if (detectedSourceUrl !== undefined) detected.sourceUrl = detectedSourceUrl;
  const activation: CollectorRepairArtifact["activation"] = {
    status: activationStatus,
    message: activationMessage
  };
  if (previousCollector !== undefined) activation.previousCollector = previousCollector;
  const rerun: CollectorRepairArtifact["rerun"] = {
    status: rerunStatus,
    message: rerunMessage
  };
  if (rerunHealth !== undefined) rerun.collectorHealth = rerunHealth;
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "collector-repair",
    stage: stageValue,
    detected,
    activeCollector,
    proposedCollector,
    diagnosis,
    validation: {
      status: validationStatus,
      checks: validationChecks,
      message: validationMessage
    },
    approval: { status: approvalStatus, message: approvalMessage },
    activation,
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
