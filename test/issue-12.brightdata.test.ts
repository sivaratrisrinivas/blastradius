import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { brightDataConfigFromEnvironment, loadEnvironmentFile } from "../src/collection/bright-data.js";
import { brightDataHealDriver } from "../src/collection/bright-data-heal.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvironmentFile(resolve(repositoryRoot, ".env"));

const hasBrightDataCredentials = [
  process.env.BRIGHTDATA_API_KEY ?? process.env.BRIGHT_DATA_API_TOKEN,
  process.env.BRIGHTDATA_COLLECTOR_ID ?? process.env.BRIGHT_DATA_COLLECTOR_ID
].every(value => value !== undefined && value.trim() !== "");

/**
 * Credentials alone are not enough. Unlike the collection contract, a heal starts a real job on
 * the live collector and spends credits, so it needs deliberate intent rather than a configured
 * `.env` that happens to be present.
 */
const optedIntoLiveHeal = (process.env.BLASTRADIUS_LIVE_HEAL ?? "").trim() !== "";

/**
 * The narrow live contract for self-healing. It spends Bright Data credits and takes two to three
 * minutes, so it is opt-in and always ends in `reject`: the collector must be left exactly as it
 * was found. The offline suite replays recorded responses of these same shapes.
 */
test("opt-in Bright Data self-healing reaches the approval gate and rejects without changing the collector", {
  skip: hasBrightDataCredentials && optedIntoLiveHeal
    ? false
    : "set BRIGHTDATA_API_KEY, BRIGHTDATA_COLLECTOR_ID, and BLASTRADIUS_LIVE_HEAL=1 to run the live heal contract; it starts a real job and spends credits"
}, async () => {
  const driver = brightDataHealDriver(brightDataConfigFromEnvironment());
  const gate = await driver.heal(
    "Contract check only: confirm the approval gate still pauses before saving. Field capabilityIdentifier is read from the notice page; do not change the template."
  );

  assert.match(gate.jobId, /^ia_/);
  assert.ok(gate.completedSteps.includes("user_approval") || gate.completedSteps.includes("step_advance"));
  assert.ok(gate.parseCodeBefore.length > 0);
  assert.ok(gate.parseCodeAfter.length > 0);

  const settlement = await driver.resume("reject");
  assert.equal(settlement.status, "done");
  assert.ok(settlement.completedSteps.includes("user_approval"));
});
