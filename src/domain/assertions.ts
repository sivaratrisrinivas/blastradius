import { curatedSourceForUrl, type CuratedSource } from "./capabilities.js";

export interface CapabilityChangeCandidate {
  vendor: string;
  sourceUrl: string;
  retrievedAt: string;
  excerpt: string;
  capabilityIdentifier: string;
  changeType: string;
  deadlineOriginal: string;
  deadlineIso: string | null;
}

export type AssertionGate = "provenance" | "lifecycle-language" | "capability-identity" | "change-type" | "evidence" | "deadline";

export interface AssertionFailure {
  gate: AssertionGate;
  message: string;
}

export interface CandidateAssertionResult {
  candidate: CapabilityChangeCandidate;
  accepted: boolean;
  failures: AssertionFailure[];
}

const ALLOWED_CHANGE_TYPES = new Set(["deprecation", "sunset", "shutdown", "removal"]);
const LIFECYCLE_LANGUAGE = "(?:deprecat(?:e|ed|es|ing|ion)|sunset(?:s|ting|ted)?|shutdown|shut\\s+down|stop(?:s|ped)?\\s+(?:functioning|working)|cease(?:s|d)?\\s+(?:functioning|working)|remov(?:e|ed|es|ing|al))";
const LIFECYCLE_BRIDGE_WORDS = "(?:method|api|endpoint|will|is|was|has|have|been|be|the|to|for|scheduled|set|marked|being|no|longer)";
const LIFECYCLE_SEPARATOR = "[\\s,;:()\\-]+";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NATURAL_DATE_PATTERN = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/g;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const RANGE_OR_AMBIGUITY_PATTERN = /\b(?:after|before|between|from|through|until|to|or|either|later|earlier|onwards|ongoing|range|starting|beginning|following|prior)\b|[–—]/i;

function isExactIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function naturalDateIso(month: string, day: string, year: string): string | null {
  const monthIndex = MONTH_NAMES.indexOf(month);
  const date = new Date(Date.UTC(Number(year), monthIndex, Number(day)));
  return date.getUTCMonth() === monthIndex && date.getUTCDate() === Number(day)
    ? date.toISOString().slice(0, 10)
    : null;
}

function explicitDateValues(value: string): string[] {
  const naturalDates = [...value.matchAll(NATURAL_DATE_PATTERN)]
    .map(match => naturalDateIso(match[1], match[2], match[3]))
    .filter((date): date is string => date !== null);
  const isoDates = [...value.matchAll(ISO_DATE_PATTERN)]
    .map(match => isExactIsoDate(match[0]) ? match[0] : null)
    .filter((date): date is string => date !== null);
  return [...naturalDates, ...isoDates];
}

export function explicitDeadlineIso(value: string): string | null {
  if (RANGE_OR_AMBIGUITY_PATTERN.test(value)) return null;
  const dates = explicitDateValues(value);
  return dates.length === 1 ? dates[0] : null;
}

function containsExplicitDate(value: string, isoDate: string): boolean {
  if (value.includes(isoDate)) return true;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return false;
  return value.includes(`${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`);
}

function hasRelatedLifecycleEvidence(value: string, source: CuratedSource): boolean {
  const sentences = value.trim().split(/(?<=[.!?])\s+/);
  const escapedIdentifier = source.evidenceIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const relatedLifecycle = source.evidenceProximity === "same-sentence"
    ? new RegExp(`${escapedIdentifier}[^.!?]{0,220}\\s+${LIFECYCLE_LANGUAGE}`, "i")
    : new RegExp(`${escapedIdentifier}(?:${LIFECYCLE_SEPARATOR}${LIFECYCLE_BRIDGE_WORDS}){0,5}${LIFECYCLE_SEPARATOR}${LIFECYCLE_LANGUAGE}`, "i");
  return sentences.some((sentence, index) => {
    if (relatedLifecycle.test(sentence)) return true;
    const nextSentence = sentences[index + 1];
    return sentence.includes(source.evidenceIdentifier) && nextSentence !== undefined &&
      /^(?:it|this|the api)\b[\s\S]*\b(?:deprecat|sunset|shutdown|shut\s+down|remov)/i.test(nextSentence.trim());
  });
}

function addFailure(failures: AssertionFailure[], gate: AssertionGate, message: string): void {
  failures.push({ gate, message });
}

export function evaluateCapabilityChangeCandidate(candidate: CapabilityChangeCandidate): CandidateAssertionResult {
  const failures: AssertionFailure[] = [];
  const curatedSource = curatedSourceForUrl(candidate.sourceUrl);

  if (!curatedSource || candidate.vendor !== curatedSource.vendor) {
    addFailure(failures, "provenance", "source URL and vendor are not in the curated first-party allowlist");
  } else if (Number.isNaN(Date.parse(candidate.retrievedAt))) {
    addFailure(failures, "provenance", "retrievedAt is not a valid timestamp");
  }

  if (curatedSource && !hasRelatedLifecycleEvidence(candidate.excerpt, curatedSource)) {
    addFailure(failures, "lifecycle-language", "supporting excerpt does not tie explicit lifecycle language to the named capability");
  }

  if (curatedSource && !curatedSource.acceptedIdentifiers.includes(candidate.capabilityIdentifier)) {
    addFailure(failures, "capability-identity", "candidate does not name the curated capability identifier");
  }

  if (!ALLOWED_CHANGE_TYPES.has(candidate.changeType)) {
    addFailure(failures, "change-type", "change type is outside deprecation, sunset, shutdown, or removal");
  }

  if (curatedSource && !candidate.excerpt.includes(curatedSource.evidenceIdentifier)) {
    addFailure(failures, "evidence", "supporting excerpt does not identify the affected capability");
  }
  if (candidate.excerpt.trim() === "") {
    addFailure(failures, "evidence", "supporting excerpt must be non-empty");
  }

  const deadlineFromOriginal = explicitDeadlineIso(candidate.deadlineOriginal);
  if (deadlineFromOriginal !== candidate.deadlineIso) {
    addFailure(failures, "deadline", deadlineFromOriginal === null
      ? "deadlineIso must be null when the original wording is partial, relative, ambiguous, or ranged"
      : `deadlineIso must retain the explicit full date ${deadlineFromOriginal}`);
  }
  if (candidate.deadlineIso === null) {
    if (explicitDeadlineIso(candidate.excerpt) !== null) {
      addFailure(failures, "deadline", "deadlineIso does not match the unambiguous date in the supporting evidence");
    }
  } else if (!containsExplicitDate(candidate.excerpt, candidate.deadlineIso)) {
    addFailure(failures, "deadline", "deadlineIso does not match an explicit date in the supporting evidence");
  }

  return { candidate, accepted: failures.length === 0, failures };
}
