import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectBrightDataVendorNotice,
  type BrightDataConfig
} from "../src/collection/bright-data.js";
import { collectVendorNotice } from "../src/collection/collect.js";
import { scanLocalRepository } from "../src/scan/scan.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const slackSourceUrl = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
const slackRepository = resolve(repositoryRoot, "fixtures/repository");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");

const brightDataConfig: BrightDataConfig = {
  apiKey: "test-token-that-must-not-leak",
  collectorId: "c_public-notice",
  collectorVersion: "fixture-v1",
  apiBaseUrl: "https://brightdata.test",
  pollIntervalMs: 0,
  maxPollAttempts: 3
};

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("Bright Data collection returns the fixture-compatible artifact and feeds the local scan", async () => {
  const calls: Array<{ url: string; body: string; authorization: string }> = [];
  const responses = [
    response(JSON.stringify({ collection_id: "j_public-notice" })),
    response(JSON.stringify({ status: "building" })),
    response(JSON.stringify([{
      vendor: "Slack",
      sourceUrl: slackSourceUrl,
      retrievedAt: "2026-08-19T00:00:00Z",
      content: "The files.upload method stopped functioning on November 12, 2025.",
      excerpt: "The files.upload method stopped functioning on November 12, 2025.",
      capabilityIdentifier: "slack.files.upload",
      changeType: "shutdown",
      deadlineOriginal: "November 12, 2025",
      deadlineIso: "2025-11-12"
    }]))
  ];
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: String(init?.body ?? ""),
      authorization: headers.get("authorization") ?? ""
    });
    const nextResponse = responses.shift();
    if (!nextResponse) throw new Error("test response queue exhausted");
    return nextResponse;
  };

  const artifact = await collectBrightDataVendorNotice(
    { vendor: "Slack", sourceUrl: slackSourceUrl },
    brightDataConfig,
    fetcher,
    async () => {}
  );

  assert.equal(artifact.collection?.collector.identity, "c_public-notice");
  assert.equal(artifact.collection?.collector.version, "fixture-v1");
  assert.equal(artifact.collection?.content, "The files.upload method stopped functioning on November 12, 2025.");
  assert.equal(artifact.notice.vendor, "Slack");
  assert.equal(artifact.capabilityChange.canonicalIdentifier, "slack.files.upload");

  const scan = scanLocalRepository(slackRepository, artifact);
  assert.equal(scan.codeMatches.length, 1);
  assert.equal(scan.impact?.codeMatches[0]?.file, "src/slack-upload.ts");
  assert.equal(scan.collection?.collector.identity, "c_public-notice");

  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/dca\/trigger\?collector=c_public-notice&queue_next=1$/);
  assert.deepEqual(JSON.parse(calls[0].body), [{ url: slackSourceUrl }]);
  assert.match(calls[1].url, /\/dca\/dataset\?id=j_public-notice$/);
  assert.equal(calls[0].authorization, "Bearer test-token-that-must-not-leak");
  assert.doesNotMatch(JSON.stringify(calls), /src\/slack-upload\.ts|CodeMatch|scan-result|repository/i);
});

test("Bright Data date-time output and punctuation spacing still pass the evidence gates", async () => {
  const responses = [
    response(JSON.stringify({ collection_id: "j_public-notice" })),
    response(JSON.stringify([{
      vendor: "Slack",
      sourceUrl: slackSourceUrl,
      retrievedAt: "2026-08-19T00:00:00.000Z",
      content: "The original web API method for uploading files to Slack, files.upload, is being sunset on November 12, 2025.",
      excerpt: "The original web API method for uploading files to Slack, files.upload , is being sunset on November 12, 2025 .",
      capabilityIdentifier: "slack.files.upload",
      changeType: "shutdown",
      deadlineOriginal: "November 12, 2025",
      deadlineIso: "2025-11-12T00:00:00.000Z"
    }]))
  ];
  const artifact = await collectBrightDataVendorNotice(
    { vendor: "Slack", sourceUrl: slackSourceUrl },
    brightDataConfig,
    async () => responses.shift() ?? response("[]"),
    async () => {}
  );

  assert.equal(artifact.collection?.deadlineIso, "2025-11-12");
  assert.equal(artifact.notice.excerpt, "The original web API method for uploading files to Slack, files.upload , is being sunset on November 12, 2025 .");
});

test("deterministic fixtures use the same collection metadata boundary", () => {
  const artifact = collectVendorNotice(slackFixture);

  assert.equal(artifact.collection?.schemaVersion, 1);
  assert.equal(artifact.collection?.kind, "vendor-notice-collection");
  assert.equal(artifact.collection?.collector.identity, "deterministic-fixture");
  assert.equal(artifact.collection?.collector.version, "fixture-v1");
  assert.equal(artifact.collection?.content, artifact.notice.excerpt);
});

test("Bright Data failures have actionable status without leaking credentials or repository content", async () => {
  const fetcher: typeof fetch = async () => response(JSON.stringify({
    error: "token test-token-that-must-not-leak was rejected while reading src/slack-upload.ts"
  }), 401);

  await assert.rejects(
    collectBrightDataVendorNotice(
      { vendor: "Slack", sourceUrl: slackSourceUrl },
      brightDataConfig,
      fetcher,
      async () => {}
    ),
    error => {
      assert.match(error instanceof Error ? error.message : String(error), /Bright Data trigger request failed with HTTP 401/);
      assert.doesNotMatch(error instanceof Error ? error.message : String(error), /test-token-that-must-not-leak|src\/slack-upload\.ts/);
      return true;
    }
  );
});

test("Bright Data collection rejects an uncurated source before making a request", async () => {
  let requestMade = false;
  const fetcher: typeof fetch = async () => {
    requestMade = true;
    return response("[]");
  };

  await assert.rejects(
    collectBrightDataVendorNotice(
      { vendor: "Slack", sourceUrl: "https://example.com/private-repository-notice" },
      brightDataConfig,
      fetcher,
      async () => {}
    ),
    /curated first-party source/
  );
  assert.equal(requestMade, false);
});

test("the live collection adapter does not need credentials for the offline path", () => {
  assert.doesNotThrow(() => collectVendorNotice(slackFixture));
});
