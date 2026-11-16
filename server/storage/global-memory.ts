import { readFile } from "node:fs/promises"
import path from "node:path"
import { isRegularFile, writeFileAtomic } from "./fs-utils.js"
import { MAX_MEMORY_CHARS } from "./projects.js"

/** Notes about the user that apply to every project (preferred parts, habits…). */
export function createGlobalMemoryStore(dataDir: string) {
  const file = path.join(dataDir, "memory.md")
  return {
    async read(): Promise<string> {
      return (await isRegularFile(file)) ? readFile(file, "utf8") : ""
    },
    async write(content: string): Promise<void> {
      await writeFileAtomic(file, content.slice(0, MAX_MEMORY_CHARS))
    },
  }
}

export type GlobalMemoryStore = ReturnType<typeof createGlobalMemoryStore>
