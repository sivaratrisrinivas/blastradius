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
const scanFixtureRepository = resolve(repositoryRoot, "fixtures/repository");

function runCli(args: string[]): void {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
}

test("Chromium completes the optional collector recovery second act after the Impact Report", async () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-11-browser-");
  const collectionPath = resolve(outputDirectory, "vendor-notice.json");
  const scanPath = resolve(outputDirectory, "scan-result.json");
  const reportPath = resolve(outputDirectory, "impact-report.html");

  runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  runCli(["report", "--scan", scanPath, "--output", reportPath]);

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
      const button = page.locator(`[data-primary-action][data-next="${screen}"]`);
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
    await advance("See how collector recovery works", "drift", "drift-heading");
    assert.match((await page.locator('[data-section="collector-health-detected"]').textContent()) ?? "", /only these three checks/);
    await advance("Diagnose and validate a repair", "approval", "approval-heading");
    assert.match((await page.locator('[data-section="collector-repair-validation"]').textContent()) ?? "", /Validation passed/);
    assert.match((await page.locator('[data-section="collector-repair-validation"]').textContent()) ?? "", /remains/);
    await advance("Approve and activate fixture-v2", "recovered", "recovered-heading");
    assert.match((await page.locator('[data-section="collector-recovery-result"]').textContent()) ?? "", /Healthy rerun completed/);
  } finally {
    await browser.close();
  }
  assert.deepEqual(browserProblems, []);
  assert.ok(readFileSync(reportPath, "utf8").includes("collector-recovery"));
});
