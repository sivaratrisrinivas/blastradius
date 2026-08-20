import { collectVendorNotice } from "../collection/collect.js";
import { ARTIFACT_SCHEMA_VERSION, assertRepositoryCheckArtifact, parseJson, type RepositoryCheckArtifact, type ScanArtifact } from "../domain/artifacts.js";
import { capabilitiesProvable, curatedCapabilities, curatedVendorCount, type CuratedCapability } from "../domain/capabilities.js";
import { bundledPath } from "../package-root.js";
import { repositoryFileCount, scanLocalRepository } from "../scan/scan.js";

/** One curated capability scanned against the repository, kept beside the source it came from. */
export interface CapabilityCheck {
  capability: CuratedCapability;
  scan: ScanArtifact;
}

export interface RepositoryCheck {
  repositoryPath: string;
  filesScanned: number;
  checks: readonly CapabilityCheck[];
}

/**
 * Scans one repository against every curated capability that has a repository matcher. Watched
 * vendors are not scanned — ADR 0002 makes them incapable of producing an Impact — but the coverage
 * line still names them. Each capability is collected from its bundled notice fixture, resolved
 * from the package root so the command works from any working directory.
 */
export function checkLocalRepository(repositoryPath: string): RepositoryCheck {
  const checks = curatedCapabilities().map(capability => ({
    capability,
    scan: scanLocalRepository(repositoryPath, collectVendorNotice(bundledPath(capability.noticeFixture)))
  }));
  return { repositoryPath, filesScanned: repositoryFileCount(repositoryPath), checks };
}

/**
 * The checks that proved an Impact. Only `scan.impact` decides, so an Analysis Limitation can never
 * be aggregated into one.
 */
export function impactedChecks(check: RepositoryCheck): readonly CapabilityCheck[] {
  return check.checks.filter(entry => entry.scan.impact !== null);
}

export function limitationCount(check: RepositoryCheck): number {
  return check.checks.reduce((total, entry) => total + entry.scan.limitations.length, 0);
}

export function repositoryCheckArtifact(check: RepositoryCheck): RepositoryCheckArtifact {
  const artifact: RepositoryCheckArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "repository-check",
    repository: check.repositoryPath,
    filesScanned: check.filesScanned,
    vendorsWatched: curatedVendorCount(),
    capabilitiesProvable: capabilitiesProvable(),
    impactCount: impactedChecks(check).length,
    limitationCount: limitationCount(check),
    scans: check.checks.map(entry => entry.scan)
  };
  // Round-tripped through JSON so the combined artifact faces the same gate on the way out that a
  // reader faces on the way in: every scan re-asserted, both counts recomputed from the scans.
  return assertRepositoryCheckArtifact(parseJson(JSON.stringify(artifact)));
}
