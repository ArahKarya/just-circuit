import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** Writes through a temp file + rename so readers never see half a file. */
export async function writeFileAtomic(file: string, content: string, options: { mode?: number } = {}): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await writeFile(temp, content, { mode: options.mode ?? 0o644 })
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback
    throw error
  }
}

export function writeJsonFile(file: string, value: unknown, options: { mode?: number } = {}): Promise<void> {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options)
}

/** Runs tasks for the same key one after another (per-project write lock). */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>()
  return function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}
