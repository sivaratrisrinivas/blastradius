import {
  assertCollectorHealthArtifact,
  assertCollectorRepairArtifact,
  type CollectorRepairArtifact,
  type CollectorRepairStage,
  type CollectorIdentity,
  type JsonValue
} from "../domain/artifacts.js";
import { CollectorHealthError } from "../domain/collector-health.js";
import { collectVendorNotice } from "./collect.js";

type RepairChecks = CollectorRepairArtifact["validation"]["checks"];

const NOT_EVALUATED_CHECKS: RepairChecks = {
  collectionContract: "not-evaluated",
  zeroResults: "not-evaluated",
  requiredFields: "not-evaluated",
  schema: "not-evaluated"
};

function nextCollectorVersion(version: string): string {
  const numberedVersion = /^(.*-)?v(\d+)$/.exec(version);
  if (numberedVersion) return `${numberedVersion[1] ?? ""}v${Number(numberedVersion[2]) + 1}`;
  return `${version}-repair`;
}

function nonEmptyVersion(version: string | undefined, activeVersion: string): string {
  const proposedVersion = version?.trim() || nextCollectorVersion(activeVersion);
  if (proposedVersion === activeVersion) throw new Error("proposed collector version must differ from the active version");
  return proposedVersion;
}

function collectorLabel(collector: CollectorIdentity): string {
  return `${collector.identity}@${collector.version}`;
}

function sameCollector(left: CollectorIdentity, right: CollectorIdentity): boolean {
  return left.identity === right.identity && left.version === right.version;
}

function failureMessage(error: Error): string {
  return error.message;
}

function failedChecks(error: Error): RepairChecks {
  if (error instanceof CollectorHealthError) {
    const health = error.artifact.collectorHealth;
    return {
      collectionContract: "not-evaluated",
      zeroResults: health.checks.zeroResults,
      requiredFields: health.checks.requiredFields,
      schema: health.checks.schema
    };
  }
  return { ...NOT_EVALUATED_CHECKS, collectionContract: "failed" };
}

function withValidation(
  proposal: CollectorRepairArtifact,
  stage: CollectorRepairStage,
  validation: CollectorRepairArtifact["validation"],
  approval: CollectorRepairArtifact["approval"]
): CollectorRepairArtifact {
  return assertCollectorRepairArtifact({
    ...proposal,
    stage,
    validation,
    approval
  });
}

export function proposeCollectorRepair(value: JsonValue, proposedVersion?: string): CollectorRepairArtifact {
  const diagnostic = assertCollectorHealthArtifact(value);
  const activeCollector = diagnostic.collectorHealth.collector;
  const proposedCollector: CollectorIdentity = {
    identity: activeCollector.identity,
    version: nonEmptyVersion(proposedVersion, activeCollector.version)
  };
  const signal = diagnostic.collectorHealth.signal ?? "unknown";
  const diagnosis = `CollectorHealth ${signal} detected for ${collectorLabel(activeCollector)}: ${diagnostic.collectorHealth.message}. This diagnosis is limited to the supported health signal; it does not establish semantic scraper correctness.`;
  const detected: CollectorRepairArtifact["detected"] = {
    signal: diagnostic.collectorHealth.signal ?? "schema-failure",
    collectorHealth: diagnostic.collectorHealth
  };
  if (diagnostic.vendor !== undefined) detected.vendor = diagnostic.vendor;
  if (diagnostic.sourceUrl !== undefined) detected.sourceUrl = diagnostic.sourceUrl;
  return assertCollectorRepairArtifact({
    schemaVersion: 1,
    kind: "collector-repair",
    stage: "proposed",
    detected,
    activeCollector,
    proposedCollector,
    diagnosis,
    validation: {
      status: "not-run",
      checks: NOT_EVALUATED_CHECKS,
      message: "The proposed collector has not been validated against the collection contract or supported health checks."
    },
    approval: {
      status: "not-requested",
      message: "Approval cannot be requested until validation passes."
    },
    activation: {
      status: "not-activated",
      message: `Active collector ${collectorLabel(activeCollector)} remains active until explicit approval.`
    },
    rerun: {
      status: "not-run",
      message: "A healthy rerun is available only after explicit approval activates the proposal."
    }
  });
}

export function validateCollectorRepair(value: JsonValue | CollectorRepairArtifact, fixturePath: string): CollectorRepairArtifact {
  const proposal = assertCollectorRepairArtifact(value);
  if (proposal.stage !== "proposed" && proposal.stage !== "validation-failed") {
    throw new Error("collector repair can be validated only before approval is requested");
  }
  try {
    const artifact = collectVendorNotice(fixturePath);
    if (proposal.detected.vendor && artifact.notice.vendor !== proposal.detected.vendor) {
      throw new Error(`validation fixture vendor ${artifact.notice.vendor} did not match detected vendor ${proposal.detected.vendor}`);
    }
    if (proposal.detected.sourceUrl && artifact.notice.sourceUrl !== proposal.detected.sourceUrl) {
      throw new Error("validation fixture source did not match the detected curated source");
    }
    if (!artifact.collection || !sameCollector(artifact.collection.collector, proposal.proposedCollector)) {
      throw new Error(`validation fixture collector did not match proposed collector ${collectorLabel(proposal.proposedCollector)}`);
    }
    if (!artifact.collectorHealth) throw new Error("validation fixture did not record CollectorHealth");
    return withValidation(
      proposal,
      "approval-requested",
      {
        status: "passed",
        checks: {
          collectionContract: "passed",
          zeroResults: "passed",
          requiredFields: "passed",
          schema: "passed"
        },
        message: `Proposed collector ${collectorLabel(proposal.proposedCollector)} passed the collection contract and the three supported CollectorHealth checks. It does not establish semantic correctness or completeness.`
      },
      {
        status: "requested",
        message: `Validation passed. Explicit human approval is required before ${collectorLabel(proposal.proposedCollector)} can replace ${collectorLabel(proposal.activeCollector)}.`
      }
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const checks = failedChecks(failure);
    const health = failure instanceof CollectorHealthError ? failure.artifact.collectorHealth : undefined;
    const rerun: CollectorRepairArtifact["rerun"] = {
      status: "not-run",
      message: "A healthy rerun is unavailable until validation passes and a human approves the proposal."
    };
    if (health !== undefined) rerun.collectorHealth = health;
    return assertCollectorRepairArtifact({
      ...proposal,
      stage: "validation-failed",
      validation: {
        status: "failed",
        checks,
        message: `Proposed collector validation failed: ${failureMessage(failure)}.`
      },
      approval: {
        status: "not-requested",
        message: "Approval was not requested because validation failed."
      },
      activation: {
        status: "not-activated",
        message: `Active collector ${collectorLabel(proposal.activeCollector)} remains active; the failed proposal was not activated.`
      },
      rerun
    });
  }
}

export function approveCollectorRepair(value: JsonValue | CollectorRepairArtifact): CollectorRepairArtifact {
  const proposal = assertCollectorRepairArtifact(value);
  if (proposal.stage !== "approval-requested" || proposal.validation.status !== "passed" || proposal.approval.status !== "requested") {
    throw new Error("collector repair cannot be activated: passed validation and a pending approval request are required");
  }
  return assertCollectorRepairArtifact({
    ...proposal,
    stage: "activated",
    activeCollector: proposal.proposedCollector,
    approval: {
      status: "approved",
      message: `Explicit human approval activated ${collectorLabel(proposal.proposedCollector)}.`
    },
    activation: {
      status: "activated",
      previousCollector: proposal.activeCollector,
      message: `${collectorLabel(proposal.proposedCollector)} is active after explicit approval; the previous collector was retained until this step.`
    },
    rerun: {
      status: "not-run",
      message: "Activation completed. Run a healthy collection rerun to observe recovery."
    }
  });
}

export function rerunCollectorRepair(value: JsonValue | CollectorRepairArtifact, fixturePath: string): CollectorRepairArtifact {
  const proposal = assertCollectorRepairArtifact(value);
  if (proposal.stage !== "activated" || proposal.activation.status !== "activated") {
    throw new Error("collector repair can be rerun only after explicit approval activates the proposal");
  }
  try {
    const artifact = collectVendorNotice(fixturePath);
    if (proposal.detected.vendor && artifact.notice.vendor !== proposal.detected.vendor) {
      throw new Error(`rerun fixture vendor ${artifact.notice.vendor} did not match detected vendor ${proposal.detected.vendor}`);
    }
    if (proposal.detected.sourceUrl && artifact.notice.sourceUrl !== proposal.detected.sourceUrl) {
      throw new Error("rerun fixture source did not match the detected curated source");
    }
    if (!artifact.collection || !sameCollector(artifact.collection.collector, proposal.activeCollector)) {
      throw new Error(`rerun fixture collector did not match active collector ${collectorLabel(proposal.activeCollector)}`);
    }
    if (!artifact.collectorHealth) throw new Error("rerun fixture did not record CollectorHealth");
    return assertCollectorRepairArtifact({
      ...proposal,
      stage: "recovered",
      rerun: {
        status: "healthy",
        collectorHealth: artifact.collectorHealth,
        message: `Healthy rerun completed with ${collectorLabel(proposal.activeCollector)}. CollectorHealth passed zero-results, required-field-collapse, and schema-failure checks only; this does not establish semantic correctness or completeness.`
      }
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const health = failure instanceof CollectorHealthError ? failure.artifact.collectorHealth : undefined;
    const rerun: CollectorRepairArtifact["rerun"] = {
      status: "failed",
      message: `Healthy rerun failed: ${failureMessage(failure)}.`
    };
    if (health !== undefined) rerun.collectorHealth = health;
    return assertCollectorRepairArtifact({
      ...proposal,
      stage: "rerun-failed",
      rerun
    });
  }
}
