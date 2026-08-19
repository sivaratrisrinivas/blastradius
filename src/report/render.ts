import {
  assertScanArtifact,
  assertCollectorHealArtifact,
  type CollectorHealArtifact,
  type CollectorHealDiff,
  type DeadlineStatus,
  type JsonValue,
  type ScanArtifact
} from "../domain/artifacts.js";
import { capabilitiesProvable, curatedSourceForIdentifier, curatedVendorCount } from "../domain/capabilities.js";
import { changedLinesWithContext, lineDiff } from "./line-diff.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function displayCapability(identifier: string): string {
  return curatedSourceForIdentifier(identifier)?.displayName ?? identifier;
}

/**
 * ADR 0002: the report states both numbers and never lets the larger one stand in for the smaller.
 * Vendors watched counts curated first-party sources; capabilities provable counts the matchers.
 */
function coverage(): string {
  return `<section class="evidence limitation-panel" data-section="coverage" aria-labelledby="coverage-heading">
          <div class="section-heading"><span class="section-kicker">Boundary</span><h2 id="coverage-heading">Watched and provable are different numbers</h2></div>
          <dl class="field-list">
            <div><dt>Vendors watched</dt><dd data-coverage="vendors-watched">${curatedVendorCount()}</dd></div>
            <div><dt>Capabilities provable</dt><dd data-coverage="capabilities-provable">${capabilitiesProvable()}</dd></div>
          </dl>
          <p class="muted">Blast Radius collects and health-checks ${curatedVendorCount()} curated first-party sources. Only ${capabilitiesProvable()} of them have a repository matcher, so only ${capabilitiesProvable()} capabilities can ever become an Impact. A WatchedVendor contributes CollectorHealth and CollectorHeal evidence and nothing else.</p>
        </section>`;
}

function parseCodeDiff(diff: CollectorHealDiff): string {
  const marker = { context: " ", removed: "-", added: "+", elided: "  …" };
  const rows = changedLinesWithContext(lineDiff(diff.parseCodeBefore, diff.parseCodeAfter), 2)
    .map(line => `<span class="diff-line" data-diff-line="${line.kind}">${marker[line.kind]} ${escapeHtml(line.text)}</span>`)
    .join("\n");
  return `<pre class="diff" data-section="heal-parse-code-diff" aria-label="Proposed change to the collector parse code"><code>${rows}</code></pre>`;
}

export function deadlineStatus(deadlineIso: string | null, now: Date): DeadlineStatus {
  if (deadlineIso === null) return "date-not-stated";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const deadline = Date.parse(`${deadlineIso}T00:00:00.000Z`);
  return deadline < today ? "past" : "upcoming";
}

function locations(scan: ScanArtifact): string {
  return scan.impact?.codeMatches.map(match => `
          <li class="location" data-record-kind="code-match">
            <div class="location-heading"><strong><code>${escapeHtml(match.file)}:${match.line}</code></strong><span class="evidence-tag">Proven</span></div>
            <code class="snippet">${escapeHtml(match.evidence)}</code>
            <dl class="match-meta">
              <div><dt>Evidence</dt><dd>${escapeHtml(match.evidenceStrength)}</dd></div>
              <div><dt>Context</dt><dd>${escapeHtml(match.context)}</dd></div>
            </dl>
          </li>`).join("") ?? "";
}

function limitations(scan: ScanArtifact): string {
  if (scan.limitations.length === 0) {
    return `<section class="evidence limitation-panel" data-section="analysis-limitations" aria-labelledby="analysis-limitations-heading">
        <div class="section-heading"><span class="section-kicker">Boundary</span><h2 id="analysis-limitations-heading">Analysis Limitations</h2></div>
        <p class="muted">No unresolved usage was recorded. Unsupported or dynamic constructs remain outside confirmed output.</p>
      </section>`;
  }
  return `<section class="evidence limitation-panel" data-section="analysis-limitations" aria-labelledby="analysis-limitations-heading">
        <div class="section-heading"><span class="section-kicker">Boundary</span><h2 id="analysis-limitations-heading">Analysis Limitations</h2></div>
        <p class="muted">These locations are disclosed for review, but were not promoted to CodeMatches or an Impact because the scanner could not prove their use.</p>
        <ul class="locations">${scan.limitations.map(limitation => `<li class="location" data-record-kind="analysis-limitation"><div class="location-heading"><strong><code>${escapeHtml(limitation.file)}:${limitation.line}</code></strong><span class="evidence-tag limitation-tag">Unproven</span></div><span>${escapeHtml(limitation.reason)}</span></li>`).join("")}</ul>
      </section>`;
}

const WORKFLOW_STEP_LABELS = ["Verify notice", "Scan repository", "Open report"] as const;

function workflowSteps(): string {
  return `<nav class="workflow-nav" aria-label="Impact workflow">
      <p id="progress-label" class="sr-only">Step 1 of 3: ${WORKFLOW_STEP_LABELS[0]}</p>
      <div class="progress-track" role="progressbar" aria-labelledby="progress-label" aria-valuemin="1" aria-valuemax="3" aria-valuenow="1" aria-valuetext="Step 1 of 3: ${WORKFLOW_STEP_LABELS[0]}">
        <span class="progress-segment is-current" data-progress-segment="1"></span><span class="progress-segment" data-progress-segment="2"></span><span class="progress-segment" data-progress-segment="3"></span>
      </div>
      <ol class="steps">
        <li data-step="1" aria-current="step"><span class="step-number">1</span><span>${WORKFLOW_STEP_LABELS[0]}</span></li>
        <li data-step="2"><span class="step-number">2</span><span>${WORKFLOW_STEP_LABELS[1]}</span></li>
        <li data-step="3"><span class="step-number">3</span><span>${WORKFLOW_STEP_LABELS[2]}</span></li>
      </ol>
    </nav>`;
}

function workflowScript(): string {
  return `<script>
    (() => {
      const screens = [...document.querySelectorAll("[data-screen]")];
      const steps = [...document.querySelectorAll("[data-step]")];
      const segments = [...document.querySelectorAll("[data-progress-segment]")];
      const progress = document.querySelector("[role=progressbar]");
      const progressLabel = document.getElementById("progress-label");
      const status = document.getElementById("workflow-status");
      const workflow = document.getElementById("workflow");
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      const transitionDelay = prefersReducedMotion ? 0 : 260;
      const stepCopy = ${JSON.stringify(WORKFLOW_STEP_LABELS)};

      const updateProgress = index => {
        const value = index + 1;
        const text = \`Step \${value} of 3: \${stepCopy[index]}\`;
        progress?.setAttribute("aria-valuenow", String(value));
        progress?.setAttribute("aria-valuetext", text);
        if (progressLabel) progressLabel.textContent = text;
        segments.forEach((segment, segmentIndex) => {
          segment.classList.toggle("is-complete", segmentIndex < index);
          segment.classList.toggle("is-current", segmentIndex === index);
        });
        steps.forEach((step, stepIndex) => {
          if (stepIndex === index) step.setAttribute("aria-current", "step");
          else step.removeAttribute("aria-current");
        });
      };

      const moveTo = (next, button) => {
        const nextScreen = screens.find(screen => screen.dataset.screen === next);
        const index = screens.findIndex(screen => screen.dataset.screen === next);
        if (!nextScreen || index < 0) return;
        screens.forEach(screen => {
          const isNext = screen === nextScreen;
          screen.hidden = !isNext;
          screen.classList.toggle("is-entering", isNext);
        });
        updateProgress(Math.min(index, 2));
        if (workflow) workflow.setAttribute("aria-busy", "false");
        if (status) status.textContent = \`\${stepCopy[Math.min(index, 2)]} ready.\`;
        nextScreen.querySelector("h1")?.focus();
        button?.removeAttribute("aria-busy");
      };

      const actionButtons = [
        ...document.querySelectorAll("[data-primary-action]"),
        ...document.querySelectorAll("[data-optional-action]")
      ];
      actionButtons.forEach(button => button.addEventListener("click", () => {
        if (button.disabled) return;
        const next = button.dataset.next;
        const busyLabel = button.dataset.busyLabel;
        const originalLabel = button.querySelector(".button-label")?.textContent ?? button.textContent ?? "Working";
        const spinner = button.querySelector(".button-spinner");
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        if (spinner) spinner.hidden = false;
        button.querySelector(".button-label").textContent = busyLabel;
        if (workflow) workflow.setAttribute("aria-busy", "true");
        if (status) status.textContent = \`\${busyLabel} Please wait.\`;
        window.setTimeout(() => {
          moveTo(next, button);
          button.querySelector(".button-label").textContent = originalLabel;
          if (spinner) spinner.hidden = true;
          button.disabled = false;
        }, transitionDelay);
      }));

      document.querySelector(".skip-link")?.addEventListener("click", event => {
        event.preventDefault();
        document.querySelector("[data-screen]:not([hidden]) h1")?.focus();
      });

      updateProgress(0);
    })();
  </script>`;
}

export function renderImpactReport(value: JsonValue, now = new Date(), healValue?: JsonValue): string {
  const scan = assertScanArtifact(value);
  const heal: CollectorHealArtifact | undefined = healValue === undefined ? undefined : assertCollectorHealArtifact(healValue);
  const impact = scan.impact;
  if (!impact || impact.codeMatches.length === 0 || impact.codeMatches.length !== scan.codeMatches.length) {
    throw new Error("cannot generate an Impact Report without a proven CodeMatch");
  }

  const status = deadlineStatus(scan.capabilityChange.deadlineIso, now);
  const notice = impact.capabilityChange;
  const capability = displayCapability(notice.canonicalIdentifier);
  const collector = heal?.collector ?? { identity: "stored-collector", version: "not-recorded" };
  const limitedHealthMessage = "CollectorHealth covers only these three checks: zero-results, required-field-collapse, and schema-failure; passing them does not establish semantic correctness or completeness.";
  const healApproved = heal?.approval.status === "approved";
  const healRerunHealthy = heal?.rerun.status === "healthy";
  // A heal that has not run yet has no proposal to show, so the drift screen is the last one.
  const healReachedGate = heal?.heal.diff !== undefined && heal?.heal.diff !== null;
  const healEvidence = heal?.heal.source === "recorded"
    ? "This before and after is replayed from a recorded Bright Data response, not a live call."
    : "This before and after is the template Bright Data returned from a live self-healing call.";
  const driftHeading = heal?.detected.signal === "required-field-collapse"
    ? "The collector lost a required field"
    : `CollectorHealth ${heal?.detected.signal ?? "failure"} detected`;
  const reportTitle = `${notice.vendor} ${capability} Impact`;
  const normalizedDate = notice.deadlineIso === null
    ? `<span>Not stated</span>`
    : `<time datetime="${escapeHtml(notice.deadlineIso)}">${escapeHtml(notice.deadlineIso)}</time>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blast Radius — ${escapeHtml(reportTitle)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #24322a;
      --muted: #657269;
      --paper: #fffaf1;
      --surface: #fffefb;
      --line: #e5e1d7;
      --accent: #267458;
      --accent-strong: #1d6148;
      --mint: #e6f3e9;
      --peach: #fff0dc;
      --peach-ink: #74512e;
      --rose: #fae9e4;
      --rose-ink: #8c4237;
      --focus: #b76814;
      --shadow: 0 18px 48px rgb(94 72 43 / 10%);
      font-family: "Avenir Next", Avenir, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html { accent-color: var(--accent); }
    body { margin: 0; color: var(--ink); background: var(--paper); line-height: 1.55; }
    body::before { content: ""; display: block; height: 10px; background: #f4c990; }
    ::selection { color: var(--ink); background: #f7d7a8; }
    a { color: var(--accent-strong); text-decoration-thickness: .1em; text-underline-offset: .16em; }
    a:focus-visible, button:focus-visible, [tabindex="-1"]:focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; }
    main { width: min(800px, calc(100% - 40px)); min-height: calc(100vh - 10px); margin: 0 auto; padding: 30px 0 72px; }
    h1, h2, p { margin-top: 0; }
    h1 { max-width: 18ch; margin-bottom: 14px; font-family: Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, ui-serif, serif; font-size: clamp(2.25rem, 6vw, 4rem); font-weight: 700; letter-spacing: -.04em; line-height: 1.04; text-wrap: balance; }
    h2 { margin-bottom: 10px; font-family: Iowan Old Style, Palatino Linotype, Georgia, ui-serif, serif; font-size: clamp(1.55rem, 4vw, 2rem); line-height: 1.1; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .skip-link { position: absolute; top: 0; left: 1rem; padding: .7rem 1rem; color: #fff; background: var(--ink); transform: translateY(-140%); }
    .skip-link:focus { transform: translateY(.75rem); }
    .masthead { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .brand { font-family: Iowan Old Style, Palatino Linotype, Georgia, ui-serif, serif; font-size: 1.1rem; font-weight: 700; letter-spacing: -.02em; }
    .eyebrow { color: var(--muted); font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .workflow-nav { margin: 34px 0 64px; }
    .progress-track { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; height: 6px; margin-bottom: 12px; }
    .progress-segment { border-radius: 999px; background: var(--line); }
    .progress-segment.is-complete, .progress-segment.is-current { background: var(--accent); }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; padding: 0; margin: 0; list-style: none; color: var(--muted); font-size: .8rem; }
    .steps li { display: flex; align-items: center; gap: .45rem; min-width: 0; }
    .steps li[aria-current="step"] { color: var(--ink); font-weight: 800; }
    .step-number { display: grid; flex: 0 0 1.5rem; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid currentColor; border-radius: 50%; font-size: .72rem; font-variant-numeric: tabular-nums; }
    .screen[hidden] { display: none; }
    .screen.is-entering { animation: reveal 300ms cubic-bezier(.16, 1, .3, 1) both; }
    .lead { max-width: 65ch; margin-bottom: 32px; color: var(--muted); font-size: 1.05rem; }
    .evidence, .privacy { padding: 24px; margin: 0 0 24px; border: 1px solid rgb(229 225 215 / 70%); border-radius: 16px; background: var(--surface); box-shadow: var(--shadow); }
    .section-heading { margin-bottom: 18px; }
    .section-kicker, .label { display: block; margin-bottom: 7px; color: var(--muted); font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .quote { max-width: 60ch; margin-bottom: 14px; font-family: Iowan Old Style, Palatino Linotype, Georgia, ui-serif, serif; font-size: 1.18rem; font-weight: 650; line-height: 1.45; }
    button { display: inline-flex; justify-content: center; align-items: center; gap: .65rem; width: 100%; min-height: 58px; padding: 15px 20px; border: 0; border-radius: 14px; color: #fff; background: var(--accent); box-shadow: 0 8px 22px rgb(38 116 88 / 18%); font: inherit; font-weight: 800; cursor: pointer; transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
    button:hover:not(:disabled) { background: var(--accent-strong); box-shadow: 0 10px 28px rgb(38 116 88 / 24%); transform: translateY(-1px); }
    button:active:not(:disabled) { box-shadow: 0 4px 14px rgb(38 116 88 / 18%); transform: translateY(1px); }
    button:disabled { cursor: wait; opacity: .72; }
    .button-spinner { width: 1rem; height: 1rem; border: 2px solid rgb(255 255 255 / 45%); border-top-color: #fff; border-radius: 50%; animation: spin 800ms linear infinite; }
    .privacy { color: #315741; background: var(--mint); box-shadow: none; }
    .report-header { display: flex; justify-content: space-between; align-items: start; gap: 24px; margin-bottom: 36px; }
    .impact-status { display: inline-flex; align-items: center; gap: .45rem; width: fit-content; padding: 5px 10px; margin-bottom: 16px; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent-strong); background: var(--mint); font-size: .78rem; font-weight: 800; }
    .impact-status::before { content: "✓"; font-weight: 900; }
    .deadline-card { min-width: 190px; padding: 16px 18px; border: 1px solid #e9c999; border-radius: 14px; color: var(--peach-ink); background: var(--peach); }
    .deadline-card strong { display: block; margin: 4px 0; font-size: 1.18rem; }
    .deadline-card time, .deadline-card span { display: block; }
    .field-list { display: grid; gap: 0; margin: 0; }
    .field-list > div { display: grid; grid-template-columns: minmax(8rem, .4fr) 1fr; gap: 1rem; padding: 12px 0; border-top: 1px solid var(--line); }
    .field-list > div:last-child { border-bottom: 1px solid var(--line); }
    dt { color: var(--muted); font-size: .78rem; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .locations { padding: 0; margin: 0; list-style: none; border-top: 1px solid var(--line); }
    .location { display: grid; gap: 8px; padding: 18px 0; border-bottom: 1px solid var(--line); }
    .location-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .snippet { overflow-wrap: anywhere; }
    .diff { max-height: 22rem; padding: 14px 16px; overflow: auto; border: 1px solid var(--line); border-radius: 12px; background: #fdfbf6; font-size: .78rem; line-height: 1.55; tab-size: 2; }
    .diff code { display: grid; }
    .diff-line { display: block; padding: 0 6px; white-space: pre; border-radius: 4px; }
    .diff-line[data-diff-line="removed"] { color: var(--rose-ink); background: var(--rose); }
    .diff-line[data-diff-line="added"] { color: var(--accent-strong); background: var(--mint); }
    .diff-line[data-diff-line="elided"] { color: var(--muted); }
    .match-meta { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0; color: var(--muted); font-size: .8rem; }
    .match-meta div { display: flex; gap: .35rem; }
    .match-meta dt { font-size: .68rem; }
    .match-meta dd { font-weight: 700; }
    .evidence-tag { display: inline-block; padding: 3px 8px; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent-strong); background: var(--mint); font-size: .7rem; font-weight: 800; letter-spacing: .02em; }
    .limitation-panel { border-color: #e6beb4; background: #fffaf8; }
    .limitation-tag { border-color: var(--rose-ink); color: var(--rose-ink); background: var(--rose); }
    .muted, .meta { color: var(--muted); }
    .fine-print { color: var(--muted); font-size: .82rem; }
    @keyframes reveal { from { opacity: .65; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 600px) {
      main { width: min(100% - 28px, 800px); padding-top: 22px; }
      .workflow-nav { margin: 26px 0 48px; }
      .steps { gap: .5rem; font-size: .72rem; }
      .step-number { flex-basis: 1.3rem; width: 1.3rem; height: 1.3rem; }
      .evidence, .privacy { padding: 20px; }
      .report-header { display: block; }
      .deadline-card { margin-top: 20px; }
      .field-list > div { grid-template-columns: 1fr; gap: .25rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#workflow">Skip to workflow</a>
  <main id="main-content">
    <header class="masthead">
      <span class="brand">Blast Radius</span>
      <span class="eyebrow">Proof-first impact report</span>
    </header>
    ${workflowSteps()}
    <div id="workflow" tabindex="-1" aria-busy="false">
      <p id="workflow-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">Ready to verify vendor notice.</p>
      <section id="workflow-heading" class="screen" data-screen="notice" aria-labelledby="notice-heading">
        <h1 id="notice-heading" tabindex="-1">Verify the vendor notice</h1>
        <p class="lead">Start with the authoritative statement. Blast Radius only interprets a change after its source and lifecycle evidence pass the assertion gates.</p>
        <section class="evidence" data-section="authoritative-evidence" aria-labelledby="notice-evidence-heading">
          <span class="section-kicker">Authoritative evidence</span>
          <h2 id="notice-evidence-heading">${escapeHtml(notice.vendor)} · first-party source</h2>
          <p class="quote">“${escapeHtml(scan.notice.excerpt)}”</p>
          <p><a href="${escapeHtml(scan.notice.sourceUrl)}">${escapeHtml(scan.notice.sourceUrl)}</a></p>
        </section>
        <button type="button" data-primary-action data-next="repository" data-busy-label="Verifying official evidence…" aria-controls="workflow"><span class="button-label">Verify the vendor notice</span><span class="button-spinner" aria-hidden="true" hidden></span></button>
      </section>
      <section class="screen" data-screen="repository" aria-labelledby="repository-heading" hidden>
        <h1 id="repository-heading" tabindex="-1">Scan the local repository</h1>
        <p class="lead">The notice names <code>${escapeHtml(notice.canonicalIdentifier)}</code>. Now look for deterministic proof on this machine.</p>
        <section class="privacy" data-section="privacy-boundary" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">Local-only analysis</h2>
          <p>Repository source, paths, snippets, and scan artifacts stay on this machine. Only public vendor material crosses the collection boundary.</p>
        </section>
        <button type="button" data-primary-action data-next="results" data-busy-label="Scanning locally…" aria-controls="workflow"><span class="button-label">Scan the local repository</span><span class="button-spinner" aria-hidden="true" hidden></span></button>
      </section>
      <section class="screen" data-screen="results" aria-labelledby="results-heading" hidden>
        <h1 id="results-heading" tabindex="-1">Open the impact report</h1>
        <p class="lead">The local scan proved ${impact.codeMatches.length} CodeMatch${impact.codeMatches.length === 1 ? "" : "es"}. Nothing becomes an Impact without vendor-provenanced evidence.</p>
        <section class="evidence" aria-labelledby="result-summary-heading">
          <span class="section-kicker">Scan complete</span>
          <h2 id="result-summary-heading">${impact.codeMatches.length} proven location${impact.codeMatches.length === 1 ? "" : "s"}</h2>
          <p class="muted">${scan.limitations.length === 0 ? "No unresolved usage was recorded." : `${scan.limitations.length} Analysis Limitation${scan.limitations.length === 1 ? "" : "s"} remain disclosed in the report.`}</p>
        </section>
        <button type="button" data-primary-action data-next="report" data-busy-label="Building the Impact Report…" aria-controls="workflow"><span class="button-label">Open the impact report</span><span class="button-spinner" aria-hidden="true" hidden></span></button>
      </section>
      <section class="screen" data-screen="report" aria-labelledby="report-heading" hidden>
        <header class="report-header">
          <div>
            <p class="impact-status">Confirmed Impact</p>
            <h1 id="report-heading" tabindex="-1">${escapeHtml(notice.vendor)} <code>${escapeHtml(capability)}</code></h1>
            <p class="muted">A confirmed Impact exists because the stored scan contains ${impact.codeMatches.length} vendor-provenanced CodeMatch${impact.codeMatches.length === 1 ? "" : "es"}.</p>
          </div>
          <div class="deadline-card" data-section="deadline-status" aria-labelledby="deadline-heading">
            <span id="deadline-heading" class="section-kicker">Deadline status</span>
            <strong>${escapeHtml(status)}</strong>
            <span>Original: ${escapeHtml(notice.deadlineOriginal)}</span>
            <span>Normalized: ${normalizedDate}</span>
          </div>
        </header>
        <section class="evidence" data-section="authoritative-evidence" aria-labelledby="authoritative-evidence-heading">
          <div class="section-heading"><span class="section-kicker">Source record</span><h2 id="authoritative-evidence-heading">Authoritative evidence</h2></div>
          <blockquote class="quote" cite="${escapeHtml(scan.notice.sourceUrl)}">“${escapeHtml(scan.notice.excerpt)}”</blockquote>
          <dl class="field-list">
            <div><dt>Source URL</dt><dd><a href="${escapeHtml(scan.notice.sourceUrl)}">${escapeHtml(scan.notice.sourceUrl)}</a></dd></div>
            <div><dt>Retrieved</dt><dd><time datetime="${escapeHtml(scan.notice.retrievedAt)}">${escapeHtml(scan.notice.retrievedAt)}</time></dd></div>
          </dl>
        </section>
        <section class="evidence" data-section="capability-change" aria-labelledby="capability-change-heading">
          <div class="section-heading"><span class="section-kicker">Interpreted change</span><h2 id="capability-change-heading">CapabilityChange</h2></div>
          <dl class="field-list">
            <div><dt>Vendor</dt><dd>${escapeHtml(notice.vendor)}</dd></div>
            <div><dt>Capability</dt><dd><code>${escapeHtml(notice.canonicalIdentifier)}</code></dd></div>
            <div><dt>Change type</dt><dd>${escapeHtml(notice.changeType)}</dd></div>
            <div><dt>Original deadline</dt><dd>${escapeHtml(notice.deadlineOriginal)}</dd></div>
          </dl>
        </section>
        <section class="evidence" data-section="proven-code-matches" aria-labelledby="proven-code-matches-heading">
          <div class="section-heading"><span class="section-kicker">Deterministic local analysis</span><h2 id="proven-code-matches-heading">Proven CodeMatches</h2></div>
          <p class="muted">Every location below is independently connected to the affected capability by the local scanner.</p>
          <ul class="locations">${locations(scan)}</ul>
        </section>
        ${limitations(scan)}
        ${coverage()}
        <section class="privacy" data-section="privacy-boundary" aria-labelledby="report-privacy-heading">
          <h2 id="report-privacy-heading">Repository analysis stayed local</h2>
          <p>Source, paths, snippets, and scan artifacts were not sent externally. Only public vendor material crossed the collection boundary.</p>
        </section>
        ${heal ? `<section class="evidence" data-section="collector-healing" aria-labelledby="collector-healing-heading">
          <div class="section-heading"><span class="section-kicker">Optional second act</span><h2 id="collector-healing-heading">Collector healing</h2></div>
          <p class="muted">The Impact Report is complete. This optional trust-layer view follows the stored CollectorHealth signal and the CollectorHeal it produced; it does not add a fourth action to the core report.</p>
          <button type="button" data-optional-action data-next="drift" data-busy-label="Showing detected collector drift…" aria-controls="workflow"><span class="button-label">See how collector healing works</span><span class="button-spinner" aria-hidden="true" hidden></span></button>
        </section>` : ""}
        <p class="fine-print">The report is proof-first: Blast Radius may miss usage it cannot prove, but it never presents unproved usage as an Impact.</p>
      </section>
      ${heal ? `<section class="screen" data-screen="drift" aria-labelledby="drift-heading" hidden>
        <h1 id="drift-heading" tabindex="-1">${escapeHtml(driftHeading)}</h1>
        <p class="lead">Blast Radius stopped the affected output instead of publishing incomplete evidence. This optional second act does not change the core Impact Report.</p>
        <section class="evidence limitation-panel" data-section="collector-health-detected" aria-labelledby="collector-health-detected-heading">
          <div class="section-heading"><span class="section-kicker">CollectorHealth detected</span><h2 id="collector-health-detected-heading">${escapeHtml(heal.detected.signal)}</h2></div>
          <p>${escapeHtml(heal.diagnosis)} The collector remains <code>${escapeHtml(collector.identity)}@${escapeHtml(collector.version)}</code>; healing moves its template, never its identity.</p>
          <p class="fine-print">${escapeHtml(limitedHealthMessage)}</p>
        </section>
        <section class="evidence" data-section="heal-prompt" aria-labelledby="heal-prompt-heading">
          <div class="section-heading"><span class="section-kicker">Composed from the signal</span><h2 id="heal-prompt-heading">The prompt sent to Bright Data</h2></div>
          <p class="muted">The prompt is built from the detected signal rather than typed by hand, so it names the field that collapsed and what that field last held.</p>
          <blockquote class="quote">${escapeHtml(heal.prompt.text)}</blockquote>
        </section>
        ${healReachedGate
          ? `<button type="button" data-optional-action data-next="approval" data-busy-label="Reading the proposed template…" aria-controls="workflow"><span class="button-label">See what Bright Data proposed</span><span class="button-spinner" aria-hidden="true" hidden></span></button>`
          : `<p class="fine-print" data-section="heal-not-sent">${escapeHtml(heal.heal.message)} There is nothing to approve until it is.</p>`}
      </section>` : ""}
      ${healReachedGate && heal?.heal.diff ? `<section class="screen" data-screen="approval" aria-labelledby="approval-heading" hidden>
        <h1 id="approval-heading" tabindex="-1">Bright Data proposed a new parse step</h1>
        <p class="lead">Bright Data paused at its own approval gate. Nothing is saved until a human decides, and Blast Radius never sends an auto-approve or auto-save flag.</p>
        <section class="evidence" data-section="collector-heal-diff" aria-labelledby="collector-heal-diff-heading">
          <div class="section-heading"><span class="section-kicker">Awaiting a human</span><h2 id="collector-heal-diff-heading">Proposed change to <code>parse_code</code></h2></div>
          <p class="muted">${escapeHtml(healEvidence)}</p>
          ${parseCodeDiff(heal.heal.diff)}
          <p>${escapeHtml(heal.heal.message)}</p>
          <p class="fine-print">Completed steps: ${escapeHtml(heal.heal.completedSteps.join(", "))}.</p>
        </section>
        <button type="button" data-optional-action data-next="healed" data-busy-label="Recording the human decision…" aria-controls="workflow"><span class="button-label">${healApproved ? "Approve the proposed template" : "See the recorded decision"}</span><span class="button-spinner" aria-hidden="true" hidden></span></button>
      </section>` : ""}
      ${healReachedGate ? `<section class="screen" data-screen="healed" aria-labelledby="healed-heading" hidden>
        <h1 id="healed-heading" tabindex="-1">${healRerunHealthy ? "The collector returned healthy output" : healApproved ? "The collector is awaiting a healthy rerun" : "The proposed template was rejected"}</h1>
        <p class="lead">${escapeHtml(heal.approval.message)}</p>
        <section class="evidence${healApproved ? "" : " limitation-panel"}" data-section="collector-heal-result" aria-labelledby="collector-heal-result-heading">
          <div class="section-heading"><span class="section-kicker">Collector health</span><h2 id="collector-heal-result-heading">${healRerunHealthy ? "Healthy rerun completed" : healApproved ? "Healthy rerun not completed" : "Nothing was changed"}</h2></div>
          <p>${escapeHtml(heal.rerun.message)} ${escapeHtml(limitedHealthMessage)}</p>
        </section>
      </section>` : ""}
    </div>
  </main>
  ${workflowScript()}
</body>
</html>\n`;
}
