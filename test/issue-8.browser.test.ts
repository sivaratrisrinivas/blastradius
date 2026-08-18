import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const scanFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-analysis-limitations");

function runCli(args: string[]): void {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
}

test("Chromium completes the three-action workflow and renders without browser errors", async () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-8-browser-");
  const collectionPath = resolve(outputDirectory, "vendor-notice.json");
  const scanPath = resolve(outputDirectory, "scan-result.json");
  const reportPath = resolve(outputDirectory, "impact-report.html");
  const screenshotPath = resolve(outputDirectory, "impact-report.png");

  runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  runCli(["report", "--scan", scanPath, "--output", reportPath]);
  assert.ok(readFileSync(reportPath, "utf8").includes("Confirmed Impact"));

  const browser = await chromium.launch({ headless: true });
  const browserProblems: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on("console", message => {
      if (message.type() === "warning" || message.type() === "error") browserProblems.push(`console ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", error => browserProblems.push(`pageerror: ${error.message}`));

    await page.goto(pathToFileURL(reportPath).href);
    assert.equal(await page.title(), "Blast Radius — Slack files.upload Impact");
    assert.equal(await page.getByRole("button", { name: "Verify the vendor notice" }).count(), 1);
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "1");

    const advance = async (screen: string, progress: string, heading: string): Promise<void> => {
      const button = page.locator(`[data-primary-action][data-next="${screen}"]`);
      await button.click();
      assert.equal(await button.getAttribute("aria-busy"), "true");
      assert.equal(await button.isDisabled(), true);
      assert.match((await page.locator("#workflow-status").textContent()) ?? "", /Please wait/);
      await page.waitForTimeout(325);
      assert.equal(await page.locator(`[data-screen="${screen}"]`).isVisible(), true);
      assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), progress);
      assert.equal(await page.locator(`#${heading}`).evaluate(element => document.activeElement === element), true);
    };

    await advance("repository", "2", "repository-heading");
    await advance("results", "3", "results-heading");
    await advance("report", "3", "report-heading");

    const reportScreen = page.locator('[data-screen="report"]');
    assert.equal(await reportScreen.locator('[data-section="authoritative-evidence"]').isVisible(), true);
    assert.equal(await reportScreen.locator('[data-section="proven-code-matches"]').isVisible(), true);
    assert.equal(await reportScreen.locator('[data-section="analysis-limitations"]').isVisible(), true);
    const skipLink = page.getByRole("link", { name: "Skip to workflow" });
    await skipLink.focus();
    await skipLink.press("Enter");
    assert.equal(await page.locator("#report-heading").evaluate(element => document.activeElement === element), true);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.ok(readFileSync(screenshotPath).byteLength > 0);
  } finally {
    await browser.close();
  }
  assert.deepEqual(browserProblems, []);
});
