import { readFileSync } from "node:fs";
import {
  HEAL_PROMPT_MAX_LENGTH,
  asString,
  isRecord,
  isStringValue,
  parseJson,
  type JsonObject,
  type JsonValue
} from "../domain/artifacts.js";
import type { BrightDataConfig } from "./bright-data.js";

/**
 * Bright Data's self-healing flow, verified against the live API on 19 August 2026.
 *
 * `POST /dca/collectors/{id}/refactor_template` starts a heal job. Progress is polled from
 * `.../refactor_template/progress` until it pauses at `pending_answer`, where the payload carries
 * `diff.template_a` and `diff.template_b`. Resuming with `POST .../resume_automation_job` and an
 * explicit `message` boolean either commits or discards the proposal, and the job then settles.
 *
 * The product never sends `auto_save`, so no template is ever committed without a human step.
 */
const REFACTOR_PATH = "refactor_template";
const PROGRESS_PATH = "refactor_template/progress";
const RESUME_PATH = "resume_automation_job";
const AWAITING_APPROVAL_STATUS = "pending_answer";
const APPROVAL_GATE_STEP = "user_approval";

export type HealSettledStatus = "done" | "failed" | "error" | "cancelled";
const SETTLED_STATUSES: ReadonlySet<string> = new Set<HealSettledStatus>(["done", "failed", "error", "cancelled"]);

function isSettledStatus(value: string): value is HealSettledStatus {
  return SETTLED_STATUSES.has(value);
}

export type HealDecision = "approve" | "reject";

/** A paused heal job: Bright Data has proposed a template and is waiting for a human. */
export interface CollectorHealGate {
  jobId: string;
  completedSteps: readonly string[];
  parseCodeBefore: string;
  parseCodeAfter: string;
}

/** A heal job that ran to a terminal status after a human approved or rejected it. */
export interface CollectorHealSettlement {
  status: HealSettledStatus;
  completedSteps: readonly string[];
}

/**
 * The seam the CollectorHeal workflow drives. `brightDataHealDriver` calls the real API;
 * `recordedHealDriver` replays a captured progress payload for the demo and the offline suite.
 */
export interface CollectorHealDriver {
  source: "bright-data" | "recorded";
  heal(prompt: string): Promise<CollectorHealGate>;
  resume(decision: HealDecision): Promise<CollectorHealSettlement>;
}

type Sleep = (milliseconds: number) => Promise<void>;

type HealProgress =
  | { state: "running"; completedSteps: readonly string[] }
  | ({ state: "awaiting-approval" } & CollectorHealGate)
  | ({ state: "settled" } & CollectorHealSettlement);

/** What polling is allowed to return: the job either paused for a human or finished. */
type DecidedHealProgress = Exclude<HealProgress, { state: "running" }>;

function normalizedApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function collectorUrl(config: BrightDataConfig, path: string): string {
  return `${normalizedApiBaseUrl(config.apiBaseUrl)}/dca/collectors/${encodeURIComponent(config.collectorId)}/${path}`;
}

function completedSteps(value: JsonObject): readonly string[] {
  if (!Array.isArray(value.completed_steps)) return [];
  return value.completed_steps.filter(isStringValue);
}

function parseCode(template: JsonValue, side: string): string {
  if (!isRecord(template) || !Array.isArray(template.steps) || template.steps.length === 0) {
    throw new Error(`Bright Data heal ${side} did not contain a template step`);
  }
  const step = template.steps[0];
  if (!isRecord(step)) throw new Error(`Bright Data heal ${side} template step was not an object`);
  return asString(step.parse_code, `Bright Data heal ${side} parse_code`);
}

/** Parses one `refactor_template/progress` payload into the state the workflow reacts to. */
function parseHealProgress(value: JsonValue): HealProgress {
  if (!isRecord(value)) throw new Error("Bright Data heal progress response was not an object");
  const status = isStringValue(value.status) ? value.status : "";
  if (status === "") throw new Error("Bright Data heal progress response did not report a status");
  if (isSettledStatus(status)) {
    return { state: "settled", status, completedSteps: completedSteps(value) };
  }
  if (status !== AWAITING_APPROVAL_STATUS) {
    return { state: "running", completedSteps: completedSteps(value) };
  }
  // Only the human-approval step is a decision this product may answer. Any other pause is a
  // question Blast Radius has not been told how to answer, so it stops rather than guessing.
  const step = isStringValue(value.step) ? value.step : "";
  if (step !== APPROVAL_GATE_STEP) {
    throw new Error(`Bright Data paused the heal at ${step || "an unnamed step"} rather than ${APPROVAL_GATE_STEP}`);
  }
  if (!isRecord(value.diff)) throw new Error("Bright Data heal stopped at the approval gate without a template diff");
  return {
    state: "awaiting-approval",
    jobId: asString(value.id, "Bright Data heal job id"),
    completedSteps: completedSteps(value),
    parseCodeBefore: parseCode(value.diff.template_a, "template_a"),
    parseCodeAfter: parseCode(value.diff.template_b, "template_b")
  };
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
    throw new Error(`Bright Data ${operation} response was not valid JSON`);
  }
}

async function pollProgress(
  config: BrightDataConfig,
  fetcher: typeof fetch,
  sleep: Sleep,
  operation: string
): Promise<DecidedHealProgress> {
  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    const progress = parseHealProgress(await requestJson(fetcher, collectorUrl(config, PROGRESS_PATH), {
      headers: { Authorization: `Bearer ${config.apiKey}` }
    }, operation));
    if (progress.state !== "running") return progress;
    if (attempt + 1 < config.maxPollAttempts) await sleep(config.pollIntervalMs);
  }
  throw new Error(`Bright Data ${operation} did not reach a decision before the polling limit`);
}

export function brightDataHealDriver(
  config: BrightDataConfig,
  fetcher: typeof fetch = fetch,
  sleep: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): CollectorHealDriver {
  return {
    source: "bright-data",
    async heal(prompt: string): Promise<CollectorHealGate> {
      if (prompt.trim() === "") throw new Error("Bright Data heal requires a prompt naming what drifted");
      if (prompt.length > HEAL_PROMPT_MAX_LENGTH) {
        throw new Error(`Bright Data heal prompt is ${prompt.length} characters; the API limit is ${HEAL_PROMPT_MAX_LENGTH}`);
      }
      await requestJson(fetcher, collectorUrl(config, REFACTOR_PATH), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, custom_input: [] })
      }, "heal");
      const progress = await pollProgress(config, fetcher, sleep, "heal");
      if (progress.state !== "awaiting-approval") {
        throw new Error(`Bright Data heal settled as ${progress.status} without reaching the approval gate`);
      }
      return progress;
    },
    async resume(decision: HealDecision): Promise<CollectorHealSettlement> {
      await requestJson(fetcher, collectorUrl(config, RESUME_PATH), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: decision === "approve" })
      }, decision);
      const progress = await pollProgress(config, fetcher, sleep, decision);
      if (progress.state !== "settled") {
        throw new Error(`Bright Data returned a second approval gate after ${decision}; Blast Radius does not resume it automatically`);
      }
      return progress;
    }
  };
}

/**
 * Replays a stored `refactor_template/progress` payload. ADR 0003 fixes the demo shape as live
 * collection with a pre-recorded heal, because a real heal takes two to three minutes; the
 * artifact records `source: "recorded"` so replayed evidence is never presented as a live call.
 */
export function recordedHealDriver(progressPath: string): CollectorHealDriver {
  const read = (): HealProgress => {
    let contents: string;
    try {
      contents = readFileSync(progressPath, "utf8");
    } catch (error) {
      throw new Error(`could not read recorded heal response: ${error instanceof Error ? error.message : String(error)}`);
    }
    return parseHealProgress(parseJson(contents));
  };
  return {
    source: "recorded",
    async heal(): Promise<CollectorHealGate> {
      const progress = read();
      if (progress.state !== "awaiting-approval") throw new Error("the recorded heal response did not stop at the approval gate");
      return progress;
    },
    async resume(decision: HealDecision): Promise<CollectorHealSettlement> {
      const progress = read();
      if (progress.state !== "settled") throw new Error(`the recorded ${decision} response did not settle the heal job`);
      return progress;
    }
  };
}
