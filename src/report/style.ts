import type { DeadlineStatus } from "../domain/artifacts.js";

/** How urgently a deadline should draw the eye: matches the three colours this module ever uses. */
export type UrgencyLevel = "critical" | "warning" | "none";

export interface Styler {
  readonly enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  cyan(text: string): string;
  boldCyan(text: string): string;
  urgency(text: string, level: UrgencyLevel): string;
}

const RESET = "\x1b[0m";
const SGR = {
  bold: "1",
  dim: "2",
  red: "31",
  amber: "33",
  cyan: "36"
} as const;

function wrap(enabled: boolean, codes: readonly string[], text: string): string {
  if (!enabled || text.length === 0) return text;
  return `\x1b[${codes.join(";")}m${text}${RESET}`;
}

/**
 * Terminal styling is opt-in twice over: a real TTY on stdout, and no explicit opt-out. Piped and
 * redirected output — every acceptance test that spawns the CLI — never sees an escape code.
 */
export function styleEnabled(stream: { readonly isTTY?: boolean }, environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stream.isTTY) && environment.NO_COLOR === undefined;
}

/** Red under 14 days remaining or past due; amber under 90; unstyled beyond that or when no date was stated. */
export function deadlineUrgency(status: DeadlineStatus, daysRemaining: number | null): UrgencyLevel {
  if (status === "past") return "critical";
  if (status === "date-not-stated" || daysRemaining === null) return "none";
  if (daysRemaining < 14) return "critical";
  if (daysRemaining < 90) return "warning";
  return "none";
}

export function createStyler(enabled: boolean): Styler {
  return {
    enabled,
    bold: text => wrap(enabled, [SGR.bold], text),
    dim: text => wrap(enabled, [SGR.dim], text),
    cyan: text => wrap(enabled, [SGR.cyan], text),
    boldCyan: text => wrap(enabled, [SGR.bold, SGR.cyan], text),
    urgency: (text, level) => level === "critical"
      ? wrap(enabled, [SGR.red], text)
      : level === "warning"
        ? wrap(enabled, [SGR.amber], text)
        : text
  };
}
