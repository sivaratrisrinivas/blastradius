import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { renderImpactReport } from "../src/report/render.js";
import type { JsonValue } from "../src/domain/artifacts.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const scanFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-analysis-limitations");

function runCli(args: string[]): string {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("the Impact Report exposes an accessible three-action browser workflow", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-8-");
  const collectionPath = resolve(outputDirectory, "vendor-notice.json");
  const scanPath = resolve(outputDirectory, "scan-result.json");
  const reportPath = resolve(outputDirectory, "impact-report.html");

  runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  runCli(["report", "--scan", scanPath, "--output", reportPath]);
  const report = readFileSync(reportPath, "utf8");

  assert.equal((report.match(/<button[^>]*data-primary-action/g) ?? []).length, 3);
  assert.match(report, /role="progressbar"[^>]*aria-valuemin="1"[^>]*aria-valuemax="3"[^>]*aria-valuenow="1"/);
  assert.match(report, /id="workflow-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(report, /data-busy-label="Verifying official evidence…"/);
  assert.match(report, /data-busy-label="Scanning locally…"/);
  assert.match(report, /data-busy-label="Building the Impact Report…"/);
  assert.match(report, /nextScreen\.querySelector\("h1"\)\?\.focus\(\)/);
  assert.match(report, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(report, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(report, /data-section="authoritative-evidence"/);
  assert.match(report, /data-section="capability-change"/);
  assert.match(report, /data-section="deadline-status"/);
  assert.match(report, /data-section="proven-code-matches"/);
  assert.match(report, /data-section="analysis-limitations"/);
  assert.match(report, /Repository analysis stayed local/);
  assert.match(report, /Confirmed Impact/);
});

test("the report refuses to label an invalid stored result a Confirmed Impact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-8-invariant-");
  const collectionPath = resolve(outputDirectory, "vendor-notice.json");
  const scanPath = resolve(outputDirectory, "scan-result.json");

  runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  const invalidScan = JSON.parse(readFileSync(scanPath, "utf8"));
  invalidScan.impact = null;
  writeFileSync(scanPath, `${JSON.stringify(invalidScan)}\n`, "utf8");

  const storedInvalidScan = JSON.parse(readFileSync(scanPath, "utf8"));
  assert.throws(() => renderImpactReport(storedInvalidScan), /must contain an Impact/);
});

class FakeElement {
  public hidden = false;
  public disabled = false;
  public textContent = "";
  public focused = false;
  public readonly classList = {
    toggle: (_name: string, _force?: boolean): void => undefined
  };
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, (event?: { preventDefault(): void }) => void>();

  public constructor(
    public readonly dataset: Record<string, string> = {},
    private readonly children: ReadonlyMap<string, FakeElement> = new Map()
  ) {}

  public querySelector(selector: string): FakeElement | null {
    return this.children.get(selector) ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public addEventListener(name: string, listener: (event?: { preventDefault(): void }) => void): void {
    this.listeners.set(name, listener);
  }

  public click(): void {
    this.listeners.get("click")?.({ preventDefault: () => undefined });
  }

  public focus(): void {
    this.focused = true;
  }
}

class FakeDocument {
  public constructor(
    private readonly screens: FakeElement[],
    private readonly steps: FakeElement[],
    private readonly segments: FakeElement[],
    private readonly buttons: FakeElement[],
    private readonly progress: FakeElement,
    private readonly status: FakeElement,
    private readonly workflow: FakeElement,
    private readonly skipLink: FakeElement
  ) {}

  public querySelectorAll(selector: string): FakeElement[] {
    if (selector === "[data-screen]") return this.screens;
    if (selector === "[data-step]") return this.steps;
    if (selector === "[data-progress-segment]") return this.segments;
    if (selector === "[data-primary-action]") return this.buttons;
    return [];
  }

  public querySelector(selector: string): FakeElement | null {
    if (selector === "[role=progressbar]") return this.progress;
    if (selector === ".skip-link") return this.skipLink;
    if (selector === "[data-screen]:not([hidden]) h1") {
      return this.screens.find(screen => !screen.hidden)?.querySelector("h1") ?? null;
    }
    return null;
  }

  public getElementById(id: string): FakeElement | null {
    if (id === "progress-label") return this.progress;
    if (id === "workflow-status") return this.status;
    if (id === "workflow") return this.workflow;
    return null;
  }
}

interface PendingTimer {
  callback: () => void;
  delay: number;
}

function browserWorkflowReport(): string {
  const change = {
    vendor: "Slack",
    canonicalIdentifier: "slack.files.upload",
    changeType: "shutdown",
    deadlineOriginal: "November 12, 2025",
    deadlineIso: "2025-11-12"
  };
  const match = {
    vendor: "Slack",
    capabilityIdentifier: "slack.files.upload",
    file: "demo/example.ts",
    line: 6,
    evidenceStrength: "direct",
    context: "example",
    evidence: "return slack.files.upload({ file });"
  };
  const reportInput: JsonValue = {
    schemaVersion: 1,
    kind: "scan-result",
    notice: {
      vendor: "Slack",
      sourceUrl: "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/",
      retrievedAt: "2026-08-18T00:00:00Z",
      excerpt: "The files.upload method stopped functioning on November 12, 2025."
    },
    capabilityChange: change,
    codeMatches: [match],
    limitations: [{ file: "demo/runtime.ts", line: 19, reason: "Computed or dynamic Slack endpoint access cannot be statically proven." }],
    impact: { capabilityChange: change, codeMatches: [match] }
  };
  return renderImpactReport(reportInput, new Date("2026-08-18T00:00:00Z"));
}

test("the browser workflow moves through three actions with busy state, focus, and progress updates", () => {
  const report = browserWorkflowReport();
  const script = report.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);

  const headings = [new FakeElement(), new FakeElement(), new FakeElement(), new FakeElement()];
  const screens = ["notice", "repository", "results", "report"].map((name, index) => {
    const screen = new FakeElement({ screen: name }, new Map([["h1", headings[index]]]));
    screen.hidden = index !== 0;
    return screen;
  });
  const steps = [new FakeElement(), new FakeElement(), new FakeElement()];
  const segments = [new FakeElement(), new FakeElement(), new FakeElement()];
  const buttons = ["repository", "results", "report"].map((next, index) => {
    const label = new FakeElement();
    label.textContent = ["Verify the vendor notice", "Scan the local repository", "Open the Impact Report"][index];
    const spinner = new FakeElement();
    spinner.hidden = true;
    return new FakeElement(
      { next, busyLabel: ["Verifying official evidence…", "Scanning locally…", "Building the Impact Report…"][index] },
      new Map([[".button-label", label], [".button-spinner", spinner]])
    );
  });
  const progress = new FakeElement();
  const status = new FakeElement();
  const workflow = new FakeElement();
  const skipLink = new FakeElement();
  const document = new FakeDocument(screens, steps, segments, buttons, progress, status, workflow, skipLink);
  const timers: PendingTimer[] = [];
  const window = {
    matchMedia: () => ({ matches: true }),
    setTimeout: (callback: () => void, delay: number): number => {
      timers.push({ callback, delay });
      return timers.length;
    }
  };

  runInNewContext(script, { document, window });
  assert.equal(buttons.length, 3);
  assert.equal(progress.getAttribute("aria-valuenow"), "1");
  assert.equal(steps[0].getAttribute("aria-current"), "step");

  buttons.forEach((button, index) => {
    button.click();
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(workflow.getAttribute("aria-busy"), "true");
    assert.match(status.textContent, /Please wait/);
    const timer = timers.shift();
    assert.ok(timer);
    assert.equal(timer.delay, 0);
    timer.callback();
    assert.equal(screens[index].hidden, true);
    assert.equal(screens[index + 1].hidden, false);
    assert.equal(headings[index + 1].focused, true);
    assert.equal(progress.getAttribute("aria-valuenow"), String(Math.min(index + 2, 3)));
    assert.equal(workflow.getAttribute("aria-busy"), "false");
  });
  assert.equal(steps[2].getAttribute("aria-current"), "step");
  assert.equal(status.textContent, "Open report ready.");
  headings.forEach(heading => { heading.focused = false; });
  skipLink.click();
  assert.equal(headings[3].focused, true);
});
