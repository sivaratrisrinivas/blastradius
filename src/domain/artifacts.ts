export const ARTIFACT_SCHEMA_VERSION = 1 as const;
export const SLACK_VENDOR_NOTICE_SOURCE_URL = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
export const SLACK_VENDOR_NOTICE_EXCERPT = "The files.upload method stopped functioning on November 12, 2025.";

export type ChangeType = "deprecation" | "sunset" | "shutdown" | "removal";

export interface VendorNotice {
  vendor: "Slack";
  sourceUrl: string;
  retrievedAt: string;
  excerpt: string;
}

export interface CapabilityChange {
  vendor: "Slack";
  canonicalIdentifier: "slack.files.upload";
  changeType: ChangeType;
  deadlineOriginal: string;
  deadlineIso: string | null;
}

export interface VendorNoticeArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "vendor-notice";
  notice: VendorNotice;
  capabilityChange: CapabilityChange;
}

export type EvidenceStrength = "direct" | "alias-traced";
export type MatchContext = "source" | "test" | "example";
export type DeadlineStatus = "upcoming" | "past" | "date-not-stated";

export interface CodeMatch {
  vendor: "Slack";
  capabilityIdentifier: "slack.files.upload";
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
  notice: VendorNotice;
  capabilityChange: CapabilityChange;
  codeMatches: CodeMatch[];
  limitations: AnalysisLimitation[];
  impact: Impact | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

const ALLOWED_CHANGE_TYPES = new Set<ChangeType>(["deprecation", "sunset", "shutdown", "removal"]);
const ALLOWED_EVIDENCE_STRENGTHS = new Set<EvidenceStrength>(["direct", "alias-traced"]);
const ALLOWED_CONTEXTS = new Set<MatchContext>(["source", "test", "example"]);

export function isExactDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function explicitDateIso(value: string): string | null {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/.exec(value);
  if (!match) return null;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(match[1]);
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  return date.getUTCMonth() === month && date.getUTCDate() === Number(match[2])
    ? date.toISOString().slice(0, 10)
    : null;
}

function parseNotice(value: unknown): VendorNotice {
  if (!isRecord(value)) throw new Error("notice must be an object");
  if (value.vendor !== "Slack") throw new Error("notice.vendor must be Slack");
  const sourceUrl = asString(value.sourceUrl, "notice.sourceUrl");
  if (sourceUrl !== SLACK_VENDOR_NOTICE_SOURCE_URL) throw new Error("notice.sourceUrl is not the curated Slack source");
  const retrievedAt = asString(value.retrievedAt, "notice.retrievedAt");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("notice.retrievedAt must be an ISO timestamp");
  const excerpt = asString(value.excerpt, "notice.excerpt");
  if (excerpt !== SLACK_VENDOR_NOTICE_EXCERPT) throw new Error("notice.excerpt is not the curated Slack evidence");
  return { vendor: "Slack", sourceUrl, retrievedAt, excerpt };
}

function parseCapabilityChange(value: unknown): CapabilityChange {
  if (!isRecord(value)) throw new Error("capabilityChange must be an object");
  if (value.vendor !== "Slack") throw new Error("capabilityChange.vendor must be Slack");
  if (value.canonicalIdentifier !== "slack.files.upload") {
    throw new Error("capabilityChange.canonicalIdentifier must be slack.files.upload");
  }
  const changeType = asString(value.changeType, "capabilityChange.changeType") as ChangeType;
  if (!ALLOWED_CHANGE_TYPES.has(changeType)) throw new Error("capabilityChange.changeType is not allowed");
  const deadlineOriginal = asString(value.deadlineOriginal, "capabilityChange.deadlineOriginal");
  const deadlineIso = value.deadlineIso === null ? null : asString(value.deadlineIso, "capabilityChange.deadlineIso");
  if (deadlineIso === null) {
    if (explicitDateIso(deadlineOriginal) !== null) throw new Error("exact deadline wording must have deadlineIso");
  } else {
    if (!isExactDate(deadlineIso) || explicitDateIso(deadlineOriginal) === null) {
      throw new Error("capabilityChange.deadlineIso must match an exact deadline wording");
    }
    if (explicitDateIso(deadlineOriginal) !== deadlineIso) {
      throw new Error("capabilityChange.deadlineIso does not match deadlineOriginal");
    }
  }
  return { vendor: "Slack", canonicalIdentifier: "slack.files.upload", changeType, deadlineOriginal, deadlineIso };
}

function parseCodeMatch(value: unknown): CodeMatch {
  if (!isRecord(value)) throw new Error("codeMatch must be an object");
  if (value.vendor !== "Slack" || value.capabilityIdentifier !== "slack.files.upload") {
    throw new Error("codeMatch provenance does not match Slack files.upload");
  }
  const file = asString(value.file, "codeMatch.file");
  if (file.startsWith("/") || file.startsWith("\\") || file.split(/[\\/]/).includes("..")) {
    throw new Error("codeMatch.file must be repository-relative");
  }
  if (!Number.isInteger(value.line) || (value.line as number) < 1) throw new Error("codeMatch.line must be a positive integer");
  const evidenceStrength = asString(value.evidenceStrength, "codeMatch.evidenceStrength") as EvidenceStrength;
  if (!ALLOWED_EVIDENCE_STRENGTHS.has(evidenceStrength)) throw new Error("codeMatch.evidenceStrength is not allowed");
  const context = asString(value.context, "codeMatch.context") as MatchContext;
  if (!ALLOWED_CONTEXTS.has(context)) throw new Error("codeMatch.context is not allowed");
  return { vendor: "Slack", capabilityIdentifier: "slack.files.upload", file, line: value.line as number, evidenceStrength, context, evidence: asString(value.evidence, "codeMatch.evidence") };
}

function parseLimitation(value: unknown): AnalysisLimitation {
  if (!isRecord(value)) throw new Error("analysis limitation must be an object");
  if (!Number.isInteger(value.line) || (value.line as number) < 1) throw new Error("analysis limitation line must be a positive integer");
  return { file: asString(value.file, "analysis limitation.file"), line: value.line as number, reason: asString(value.reason, "analysis limitation.reason") };
}

export function assertVendorNoticeArtifact(value: unknown): VendorNoticeArtifact {
  if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.kind !== "vendor-notice") {
    throw new Error("vendor-notice artifact has an unsupported schema");
  }
  if (!isRecord(value.notice) || !isRecord(value.capabilityChange)) {
    throw new Error("vendor-notice artifact is missing notice or capabilityChange");
  }
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, kind: "vendor-notice", notice: parseNotice(value.notice), capabilityChange: parseCapabilityChange(value.capabilityChange) };
}

export function assertScanArtifact(value: unknown): ScanArtifact {
  if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.kind !== "scan-result") {
    throw new Error("scan-result artifact has an unsupported schema");
  }
  if (!Array.isArray(value.codeMatches) || !Array.isArray(value.limitations)) {
    throw new Error("scan-result artifact is missing required fields");
  }
  const notice = parseNotice(value.notice);
  const capabilityChange = parseCapabilityChange(value.capabilityChange);
  const codeMatches = value.codeMatches.map(parseCodeMatch);
  const limitations = value.limitations.map(parseLimitation);
  let impact: Impact | null = null;
  if (value.impact !== null) {
    if (!isRecord(value.impact) || !Array.isArray(value.impact.codeMatches)) throw new Error("scan-result impact is malformed");
    const impactChange = parseCapabilityChange(value.impact.capabilityChange);
    const impactMatches = value.impact.codeMatches.map(parseCodeMatch);
    if (JSON.stringify(impactChange) !== JSON.stringify(capabilityChange) || JSON.stringify(impactMatches) !== JSON.stringify(codeMatches)) {
      throw new Error("Impact does not exactly match the proven scan result");
    }
    if (impactMatches.length === 0) throw new Error("Impact requires at least one proven CodeMatch");
    impact = { capabilityChange: impactChange, codeMatches: impactMatches };
  }
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, kind: "scan-result", notice, capabilityChange, codeMatches, limitations, impact };
}
