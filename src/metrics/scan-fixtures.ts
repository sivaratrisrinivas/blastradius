import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Three directories up from dist/src/metrics lands on the repository root. */
export const repositoryRoot = resolve(here, "../../..");

export function fixturePath(relativePath: string): string {
  return resolve(repositoryRoot, relativePath);
}

interface MatchLocation {
  file: string;
  line: number;
}

/**
 * Repositories the acceptance suite already proves contain a real, provable capability usage.
 * `expectedMatches` is the ground truth those tests assert; the eval table re-scans each
 * repository and checks the live matcher output against it rather than trusting a stored count.
 */
export interface PositiveScanFixture {
  description: string;
  notice: string;
  repository: string;
  expectedMatches: readonly MatchLocation[];
  provenBy: string;
}

export const POSITIVE_SCAN_FIXTURES: readonly PositiveScanFixture[] = [
  {
    description: "Slack direct client match",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository"),
    expectedMatches: [{ file: "src/slack-upload.ts", line: 6 }],
    provenBy: "test/issue-2.acceptance.test.ts"
  },
  {
    description: "Slack match surrounded by shadowing and reassignment decoys",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-shadowed-decoy"),
    expectedMatches: [{ file: "src/mixed.ts", line: 6 }],
    provenBy: "test/issue-3.acceptance.test.ts"
  },
  {
    description: "Slack match alongside dynamic-access limitations",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-analysis-limitations"),
    expectedMatches: [{ file: "src/mixed.ts", line: 6 }],
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "OpenAI direct import and require usage",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai"),
    expectedMatches: [
      { file: "src/assistants.ts", line: 6 },
      { file: "src/assistants.ts", line: 13 }
    ],
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "OpenAI aliases, destructuring, and one-file assignment chains",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-aliases"),
    expectedMatches: [
      { file: "src/assistants.ts", line: 8 },
      { file: "src/assistants.ts", line: 15 },
      { file: "src/assistants.ts", line: 22 },
      { file: "src/assistants.ts", line: 28 }
    ],
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "OpenAI matches across source, test, and example context",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-context"),
    expectedMatches: [
      { file: "examples/assistant.ts", line: 6 },
      { file: "src/assistant.ts", line: 6 },
      { file: "test/assistant.test.ts", line: 6 }
    ],
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "Cloudflare literal and structured configuration matches",
    notice: fixturePath("fixtures/cloudflare-kv-notice.json"),
    repository: fixturePath("fixtures/repository-cloudflare"),
    expectedMatches: [
      { file: "config/cloudflare.json", line: 4 },
      { file: "src/kv-client.ts", line: 2 }
    ],
    provenBy: "test/issue-7.acceptance.test.ts"
  }
];

/**
 * Repositories built to look like a match without the required vendor provenance. The acceptance
 * suite already proves each one produces zero CodeMatches; the eval table re-scans them to prove
 * the invariant holds today rather than the day the fixture was written.
 */
export interface AdversarialScanFixture {
  description: string;
  notice: string;
  repository: string;
  provenBy: string;
}

export const ADVERSARIAL_SCAN_FIXTURES: readonly AdversarialScanFixture[] = [
  {
    description: "Slack-shaped decoys with no Slack provenance",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-decoys"),
    provenBy: "test/issue-3.acceptance.test.ts"
  },
  {
    description: "cross-file Slack alias, unresolved",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-cross-file-alias"),
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "computed Slack method access",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-unresolved-usage"),
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "cross-file OpenAI alias, unresolved",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-cross-file"),
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "unsupported dynamic OpenAI access and shadowed loaders",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-unsupported"),
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "Cloudflare near-miss strings, comments, and the replacement route",
    notice: fixturePath("fixtures/cloudflare-kv-notice.json"),
    repository: fixturePath("fixtures/repository-cloudflare-decoys"),
    provenBy: "test/issue-7.acceptance.test.ts"
  }
];

/**
 * Repositories the acceptance suite proves contain related-but-unprovable usage that must surface
 * as an Analysis Limitation rather than being silently dropped. `expectedMinimumLimitations` is the
 * lower bound those tests already assert.
 */
export interface DynamicAccessScanFixture {
  description: string;
  notice: string;
  repository: string;
  expectedMinimumLimitations: number;
  provenBy: string;
}

export const DYNAMIC_ACCESS_SCAN_FIXTURES: readonly DynamicAccessScanFixture[] = [
  {
    description: "Slack-shaped decoys",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-decoys"),
    expectedMinimumLimitations: 2,
    provenBy: "test/issue-3.acceptance.test.ts"
  },
  {
    description: "shadowing, reassignment, and unsupported scopes",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-shadowed-decoy"),
    expectedMinimumLimitations: 10,
    provenBy: "test/issue-3.acceptance.test.ts"
  },
  {
    description: "computed Slack endpoint access",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-analysis-limitations"),
    expectedMinimumLimitations: 3,
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "unresolved Slack method access",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-unresolved-usage"),
    expectedMinimumLimitations: 1,
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "cross-file Slack alias",
    notice: fixturePath("fixtures/slack-notice.json"),
    repository: fixturePath("fixtures/repository-with-cross-file-alias"),
    expectedMinimumLimitations: 1,
    provenBy: "test/issue-4.acceptance.test.ts"
  },
  {
    description: "cross-file OpenAI alias",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-cross-file"),
    expectedMinimumLimitations: 1,
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "unsupported dynamic OpenAI access and shadowed loaders",
    notice: fixturePath("fixtures/openai-notice.json"),
    repository: fixturePath("fixtures/repository-openai-unsupported"),
    expectedMinimumLimitations: 3,
    provenBy: "test/issue-6.acceptance.test.ts"
  },
  {
    description: "computed Cloudflare KV route access",
    notice: fixturePath("fixtures/cloudflare-kv-notice.json"),
    repository: fixturePath("fixtures/repository-cloudflare"),
    expectedMinimumLimitations: 1,
    provenBy: "test/issue-7.acceptance.test.ts"
  },
  {
    description: "Cloudflare near-miss strings, comments, and the replacement route",
    notice: fixturePath("fixtures/cloudflare-kv-notice.json"),
    repository: fixturePath("fixtures/repository-cloudflare-decoys"),
    expectedMinimumLimitations: 1,
    provenBy: "test/issue-7.acceptance.test.ts"
  }
];

export const HEAL_FIXTURES = {
  driftedNotice: fixturePath("fixtures/collector-health/required-field-collapse.json"),
  lastKnownGoodNotice: fixturePath("fixtures/slack-notice.json"),
  gateProgress: fixturePath("fixtures/heal/awaiting-approval.progress.json"),
  resumedProgress: fixturePath("fixtures/heal/resumed-done.progress.json"),
  healthyRerun: { fixture: fixturePath("fixtures/collector-health/healed-rerun.json"), provenBy: "test/issue-12.acceptance.test.ts" },
  failedRerun: { fixture: fixturePath("fixtures/collector-health/zero-results.json"), provenBy: "test/issue-12.acceptance.test.ts" }
} as const;
