#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computeEvalTable, renderEvalTableMarkdown } from "./eval-table.js";
import { repositoryRoot } from "./scan-fixtures.js";

const START_MARKER = "<!-- eval-table:start -->";
const END_MARKER = "<!-- eval-table:end -->";

export function spliceEvalTable(readme: string, tableMarkdown: string): string {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md is missing matching ${START_MARKER} / ${END_MARKER} markers`);
  }
  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);
  return `${before}\n\n${tableMarkdown}\n\n${after}`;
}

async function main(): Promise<void> {
  const readmePath = resolve(repositoryRoot, "README.md");
  const table = await computeEvalTable();
  const markdown = renderEvalTableMarkdown(table);
  const readme = readFileSync(readmePath, "utf8");
  writeFileSync(readmePath, spliceEvalTable(readme, markdown), "utf8");
  process.stdout.write("Eval table regenerated from the fixture suite and written into README.md.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
