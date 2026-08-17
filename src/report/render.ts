import {
  assertScanArtifact,
  type DeadlineStatus,
  type JsonValue,
  type ScanArtifact
} from "../domain/artifacts.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function deadlineStatus(deadlineIso: string | null, now: Date): DeadlineStatus {
  if (deadlineIso === null) return "date-not-stated";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const deadline = Date.parse(`${deadlineIso}T00:00:00.000Z`);
  return deadline < today ? "past" : "upcoming";
}

function locations(scan: ScanArtifact): string {
  return scan.impact?.codeMatches.map(match => `
    <li class="location">
      <strong><code>${escapeHtml(match.file)}:${match.line}</code></strong>
      <code class="snippet">${escapeHtml(match.evidence)}</code>
      <span class="meta">${escapeHtml(match.evidenceStrength)} · ${escapeHtml(match.context)}</span>
    </li>`).join("") ?? "";
}

function limitations(scan: ScanArtifact): string {
  if (scan.limitations.length === 0) return "";
  return `<section class="evidence"><h2>Analysis limitations</h2><p class="muted">These usages were not promoted to CodeMatches because the scanner could not prove them.</p><ul class="locations">${scan.limitations.map(limitation => `<li class="location"><strong><code>${escapeHtml(limitation.file)}:${limitation.line}</code></strong><span>${escapeHtml(limitation.reason)}</span></li>`).join("")}</ul></section>`;
}

export function renderImpactReport(value: JsonValue, now = new Date()): string {
  const scan = assertScanArtifact(value);
  if (!scan.impact || scan.impact.codeMatches.length === 0) {
    throw new Error("cannot generate an Impact Report without a proven CodeMatch");
  }

  const status = deadlineStatus(scan.capabilityChange.deadlineIso, now);
  const notice = scan.impact.capabilityChange;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blast Radius — Slack files.upload Impact</title>
  <style>
    :root { color-scheme: light; --ink: #24322a; --muted: #657269; --paper: #fffaf1; --surface: #fffefb; --line: #e5e1d7; --accent: #267458; --mint: #e6f3e9; --peach: #fff0dc; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--paper); font: 16px/1.55 system-ui, sans-serif; }
    main { width: min(760px, calc(100% - 40px)); margin: 0 auto; padding: 42px 0 72px; }
    h1 { max-width: 18ch; font: 700 clamp(2rem, 6vw, 3.5rem)/1.05 Georgia, serif; letter-spacing: -.03em; }
    h2 { margin-top: 0; font: 700 1.7rem/1.1 Georgia, serif; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }
    .muted, .meta { color: var(--muted); }
    .steps { display: flex; gap: 8px; padding: 0; margin: 0 0 52px; list-style: none; color: var(--muted); font-size: .85rem; }
    .steps li { flex: 1; padding-top: 8px; border-top: 4px solid var(--line); }
    .steps li.active { color: var(--accent); border-color: var(--accent); font-weight: 700; }
    .screen[hidden] { display: none; }
    .evidence, .privacy { padding: 22px; margin: 24px 0; border-radius: 14px; background: var(--surface); box-shadow: 0 16px 42px rgb(94 72 43 / 9%); }
    .label { color: var(--muted); font-size: .75rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    blockquote { margin: 14px 0 0; font: 600 1.2rem/1.45 Georgia, serif; }
    button { width: 100%; min-height: 56px; border: 0; border-radius: 12px; color: white; background: var(--accent); font: inherit; font-weight: 800; cursor: pointer; }
    button:focus-visible { outline: 3px solid #e7a85f; outline-offset: 4px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; color: var(--accent); background: var(--mint); font-size: .78rem; font-weight: 800; }
    .deadline { padding: 16px; border-radius: 12px; background: var(--peach); }
    .deadline strong { display: block; font-size: 1.25rem; }
    .locations { padding: 0; list-style: none; border-top: 1px solid var(--line); }
    .location { display: grid; gap: 5px; padding: 18px 0; border-bottom: 1px solid var(--line); }
    .snippet { overflow-wrap: anywhere; }
    .privacy { color: #315741; background: var(--mint); box-shadow: none; }
  </style>
</head>
<body>
  <main>
    <p><strong>Blast Radius</strong> · proof-first impact report</p>
    <ol class="steps" aria-label="Core workflow">
      <li class="active">1. Verify notice</li><li>2. Scan repository</li><li>3. Open report</li>
    </ol>
    <section class="screen" data-screen="notice">
      <h1 tabindex="-1">Verify the vendor notice</h1>
      <p class="muted">This is official Slack evidence. Confirm the exact statement before looking at local code.</p>
      <div class="evidence">
        <p class="label">Slack · first-party source</p>
        <blockquote>“${escapeHtml(scan.notice.excerpt)}”</blockquote>
        <p><a href="${escapeHtml(scan.notice.sourceUrl)}">${escapeHtml(scan.notice.sourceUrl)}</a></p>
      </div>
      <button type="button" data-primary-action data-next="repository">Verify the vendor notice</button>
    </section>
    <section class="screen" data-screen="repository" hidden>
      <h1 tabindex="-1">Scan the local repository</h1>
      <p class="muted">The notice names <code>${escapeHtml(notice.canonicalIdentifier)}</code>. Scan the repository on this machine to find proof.</p>
      <div class="privacy"><strong>Local-only analysis.</strong> Repository source, paths, snippets, and scan artifacts stay on this machine.</div>
      <button type="button" data-primary-action data-next="results">Scan the local repository</button>
    </section>
    <section class="screen" data-screen="results" hidden>
      <h1 tabindex="-1">Open the impact report</h1>
      <p class="muted">The scan found ${scan.impact.codeMatches.length} proven CodeMatch. Nothing becomes an Impact without this evidence.</p>
      <button type="button" data-primary-action data-next="report">Open the impact report</button>
    </section>
    <section class="screen" data-screen="report" hidden>
      <p class="badge">Confirmed Impact</p>
      <h1 tabindex="-1">Slack <code>files.upload</code></h1>
      <div class="deadline"><span>Original deadline: ${escapeHtml(notice.deadlineOriginal)}</span><strong>${escapeHtml(status)}</strong><span>Normalized date: ${escapeHtml(notice.deadlineIso ?? "not stated")}</span></div>
      <div class="evidence">
        <p class="label">Authoritative evidence</p>
        <blockquote>${escapeHtml(scan.notice.excerpt)}</blockquote>
        <p class="muted">${escapeHtml(scan.notice.sourceUrl)}</p>
      </div>
      <h2>Proven code location</h2>
      <ul class="locations">${locations(scan)}</ul>
      ${limitations(scan)}
      <div class="privacy"><strong>Repository analysis stayed local.</strong> Only public vendor material crossed the collection boundary.</div>
    </section>
  </main>
  <script>
    const screens = [...document.querySelectorAll("[data-screen]")];
    const steps = [...document.querySelectorAll(".steps li")];
    document.querySelectorAll("[data-primary-action]").forEach(button => button.addEventListener("click", () => {
      const next = button.dataset.next;
      screens.forEach(screen => { screen.hidden = screen.dataset.screen !== next; });
      const index = screens.findIndex(screen => screen.dataset.screen === next);
      steps.forEach((step, stepIndex) => step.classList.toggle("active", stepIndex <= index));
      screens[index]?.querySelector("h1")?.focus();
    }));
  </script>
</body>
</html>\n`;
}
