import { readFile } from "node:fs/promises";

export async function readNotes(path: string): Promise<string[]> {
  const contents = await readFile(path, "utf8");
  return contents.split("\n").filter(line => line.trim() !== "");
}
