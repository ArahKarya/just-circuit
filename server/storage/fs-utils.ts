import { randomBytes } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
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

/** Real directory, not a symlink to one. */
export async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await lstat(dir)).isDirectory()
  } catch {
    return false
  }
}

/** Reads a .cds JSON file, refusing symlinks (they could point at settings.json or sessions.json). */
export async function readOwnJson<T>(file: string, fallback: T): Promise<T> {
  const info = await lstat(file).catch(() => null)
  if (!info) return fallback
  if (!info.isFile()) throw new Error(`Refusing to read ${path.basename(file)}: not a regular file`)
  return readJsonFile<T>(file, fallback)
}


/** Regular file, not a symlink or folder. */
export async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile()
  } catch {
    return false
  }
}
