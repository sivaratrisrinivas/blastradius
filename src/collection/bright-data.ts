import { existsSync, readFileSync } from "node:fs";
import {
  COLLECTION_SCHEMA_VERSION,
  asString,
  isRecord,
  isStringValue,
  parseJson,
  type JsonObject,
  type JsonValue,
  type VendorNoticeArtifact,
  type VendorNoticeCollection
} from "../domain/artifacts.js";
import { capabilityForSourceUrl, type Vendor } from "../domain/capabilities.js";
import { collectorHealthError } from "../domain/collector-health.js";
import { vendorNoticeArtifactFromCollection } from "./collect.js";

const DEFAULT_API_BASE_URL = "https://api.brightdata.com";
const DEFAULT_COLLECTOR_VERSION = "production";
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export interface CollectionRequest {
  vendor: Vendor;
  sourceUrl: string;
}

export interface BrightDataConfig {
  apiKey: string;
  collectorId: string;
  collectorVersion: string;
  apiBaseUrl: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

type Sleep = (milliseconds: number) => Promise<void>;

class BrightDataSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BrightDataSchemaError";
  }
}

function valueFrom(record: JsonObject, ...names: string[]): JsonValue | undefined {
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }
  return undefined;
}

function requiredField(record: JsonObject, field: string, ...aliases: string[]): string {
  const value = valueFrom(record, field, ...aliases);
  return asString(value ?? null, `Bright Data record ${field}`);
}

function optionalField(record: JsonObject, fallback: string, field: string, ...aliases: string[]): string {
  const value = valueFrom(record, field, ...aliases);
  return value === undefined ? fallback : asString(value, `Bright Data record ${field}`);
}

function parseDeadlineIso(record: JsonObject): string | null {
  const value = valueFrom(record, "deadlineIso", "deadline_iso");
  if (value === undefined || value === null) return null;
  const deadlineIso = asString(value, "Bright Data record deadlineIso");
  const midnightTimestamp = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.\d{3})?Z$/.exec(deadlineIso);
  return midnightTimestamp?.[1] ?? deadlineIso;
}

function normalizedApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function positiveInteger(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function environmentValue(environment: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function brightDataConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): BrightDataConfig {
  const apiKey = environmentValue(environment, "BRIGHTDATA_API_KEY", "BRIGHT_DATA_API_TOKEN");
  const collectorId = environmentValue(environment, "BRIGHTDATA_COLLECTOR_ID", "BRIGHT_DATA_COLLECTOR_ID");
  if (!apiKey) throw new Error("Bright Data configuration is missing BRIGHTDATA_API_KEY");
  if (!collectorId) throw new Error("Bright Data configuration is missing BRIGHTDATA_COLLECTOR_ID");
  if (!/^c_[A-Za-z0-9_-]+$/.test(collectorId)) throw new Error("Bright Data collector ID must start with c_");
  return {
    apiKey,
    collectorId,
    collectorVersion: environmentValue(environment, "BRIGHTDATA_COLLECTOR_VERSION", "BRIGHT_DATA_COLLECTOR_VERSION") ?? DEFAULT_COLLECTOR_VERSION,
    apiBaseUrl: normalizedApiBaseUrl(environmentValue(environment, "BRIGHTDATA_API_BASE_URL", "BRIGHT_DATA_API_BASE_URL") ?? DEFAULT_API_BASE_URL),
    pollIntervalMs: positiveInteger(environmentValue(environment, "BRIGHTDATA_POLL_INTERVAL_MS", "BRIGHT_DATA_POLL_INTERVAL_MS"), DEFAULT_POLL_INTERVAL_MS, "Bright Data poll interval"),
    maxPollAttempts: positiveInteger(environmentValue(environment, "BRIGHTDATA_MAX_POLL_ATTEMPTS", "BRIGHT_DATA_MAX_POLL_ATTEMPTS"), DEFAULT_MAX_POLL_ATTEMPTS, "Bright Data max poll attempts")
  };
}

export function loadEnvironmentFile(path: string): void {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    const rawValue = match[2];
    process.env[match[1]] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1).replaceAll("\\n", "\n").replaceAll("\\\"", "\"")
      : rawValue.startsWith("'") && rawValue.endsWith("'") ? rawValue.slice(1, -1) : rawValue;
  }
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  operation: string
): Promise<JsonValue> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new Error(`Bright Data ${operation} request could not be completed`);
  }
  if (!response.ok) throw new Error(`Bright Data ${operation} request failed with HTTP ${response.status}`);
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error(`Bright Data ${operation} response could not be read`);
  }
  try {
    return parseJson(text);
  } catch {
    throw new BrightDataSchemaError(`Bright Data ${operation} response was not valid JSON`);
  }
}

function collectionId(value: JsonValue): string {
  if (!isRecord(value)) {
    throw new Error("Bright Data trigger response did not include a collection ID");
  }
  try {
    return asString(value.collection_id, "collection_id");
  } catch {
    throw new Error("Bright Data trigger response did not include a collection ID");
  }
}

function throwHealth(
  request: CollectionRequest,
  config: BrightDataConfig,
  signal: "zero-results" | "required-field-collapse" | "schema-failure",
  message: string
): never {
  throw collectorHealthError({ identity: config.collectorId, version: config.collectorVersion }, signal, message, request.vendor, request.sourceUrl);
}

function assertDatasetRecordContract(
  request: CollectionRequest,
  config: BrightDataConfig,
  value: JsonObject
): void {
  const requiredFields = [
    ["content", ["publicContent", "public_content"]],
    ["excerpt", []],
    ["capabilityIdentifier", ["capability_identifier"]],
    ["changeType", ["change_type"]],
    ["deadlineOriginal", ["deadline_original"]]
  ] as const;
  const collapsed: string[] = [];
  const malformed: string[] = [];
  for (const [field, aliases] of requiredFields) {
    const valueForField = valueFrom(value, field, ...aliases);
    if (valueForField === undefined || valueForField === null || (isStringValue(valueForField) && valueForField.trim() === "")) {
      collapsed.push(field);
    } else if (!isStringValue(valueForField)) {
      malformed.push(field);
    }
  }
  for (const [field, aliases] of [["vendor", []], ["sourceUrl", ["source_url"]], ["retrievedAt", ["retrieved_at"]]] as const) {
    const valueForField = valueFrom(value, field, ...aliases);
    if (valueForField !== undefined && valueForField !== null && !isStringValue(valueForField)) malformed.push(field);
    if (valueForField !== undefined && (valueForField === null || valueForField === "")) collapsed.push(field);
  }
  const deadlineIso = valueFrom(value, "deadlineIso", "deadline_iso");
  if (deadlineIso !== undefined && deadlineIso !== null && !isStringValue(deadlineIso)) malformed.push("deadlineIso");
  if (collapsed.length > 0) throwHealth(request, config, "required-field-collapse", `Required collector field(s) were missing or empty: ${collapsed.join(", ")}.`);
  if (malformed.length > 0) throwHealth(request, config, "schema-failure", `Collector field(s) had an unsupported shape: ${malformed.join(", ")}.`);
}

function collectionFromRecord(
  request: CollectionRequest,
  config: BrightDataConfig,
  value: JsonValue,
  retrievedAt: string
): VendorNoticeCollection {
  if (!isRecord(value)) throwHealth(request, config, "schema-failure", "Bright Data dataset record was not an object.");
  assertDatasetRecordContract(request, config, value);
  const vendor = optionalField(value, request.vendor, "vendor");
  const sourceUrl = optionalField(value, request.sourceUrl, "sourceUrl", "source_url");
  if (vendor !== request.vendor || sourceUrl !== request.sourceUrl) {
    throw new Error("Bright Data dataset record did not match the requested curated source");
  }
  const capability = capabilityForSourceUrl(request.sourceUrl);
  if (!capability || capability.vendor !== request.vendor) {
    throw new Error("Bright Data request must use a curated first-party source");
  }
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    kind: "vendor-notice-collection",
    vendor: request.vendor,
    sourceUrl: request.sourceUrl,
    retrievedAt: optionalField(value, retrievedAt, "retrievedAt", "retrieved_at"),
    collector: { identity: config.collectorId, version: config.collectorVersion },
    content: requiredField(value, "content", "publicContent", "public_content"),
    excerpt: requiredField(value, "excerpt"),
    capabilityIdentifier: requiredField(value, "capabilityIdentifier", "capability_identifier"),
    changeType: requiredField(value, "changeType", "change_type"),
    deadlineOriginal: requiredField(value, "deadlineOriginal", "deadline_original"),
    deadlineIso: parseDeadlineIso(value)
  };
}

export async function collectBrightDataVendorNotice(
  request: CollectionRequest,
  config: BrightDataConfig,
  fetcher: typeof fetch = fetch,
  sleep: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  clock: () => Date = () => new Date()
): Promise<VendorNoticeArtifact> {
  const capability = capabilityForSourceUrl(request.sourceUrl);
  if (!capability || capability.vendor !== request.vendor) {
    throw new Error("Bright Data request must use a curated first-party source");
  }
  const triggerUrl = `${normalizedApiBaseUrl(config.apiBaseUrl)}/dca/trigger?collector=${encodeURIComponent(config.collectorId)}&queue_next=1`;
  let trigger: JsonValue;
  try {
    trigger = await requestJson(fetcher, triggerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([{ url: request.sourceUrl }])
    }, "trigger");
  } catch (error) {
    if (error instanceof BrightDataSchemaError) throwHealth(request, config, "schema-failure", "Bright Data trigger response was not valid JSON.");
    throw error;
  }
  let snapshotId: string;
  try {
    snapshotId = collectionId(trigger);
  } catch {
    throwHealth(request, config, "schema-failure", "Bright Data trigger response did not match the collection contract.");
  }
  const datasetUrl = `${normalizedApiBaseUrl(config.apiBaseUrl)}/dca/dataset?id=${encodeURIComponent(snapshotId)}`;
  const retrievedAt = () => clock().toISOString();

  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    let dataset: JsonValue;
    try {
      dataset = await requestJson(fetcher, datasetUrl, {
        headers: { Authorization: `Bearer ${config.apiKey}` }
      }, "dataset");
    } catch (error) {
      if (error instanceof BrightDataSchemaError) throwHealth(request, config, "schema-failure", "Bright Data dataset response was not valid JSON.");
      throw error;
    }
    if (Array.isArray(dataset) && dataset.length > 0) {
      return vendorNoticeArtifactFromCollection(collectionFromRecord(request, config, dataset[0], retrievedAt()));
    }
    if (!Array.isArray(dataset) && (!isRecord(dataset) || !isStringValue(dataset.status) || dataset.status.trim() === "")) {
      throwHealth(request, config, "schema-failure", "Bright Data dataset response did not match the collection contract.");
    }
    if (attempt + 1 < config.maxPollAttempts) await sleep(config.pollIntervalMs);
  }
  throwHealth(request, config, "zero-results", "The collection returned zero results before the polling limit while one VendorNotice was required.");
}
