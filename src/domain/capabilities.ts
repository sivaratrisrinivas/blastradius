export type Vendor = "Slack" | "OpenAI" | "Cloudflare";
export type CapabilityIdentifier = "slack.files.upload" | "openai.assistants" | "openai.beta.assistants" | "cloudflare.workers.kv.legacy-namespace-routes";
export type CapabilityMatcher = "slack-files-upload" | "openai-assistants" | "cloudflare-kv-legacy-routes";

export interface CuratedCapability {
  vendor: Vendor;
  sourceUrl: string;
  canonicalIdentifier: CapabilityIdentifier;
  evidenceIdentifier: string;
  matcher: CapabilityMatcher;
  acceptedIdentifiers: readonly string[];
  packageName: string;
  constructorNames: readonly string[];
  capabilityPath: readonly string[];
  capabilityObjectCanBeAliased: boolean;
  displayName: string;
  reportLabel: string;
}

export const SLACK_VENDOR_NOTICE_SOURCE_URL = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
export const SLACK_VENDOR_NOTICE_EXCERPT = "The files.upload method stopped functioning on November 12, 2025.";
export const OPENAI_VENDOR_NOTICE_SOURCE_URL = "https://developers.openai.com/api/docs/assistants/migration";
export const OPENAI_VENDOR_NOTICE_EXCERPT = "After achieving feature parity in the Responses API, we've deprecated the Assistants API. It will shut down on August 26, 2026.";
export const CLOUDFLARE_VENDOR_NOTICE_SOURCE_URL = "https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/";
export const CLOUDFLARE_VENDOR_NOTICE_EXCERPT = "The legacy Workers KV API routes under /accounts/{account_id}/workers/namespaces/* are deprecated as of July 15, 2026, and will stop working on October 15, 2026.";
export const CLOUDFLARE_LEGACY_NAMESPACE_ROUTE_MARKER = "/workers/namespaces/";

const CURATED_CAPABILITIES: readonly CuratedCapability[] = [
  {
    vendor: "Slack",
    sourceUrl: SLACK_VENDOR_NOTICE_SOURCE_URL,
    canonicalIdentifier: "slack.files.upload",
    evidenceIdentifier: "files.upload",
    matcher: "slack-files-upload",
    acceptedIdentifiers: ["slack.files.upload"],
    packageName: "@slack/web-api",
    constructorNames: ["WebClient"],
    capabilityPath: ["files", "upload"],
    capabilityObjectCanBeAliased: false,
    displayName: "files.upload",
    reportLabel: "Slack files.upload"
  },
  {
    vendor: "OpenAI",
    sourceUrl: OPENAI_VENDOR_NOTICE_SOURCE_URL,
    canonicalIdentifier: "openai.assistants",
    evidenceIdentifier: "Assistants API",
    matcher: "openai-assistants",
    acceptedIdentifiers: ["openai.assistants", "openai.beta.assistants"],
    packageName: "openai",
    constructorNames: ["OpenAI"],
    capabilityPath: ["beta", "assistants"],
    capabilityObjectCanBeAliased: true,
    displayName: "Assistants API",
    reportLabel: "OpenAI Assistants API"
  },
  {
    vendor: "Cloudflare",
    sourceUrl: CLOUDFLARE_VENDOR_NOTICE_SOURCE_URL,
    canonicalIdentifier: "cloudflare.workers.kv.legacy-namespace-routes",
    evidenceIdentifier: "legacy Workers KV API routes",
    matcher: "cloudflare-kv-legacy-routes",
    acceptedIdentifiers: ["cloudflare.workers.kv.legacy-namespace-routes"],
    packageName: "",
    constructorNames: [],
    capabilityPath: [],
    capabilityObjectCanBeAliased: false,
    displayName: "Workers KV legacy namespace routes",
    reportLabel: "Cloudflare Workers KV legacy namespace routes"
  }
];

export function capabilityForSourceUrl(sourceUrl: string): CuratedCapability | undefined {
  return CURATED_CAPABILITIES.find(capability => capability.sourceUrl === sourceUrl);
}

export function capabilityForIdentifier(identifier: string, vendor?: string): CuratedCapability | undefined {
  return CURATED_CAPABILITIES.find(capability => capability.acceptedIdentifiers.includes(identifier) && (vendor === undefined || capability.vendor === vendor));
}

export function capabilityForPackage(packageName: string): CuratedCapability | undefined {
  return CURATED_CAPABILITIES.find(capability => capability.packageName === packageName && packageName !== "");
}

export function curatedSourceUrlForVendor(vendor: Vendor): string | undefined {
  return CURATED_CAPABILITIES.find(capability => capability.vendor === vendor)?.sourceUrl;
}

export const curatedCapabilityForSourceUrl = capabilityForSourceUrl;
export const curatedCapabilityForIdentifier = capabilityForIdentifier;
