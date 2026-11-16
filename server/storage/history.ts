import { execFile } from "node:child_process"
import { access, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { isEditablePath, SCAFFOLD_FILES } from "../../shared/project-paths.js"
import { NotFoundError } from "./errors.js"
import type { FileMap } from "./project-files.js"

const run = promisify(execFile)

/** Hooks, signing and user config never apply to CDS's own commits. */
const GIT_FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=CDS", "-c", "user.email=cds@localhost", "-c", "core.quotepath=off"]
/** Ignore system and global git config (autocrlf, templates, aliases): CDS commits must be predictable. */
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }
const MAX_OUTPUT = 32 * 1024 * 1024
const MAX_DIFF_CHARS = 300_000
const SHA = /^[0-9a-f]{7,40}$/
const IGNORE = ["node_modules/", "dist/", ".cds/", "*.log", ".DS_Store", ""].join("\n")

export class HistoryUnavailableError extends Error {}

export interface Version {
  sha: string
  shortSha: string
  message: string
  createdAt: number
  files: string[]
}

async function git(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", [...GIT_FLAGS, ...args], { cwd: dir, env: GIT_ENV, maxBuffer: MAX_OUTPUT })
    return stdout
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HistoryUnavailableError("git tidak terpasang di server")
    throw error
  }
}

let gitAvailable: Promise<boolean> | null = null

export function isGitAvailable(): Promise<boolean> {
  gitAvailable ??= run("git", ["--version"]).then(
    () => true,
    () => false,
  )
  return gitAvailable
}

export async function hasRepo(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, ".git"))
    return true
  } catch {
    return false
  }
}

/** Starts version history for a project folder (idempotent). */
export async function ensureRepo(dir: string): Promise<void> {
  if (await hasRepo(dir)) return
  await git(dir, ["init", "-q", "-b", "main"])
  await writeFile(path.join(dir, ".gitignore"), IGNORE)
  await commitAll(dir, "Riwayat dimulai")
}

/** Commits everything that changed; returns the new sha, or null when nothing changed. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ["add", "-A"])
  const status = await git(dir, ["status", "--porcelain"])
  if (!status.trim()) return null
  await git(dir, ["commit", "-q", "--no-verify", "-m", message.slice(0, 500)])
  return (await git(dir, ["rev-parse", "HEAD"])).trim()
}

export async function isDirty(dir: string): Promise<boolean> {
  return (await git(dir, ["status", "--porcelain"])).trim() !== ""
}

const RECORD = "\x1e"
const FIELD = "\x1f"

export async function listVersions(dir: string, limit = 200): Promise<Version[]> {
  const out = await git(dir, ["log", `-n${limit}`, `--format=${RECORD}%H${FIELD}%h${FIELD}%at${FIELD}%s`, "--name-only"])
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [header, ...rest] = chunk.split("\n")
      const [sha, shortSha, time, message] = header.split(FIELD)
      return { sha, shortSha, message, createdAt: Number(time) * 1000, files: rest.map((line) => line.trim()).filter(Boolean) }
    })
}

async function assertCommit(dir: string, sha: string): Promise<string> {
  if (!SHA.test(sha)) throw new NotFoundError("Versi tidak ditemukan")
  try {
    return (await git(dir, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`])).trim()
  } catch {
    throw new NotFoundError("Versi tidak ditemukan")
  }
}

/** "abc1234: message" for a version, used when restoring it. */
export async function versionLabel(dir: string, sha: string): Promise<string> {
  const full = await assertCommit(dir, sha)
  return (await git(dir, ["log", "-1", "--format=%h: %s", full])).trim()
}

/** Patch of one version against its parent (or the whole tree for the first one). */
export async function versionDiff(dir: string, sha: string): Promise<{ diff: string; truncated: boolean }> {
  const full = await assertCommit(dir, sha)
  const diff = await git(dir, ["show", "--format=", "--patch", "--no-color", "--no-ext-diff", full])
  return diff.length > MAX_DIFF_CHARS ? { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true } : { diff, truncated: false }
}

/** Editable files as they were in a version (what "restore" puts back). */
export async function filesAt(dir: string, sha: string): Promise<FileMap> {
  const full = await assertCommit(dir, sha)
  const listing = await git(dir, ["ls-tree", "-r", "-z", "--name-only", full])
  const files: FileMap = {}
  for (const file of listing.split("\0").filter(Boolean)) {
    if (SCAFFOLD_FILES.has(file) || !isEditablePath(file)) continue
    files[file] = await git(dir, ["show", `${full}:${file}`])
  }
  return files
}
