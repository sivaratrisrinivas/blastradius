export type Vendor =
  | "Slack"
  | "OpenAI"
  | "Cloudflare"
  | "GitHub"
  | "Shopify"
  | "Vercel"
  | "Firebase"
  | "Auth0"
  | "HubSpot"
  | "Google Maps Platform";

export type CapabilityIdentifier =
  | "slack.files.upload"
  | "openai.assistants"
  | "openai.beta.assistants"
  | "cloudflare.workers.kv.legacy-namespace-routes"
  | "github.dependency-graph.sbom.synchronous"
  | "shopify.webhooks.checkout-and-accounts-configurations-update"
  | "vercel.config.now-json"
  | "firebase.ml"
  | "auth0.rules-and-hooks"
  | "hubspot.contacts.lists-v1"
  | "google-maps.javascript.heatmap-layer";

export type CapabilityMatcher = "slack-files-upload" | "openai-assistants" | "cloudflare-kv-legacy-routes";

/**
 * How close the lifecycle wording sits to the capability name in the vendor's own prose. `adjacent`
 * expects them in the same clause; `same-sentence` allows the qualifying material real vendor pages
 * put between them. Neither loosens the gate itself — the sentence must still say both.
 */
export type EvidenceProximity = "adjacent" | "same-sentence";

interface CuratedSourceRecord {
  vendor: Vendor;
  sourceUrl: string;
  canonicalIdentifier: CapabilityIdentifier;
  evidenceIdentifier: string;
  evidenceProximity: EvidenceProximity;
  acceptedIdentifiers: readonly string[];
  displayName: string;
  reportLabel: string;
}

/** A curated first-party source that a repository matcher can turn into an Impact. */
export interface CuratedCapability extends CuratedSourceRecord {
  matcher: CapabilityMatcher;
  /** The bundled notice fixture, relative to the package root, that `check` collects this from. */
  noticeFixture: string;
  packageName: string;
  constructorNames: readonly string[];
  capabilityPath: readonly string[];
  capabilityObjectCanBeAliased: boolean;
}

/**
 * A curated first-party source with a live collector but no repository matcher. It contributes
 * CollectorHealth and CollectorHeal evidence and can never become an Impact. See ADR 0002.
 */
export interface WatchedVendor extends CuratedSourceRecord {
  matcher: null;
}

export type CuratedSource = CuratedCapability | WatchedVendor;

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
    noticeFixture: "fixtures/slack-notice.json",
    evidenceIdentifier: "files.upload",
    evidenceProximity: "adjacent",
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
    noticeFixture: "fixtures/openai-notice.json",
    evidenceIdentifier: "Assistants API",
    evidenceProximity: "adjacent",
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
    noticeFixture: "fixtures/cloudflare-kv-notice.json",
    evidenceIdentifier: "legacy Workers KV API routes",
    evidenceProximity: "same-sentence",
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

/**
 * Watched sources are collected and health-checked exactly like matched ones. They have no matcher,
 * so a scan of any repository against one of them yields zero CodeMatches and therefore no Impact.
 */
const WATCHED_VENDORS: readonly WatchedVendor[] = [
  {
    vendor: "GitHub",
    sourceUrl: "https://github.blog/changelog/2026-05-12-synchronous-sbom-api-deprecated/",
    canonicalIdentifier: "github.dependency-graph.sbom.synchronous",
    evidenceIdentifier: "synchronous API",
    evidenceProximity: "adjacent",
    matcher: null,
    acceptedIdentifiers: ["github.dependency-graph.sbom.synchronous"],
    displayName: "synchronous SBOM REST API",
    reportLabel: "GitHub synchronous SBOM REST API"
  },
  {
    vendor: "Shopify",
    sourceUrl: "https://shopify.dev/changelog/deprecation-of-checkoutandaccountsconfigurationsupdate-webhook",
    canonicalIdentifier: "shopify.webhooks.checkout-and-accounts-configurations-update",
    evidenceIdentifier: "checkout and accounts configurations",
    evidenceProximity: "same-sentence",
    matcher: null,
    acceptedIdentifiers: ["shopify.webhooks.checkout-and-accounts-configurations-update"],
    displayName: "checkout_and_accounts_configurations/update webhook",
    reportLabel: "Shopify checkout_and_accounts_configurations/update webhook"
  },
  {
    vendor: "Vercel",
    sourceUrl: "https://vercel.com/changelog/support-for-now-json-will-be-removed-on-march-31-2026",
    canonicalIdentifier: "vercel.config.now-json",
    evidenceIdentifier: "now.json",
    evidenceProximity: "same-sentence",
    matcher: null,
    acceptedIdentifiers: ["vercel.config.now-json"],
    displayName: "now.json config file",
    reportLabel: "Vercel now.json config file"
  },
  {
    vendor: "Firebase",
    sourceUrl: "https://firebase.google.com/docs/ml?hl=en",
    canonicalIdentifier: "firebase.ml",
    evidenceIdentifier: "Firebase ML",
    evidenceProximity: "adjacent",
    matcher: null,
    acceptedIdentifiers: ["firebase.ml"],
    displayName: "Firebase ML",
    reportLabel: "Firebase ML"
  },
  {
    vendor: "Auth0",
    sourceUrl: "https://auth0.com/docs/troubleshoot/product-lifecycle/deprecations-and-migrations",
    canonicalIdentifier: "auth0.rules-and-hooks",
    evidenceIdentifier: "Rules and Hooks",
    evidenceProximity: "same-sentence",
    matcher: null,
    acceptedIdentifiers: ["auth0.rules-and-hooks"],
    displayName: "Rules and Hooks",
    reportLabel: "Auth0 Rules and Hooks"
  },
  {
    vendor: "HubSpot",
    sourceUrl: "https://developers.hubspot.com/changelog/upcoming-sunset-v1-lists-api",
    canonicalIdentifier: "hubspot.contacts.lists-v1",
    evidenceIdentifier: "V1 Contact Lists API",
    evidenceProximity: "adjacent",
    matcher: null,
    acceptedIdentifiers: ["hubspot.contacts.lists-v1"],
    displayName: "V1 Contact Lists API",
    reportLabel: "HubSpot V1 Contact Lists API"
  },
  {
    vendor: "Google Maps Platform",
    sourceUrl: "https://developers.google.com/maps/deprecations?hl=en",
    canonicalIdentifier: "google-maps.javascript.heatmap-layer",
    evidenceIdentifier: "Heatmap Layer",
    evidenceProximity: "same-sentence",
    matcher: null,
    acceptedIdentifiers: ["google-maps.javascript.heatmap-layer"],
    displayName: "Heatmap Layer",
    reportLabel: "Google Maps Platform Heatmap Layer"
  }
];

const CURATED_SOURCES: readonly CuratedSource[] = [...CURATED_CAPABILITIES, ...WATCHED_VENDORS];

export function curatedSources(): readonly CuratedSource[] {
  return CURATED_SOURCES;
}

/** The sources with a repository matcher — the only ones a scan can ever turn into an Impact. */
export function curatedCapabilities(): readonly CuratedCapability[] {
  return CURATED_CAPABILITIES;
}

export function watchedVendors(): readonly WatchedVendor[] {
  return WATCHED_VENDORS;
}

/**
 * Every vendor on the curated allowlist, watched and matched alike — the "vendors watched" number
 * ADR 0002 requires the report to publish. Not the same set as `watchedVendors()`, which is only
 * the sources with no matcher.
 */
export function curatedVendorCount(): number {
  return CURATED_SOURCES.length;
}

/** Capabilities a repository matcher can prove. Always the smaller of the two published numbers. */
export function capabilitiesProvable(): number {
  return CURATED_CAPABILITIES.length;
}

export function isVendor(value: string): value is Vendor {
  return CURATED_SOURCES.some(source => source.vendor === value);
}

export function curatedSourceForUrl(sourceUrl: string): CuratedSource | undefined {
  return CURATED_SOURCES.find(source => source.sourceUrl === sourceUrl);
}

export function curatedSourceForIdentifier(identifier: string, vendor?: string): CuratedSource | undefined {
  return CURATED_SOURCES.find(source => source.acceptedIdentifiers.includes(identifier) && (vendor === undefined || source.vendor === vendor));
}

export function capabilityForPackage(packageName: string): CuratedCapability | undefined {
  return CURATED_CAPABILITIES.find(capability => capability.packageName === packageName && packageName !== "");
}

export function curatedSourceUrlForVendor(vendor: Vendor): string | undefined {
  return CURATED_SOURCES.find(source => source.vendor === vendor)?.sourceUrl;
}

export function matcherForIdentifier(identifier: string, vendor?: string): CapabilityMatcher | null {
  return curatedSourceForIdentifier(identifier, vendor)?.matcher ?? null;
}
