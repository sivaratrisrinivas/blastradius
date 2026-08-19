import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const driftFixture = resolve(repositoryRoot, "fixtures/collector-health/required-field-collapse.json");
const healedRerunFixture = resolve(repositoryRoot, "fixtures/collector-health/healed-rerun.json");
const gateProgress = resolve(repositoryRoot, "fixtures/heal/awaiting-approval.progress.json");
const resumedProgress = resolve(repositoryRoot, "fixtures/heal/resumed-done.progress.json");
const scanFixtureRepository = resolve(repositoryRoot, "fixtures/repository");

function runCli(args: string[]): void {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("Chromium completes the optional collector healing second act after the Impact Report", async () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-12-browser-");
  const collectionPath = resolve(outputDirectory, "vendor-notice.json");
  const scanPath = resolve(outputDirectory, "scan-result.json");
  const reportPath = resolve(outputDirectory, "impact-report.html");
  const diagnosticPath = resolve(outputDirectory, "collector-health.json");
  const detectedPath = resolve(outputDirectory, "heal-detected.json");
  const gatedPath = resolve(outputDirectory, "heal-gated.json");
  const approvedPath = resolve(outputDirectory, "heal-approved.json");
  const rerunPath = resolve(outputDirectory, "heal-rerun.json");

  runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  const detected = spawnSync(process.execPath, [cliPath, "collect", "--fixture", driftFixture, "--output", diagnosticPath], { cwd: repositoryRoot, encoding: "utf8" });
  assert.notEqual(detected.status, 0);
  runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--last-known-good", collectionPath, "--output", detectedPath]);
  runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--output", gatedPath]);
  runCli(["heal", "approve", "--heal", gatedPath, "--recorded", resumedProgress, "--output", approvedPath]);
  runCli(["heal", "rerun", "--heal", approvedPath, "--fixture", healedRerunFixture, "--output", rerunPath]);
  runCli(["report", "--scan", scanPath, "--heal", rerunPath, "--output", reportPath]);

  const browser = await chromium.launch({ headless: true });
  const browserProblems: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("console", message => {
      if (message.type() === "warning" || message.type() === "error") browserProblems.push(`console ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", error => browserProblems.push(`pageerror: ${error.message}`));
    await page.goto(pathToFileURL(reportPath).href);

    const advance = async (buttonName: string, screen: string, heading: string): Promise<void> => {
      const button = page.locator(`[data-next="${screen}"]`);
      assert.equal(await button.getByText(buttonName, { exact: true }).count(), 1);
      await button.click();
      assert.equal(await button.getAttribute("aria-busy"), "true");
      assert.equal(await button.isDisabled(), true);
      await page.waitForTimeout(325);
      assert.equal(await page.locator(`[data-screen="${screen}"]`).isVisible(), true);
      assert.equal(await page.locator(`#${heading}`).evaluate(element => document.activeElement === element), true);
    };

    await advance("Verify the vendor notice", "repository", "repository-heading");
    await advance("Scan the local repository", "results", "results-heading");
    await advance("Open the impact report", "report", "report-heading");

    await advance("See how collector healing works", "drift", "drift-heading");
    assert.match((await page.locator('[data-section="collector-health-detected"]').textContent()) ?? "", /only these three checks/);
    assert.match((await page.locator('[data-section="heal-prompt"]').textContent()) ?? "", /capabilityIdentifier/);

    await advance("See what Bright Data proposed", "approval", "approval-heading");
    const diff = page.locator('[data-section="collector-heal-diff"]');
    assert.match((await diff.textContent()) ?? "", /article p:first-of-type code/);
    assert.match((await diff.textContent()) ?? "", /article h1/);
    assert.equal(await page.locator('[data-diff-line="removed"]').count() > 0, true);
    assert.equal(await page.locator('[data-diff-line="added"]').count() > 0, true);

    await advance("Approve the proposed template", "healed", "healed-heading");
    assert.match((await page.locator('[data-section="collector-heal-result"]').textContent()) ?? "", /Healthy rerun completed/);
  } finally {
    await browser.close();
  }
  assert.deepEqual(browserProblems, []);
  assert.ok(readFileSync(reportPath, "utf8").includes("collector-healing"));
});
