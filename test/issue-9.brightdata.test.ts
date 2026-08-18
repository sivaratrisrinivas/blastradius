import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  brightDataConfigFromEnvironment,
  collectBrightDataVendorNotice,
  loadEnvironmentFile
} from "../src/collection/bright-data.js";
import { scanLocalRepository } from "../src/scan/scan.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvironmentFile(resolve(repositoryRoot, ".env"));

const hasBrightDataCredentials = [
  process.env.BRIGHTDATA_API_KEY ?? process.env.BRIGHT_DATA_API_TOKEN,
  process.env.BRIGHTDATA_COLLECTOR_ID ?? process.env.BRIGHT_DATA_COLLECTOR_ID
].every(value => value !== undefined && value.trim() !== "");

test("opt-in Bright Data Scraper Studio collection reaches a local Impact", { skip: hasBrightDataCredentials ? false : "set BRIGHTDATA_API_KEY and BRIGHTDATA_COLLECTOR_ID to run the live contract" }, async () => {
  const sourceUrl = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
  const artifact = await collectBrightDataVendorNotice(
    { vendor: "Slack", sourceUrl },
    brightDataConfigFromEnvironment()
  );
  const scan = scanLocalRepository(resolve(repositoryRoot, "fixtures/repository"), artifact);

  assert.equal(artifact.notice.sourceUrl, sourceUrl);
  assert.match(artifact.collection?.collector.identity ?? "", /^c_/);
  assert.ok(artifact.collection?.collector.version);
  assert.ok(artifact.collection?.content);
  assert.equal(scan.codeMatches.length, 1);
  assert.equal(scan.impact?.codeMatches[0]?.file, "src/slack-upload.ts");
});
