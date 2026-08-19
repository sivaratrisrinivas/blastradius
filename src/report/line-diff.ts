export type DiffLineKind = "context" | "removed" | "added" | "elided";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

function longestCommonSubsequenceLengths(before: readonly string[], after: readonly string[]): number[][] {
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () => Array.from<number>({ length: after.length + 1 }).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = before[left] === after[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  return lengths;
}

/**
 * A line-level diff of two code bodies, used to show what Bright Data actually rewrote rather
 * than asking a reviewer to compare two full listings by eye.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lengths = longestCommonSubsequenceLengths(beforeLines, afterLines);
  const lines: DiffLine[] = [];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length && right < afterLines.length) {
    if (beforeLines[left] === afterLines[right]) {
      lines.push({ kind: "context", text: beforeLines[left] });
      left += 1;
      right += 1;
    } else if (lengths[left + 1][right] >= lengths[left][right + 1]) {
      lines.push({ kind: "removed", text: beforeLines[left] });
      left += 1;
    } else {
      lines.push({ kind: "added", text: afterLines[right] });
      right += 1;
    }
  }
  for (; left < beforeLines.length; left += 1) lines.push({ kind: "removed", text: beforeLines[left] });
  for (; right < afterLines.length; right += 1) lines.push({ kind: "added", text: afterLines[right] });
  return lines;
}

/**
 * Collapses runs of unchanged lines so a long template shows its change in context. Each collapsed
 * run becomes a single `elided` line.
 */
export function changedLinesWithContext(lines: readonly DiffLine[], context: number): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let offset = -context; offset <= context; offset += 1) {
      const neighbour = index + offset;
      if (neighbour >= 0 && neighbour < lines.length) keep.add(neighbour);
    }
  });
  const kept: DiffLine[] = [];
  let collapsing = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      kept.push(line);
      collapsing = false;
      return;
    }
    if (!collapsing) {
      kept.push({ kind: "elided", text: "" });
      collapsing = true;
    }
  });
  return kept;
}
