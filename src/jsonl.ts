import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonl(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
