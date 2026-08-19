import {
  HEAL_PROMPT_MAX_LENGTH,
  assertCollectorHealArtifact,
  assertCollectorHealthArtifact,
  assertVendorNoticeArtifact,
  collectorLabel,
  isStringValue,
  type CollectorHealArtifact,
  type CollectorHealth,
  type CollectorIdentity,
  type JsonValue,
  type VendorNoticeArtifact,
  type VendorNoticeCollection
} from "../domain/artifacts.js";
import { CollectorHealthError } from "../domain/collector-health.js";
import type { CollectorHealDriver, HealDecision } from "./bright-data-heal.js";

const LIMITED_HEALTH_NOTE = "This diagnosis is limited to the supported health signal; it does not establish semantic scraper correctness.";

function sameCollector(left: CollectorIdentity, right: CollectorIdentity): boolean {
  return left.identity === right.identity && left.version === right.version;
}

/** The three sentences a prompt is built from, chosen once by signal rather than three times. */
interface PromptFragments {
  core: string;
  observed: string;
  instruction: string;
}

function promptFragments(
  health: CollectorHealth,
  sourceUrl: string | undefined,
  lastKnownGood: VendorNoticeCollection | undefined
): PromptFragments {
  const page = sourceUrl ? ` returned for ${sourceUrl}` : "";
  const named = health.fields.join(", ");
  const plural = health.fields.length !== 1;
  if (health.signal === "zero-results") {
    return {
      core: `The collector returned zero rows${sourceUrl ? ` for ${sourceUrl}` : ""} while exactly one row was required.`,
      observed: lastKnownGood === undefined ? "" : " The same page previously returned one row.",
      instruction: " Restore extraction so the page yields one row again, and leave the output fields unchanged."
    };
  }
  const previously = lastKnownGood === undefined
    ? ""
    : ` It previously extracted ${health.fields.map(field => `${field}=${JSON.stringify(previousValue(lastKnownGood, field))}`).join(", ")}.`;
  const instruction = ` Restore extraction of ${named} for this page, and leave the other output fields unchanged.`;
  return health.signal === "schema-failure"
    ? {
      core: `${plural ? "Fields" : "Field"} ${named} returned a value of an unsupported shape in every row${page}.`,
      observed: previously,
      instruction
    }
    : {
      core: `${plural ? "Fields" : "Field"} ${named} ${plural ? "are" : "is"} null or empty in every row${page}.`,
      observed: previously,
      instruction
    };
}

/**
 * Describes the drift in the terms Bright Data's planner reacts to. A vague prompt produces a
 * vague heal, so the text always names the collector output fields the CollectorHealth signal
 * flagged, and — when a previous healthy collection is available — the values those fields last
 * held. Nothing here is inferred: every claim comes from a stored record.
 */
function composePromptText(
  health: CollectorHealth,
  sourceUrl: string | undefined,
  lastKnownGood: VendorNoticeCollection | undefined
): string {
  const { core, observed, instruction } = promptFragments(health, sourceUrl, lastKnownGood);
  const evidence = lastKnownGood === undefined
    ? ""
    : ` The lifecycle sentence on that page read: ${JSON.stringify(lastKnownGood.excerpt)}`;

  // Bright Data rejects an over-long prompt outright, so shed evidence before naming less.
  for (const candidate of [`${core}${observed}${evidence}${instruction}`, `${core}${observed}${instruction}`, `${core}${instruction}`]) {
    if (candidate.length <= HEAL_PROMPT_MAX_LENGTH) return candidate;
  }
  throw new Error(`the composed heal prompt exceeds the ${HEAL_PROMPT_MAX_LENGTH} characters Bright Data accepts`);
}

function previousValue(collection: VendorNoticeCollection, field: string): string {
  const value = collection[field];
  return isStringValue(value) ? value : "a value that is no longer recorded";
}

function lastKnownGoodCollection(value: JsonValue | undefined): VendorNoticeCollection | undefined {
  if (value === undefined) return undefined;
  const artifact = assertVendorNoticeArtifact(value);
  if (!artifact.collection) throw new Error("the last known good notice does not record the collection it came from");
  return artifact.collection;
}

/**
 * Turns a stored CollectorHealth diagnostic into a CollectorHeal that is ready to send, without
 * contacting Bright Data. The prompt is composed here so it can be reviewed before any credits
 * are spent.
 */
export function detectCollectorHeal(diagnostic: JsonValue, lastKnownGood?: JsonValue): CollectorHealArtifact {
  const artifact = assertCollectorHealthArtifact(diagnostic);
  const health = artifact.collectorHealth;
  const collector = health.collector;
  const signal = health.signal ?? "schema-failure";
  const previous = lastKnownGoodCollection(lastKnownGood);
  if (previous && artifact.sourceUrl && previous.sourceUrl !== artifact.sourceUrl) {
    throw new Error("the last known good notice came from a different curated source than the drifted collection");
  }
  const detected: CollectorHealArtifact["detected"] = { signal, collectorHealth: health };
  if (artifact.vendor !== undefined) detected.vendor = artifact.vendor;
  if (artifact.sourceUrl !== undefined) detected.sourceUrl = artifact.sourceUrl;
  return assertCollectorHealArtifact({
    schemaVersion: 1,
    kind: "collector-heal",
    stage: "detected",
    detected,
    collector,
    diagnosis: `CollectorHealth ${signal} detected for ${collectorLabel(collector)}: ${health.message} ${LIMITED_HEALTH_NOTE}`,
    prompt: {
      text: composePromptText(health, artifact.sourceUrl, previous),
      fields: health.fields
    },
    heal: {
      source: "not-requested",
      jobId: null,
      completedSteps: [],
      diff: null,
      message: "The heal prompt is composed but has not been sent to Bright Data."
    },
    approval: {
      status: "not-requested",
      message: "Approval cannot be requested until Bright Data proposes a template."
    },
    rerun: {
      status: "not-run",
      message: "A healthy rerun is available only after a human approves the proposed template."
    }
  });
}

/** Sends the composed prompt and stops at Bright Data's approval gate. Never approves. */
export async function runCollectorHeal(
  value: JsonValue | CollectorHealArtifact,
  driver: CollectorHealDriver
): Promise<CollectorHealArtifact> {
  const heal = assertCollectorHealArtifact(value);
  if (heal.stage !== "detected") {
    throw new Error(`a heal can be sent only from a detected CollectorHealth signal; this one is already ${heal.stage}`);
  }
  const gate = await driver.heal(heal.prompt.text);
  const evidence = driver.source === "recorded"
    ? "Replayed from a recorded Bright Data response; no live heal ran."
    : "Bright Data proposed this template and paused for a human decision.";
  return assertCollectorHealArtifact({
    ...heal,
    stage: "awaiting-approval",
    heal: {
      source: driver.source,
      jobId: gate.jobId,
      completedSteps: gate.completedSteps,
      diff: { parseCodeBefore: gate.parseCodeBefore, parseCodeAfter: gate.parseCodeAfter },
      message: `${evidence} ${collectorLabel(heal.collector)} still runs its current template.`
    },
    approval: {
      status: "requested",
      message: `Bright Data is waiting at its approval gate. ${collectorLabel(heal.collector)} keeps its current template until a human approves the proposal.`
    }
  });
}

/** Applies an explicit human decision at the approval gate. */
export async function resolveCollectorHeal(
  value: JsonValue | CollectorHealArtifact,
  decision: HealDecision,
  driver: CollectorHealDriver
): Promise<CollectorHealArtifact> {
  const heal = assertCollectorHealArtifact(value);
  if (heal.stage !== "awaiting-approval" || heal.approval.status !== "requested") {
    throw new Error(`a heal can be ${decision === "approve" ? "approved" : "rejected"} only while it waits at the approval gate; this one is ${heal.stage}`);
  }
  const settlement = await driver.resume(decision);
  const approved = decision === "approve";
  return assertCollectorHealArtifact({
    ...heal,
    stage: approved ? "approved" : "rejected",
    heal: {
      ...heal.heal,
      completedSteps: settlement.completedSteps,
      message: approved
        ? `A human approved the proposed template and Bright Data finished the job (terminal status ${settlement.status}).`
        : `A human rejected the proposed template, so the collector was left untouched. Bright Data finished the job without applying it (terminal status ${settlement.status}).`
    },
    approval: {
      status: approved ? "approved" : "rejected",
      message: approved
        ? `Explicit human approval moved ${collectorLabel(heal.collector)} onto the healed template. The collector identity did not change.`
        : `A human rejected the proposal. ${collectorLabel(heal.collector)} still runs its previous template; compose a sharper prompt to try again.`
    },
    rerun: {
      status: "not-run",
      message: approved
        ? "Approval completed. Run a collection rerun to observe the healed template."
        : "A rejected heal has nothing to rerun."
    }
  });
}

/**
 * Collects again after approval and records only the health that collection can prove. The
 * collection itself is injected, so the same transition serves a stored fixture and a live
 * Bright Data run against the healed template.
 */
export async function rerunCollectorHeal(
  value: JsonValue | CollectorHealArtifact,
  collect: () => Promise<VendorNoticeArtifact>
): Promise<CollectorHealArtifact> {
  const heal = assertCollectorHealArtifact(value);
  if (heal.stage !== "approved") {
    throw new Error("a collector can be rerun only after a human approves the healed template");
  }
  try {
    const artifact = await collect();
    if (heal.detected.vendor && artifact.notice.vendor !== heal.detected.vendor) {
      throw new Error(`rerun vendor ${artifact.notice.vendor} did not match detected vendor ${heal.detected.vendor}`);
    }
    if (heal.detected.sourceUrl && artifact.notice.sourceUrl !== heal.detected.sourceUrl) {
      throw new Error("rerun source did not match the detected curated source");
    }
    if (!artifact.collection || !sameCollector(artifact.collection.collector, heal.collector)) {
      throw new Error(`rerun collector did not match healed collector ${collectorLabel(heal.collector)}`);
    }
    if (!artifact.collectorHealth) throw new Error("rerun did not record CollectorHealth");
    return assertCollectorHealArtifact({
      ...heal,
      stage: "rerun-healthy",
      rerun: {
        status: "healthy",
        collectorHealth: artifact.collectorHealth,
        message: `Healthy rerun completed with ${collectorLabel(heal.collector)}. CollectorHealth passed zero-results, required-field-collapse, and schema-failure checks only; this does not establish semantic correctness or completeness.`
      }
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const health = failure instanceof CollectorHealthError ? failure.artifact.collectorHealth : undefined;
    const rerun: CollectorHealArtifact["rerun"] = {
      status: "failed",
      message: `The rerun after approval failed: ${failure.message}.`
    };
    if (health !== undefined && sameCollector(health.collector, heal.collector)) rerun.collectorHealth = health;
    return assertCollectorHealArtifact({ ...heal, stage: "rerun-failed", rerun });
  }
}
