import {
  collectorHealthArtifact,
  driftedCollectorHealth,
  type CollectorHealthArtifact,
  type CollectorHealthSignal,
  type CollectorIdentity
} from "./artifacts.js";
import type { Vendor } from "./capabilities.js";

export class CollectorHealthError extends Error {
  public readonly artifact: CollectorHealthArtifact;

  public constructor(artifact: CollectorHealthArtifact) {
    const signal = artifact.collectorHealth.signal ?? "unknown";
    const collector = `${artifact.collectorHealth.collector.identity}@${artifact.collectorHealth.collector.version}`;
    super(`CollectorHealth drift detected: ${signal} for ${collector}: ${artifact.collectorHealth.message}; affected collection output was withheld`);
    this.name = "CollectorHealthError";
    this.artifact = artifact;
  }
}

export function collectorHealthError(
  collector: CollectorIdentity,
  signal: CollectorHealthSignal,
  message: string,
  fields: readonly string[],
  vendor?: Vendor,
  sourceUrl?: string
): CollectorHealthError {
  return new CollectorHealthError(collectorHealthArtifact(driftedCollectorHealth(collector, signal, message, fields), vendor, sourceUrl));
}
