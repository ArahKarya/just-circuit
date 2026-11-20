import { randomUUID } from "node:crypto"
import { rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  BUG_SOURCES,
  BUG_STATUSES,
  bugFingerprint,
  MAX_BUG_DETAILS_CHARS,
  MAX_BUG_TITLE_CHARS,
  redactSecrets,
  toPlainText,
  toSingleLine,
  type BugContext,
  type BugReport,
  type BugStatus,
  type NewBugReport,
} from "../../shared/bug-reports.js"
import { NotFoundError } from "./errors.js"
import { readJsonFile, writeJsonFile } from "./fs-utils.js"

/** Past this count, closed reports go first, then the oldest automatic ones, user reports last. */
export const MAX_BUG_REPORTS = 300
/** Automatic (non-user) records accepted per minute, so an error loop cannot churn the file. */
export const MAX_AUTO_RECORDS_PER_MINUTE = 30

const MAX_CONTEXT_FIELD_CHARS = 300
const CONTEXT_KEYS = ["projectId", "projectName", "where", "url", "userAgent"] as const

export interface BugReportStoreOptions {
  now?: () => Date
  /** Exact secrets to hide whatever their format (the stored provider API keys). */
  knownSecrets?: () => Promise<readonly string[]>
}

function isReport(value: unknown): value is BugReport {
  const r = value as Partial<BugReport> | null
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.title === "string" &&
    typeof r.details === "string" &&
    typeof r.fingerprint === "string" &&
    typeof r.count === "number" &&
    typeof r.firstSeen === "string" &&
    typeof r.lastSeen === "string" &&
    BUG_SOURCES.includes(r.source as BugReport["source"]) &&
    BUG_STATUSES.includes(r.status as BugStatus) &&
    !!r.context &&
    typeof r.context === "object"
  )
}

/** Keeps the newest reports, dropping closed ones first and user reports last. */
export function evict(reports: readonly BugReport[], max = MAX_BUG_REPORTS): BugReport[] {
  if (reports.length <= max) return [...reports]
  const rank = (r: BugReport) => (r.status !== "open" ? 0 : r.source !== "user" ? 1 : 2)
  const drop = new Set(
    reports
      .map((r, index) => ({ r, index }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.index - b.index)
      .slice(0, reports.length - max)
      .map(({ r }) => r.id),
  )
  return reports.filter((r) => !drop.has(r.id))
}

/**
 * Bug reports about the app itself, kept in `<dataDir>/bug-reports.json` for a coding agent to
 * read and fix. Report text may come from error messages, outside data or the in-app AI, so it is
 * stored as plain text (no terminal escapes, single-line titles) and is data, never instructions.
 */
export function createBugReportStore(dataDir: string, options: BugReportStoreOptions = {}) {
  const now = options.now ?? (() => new Date())
  const file = path.join(dataDir, "bug-reports.json")
  const home = homedir()
  let tail: Promise<unknown> = Promise.resolve()
  let autoWindow: number[] = []

  const readAll = async (): Promise<BugReport[]> => {
    let data: unknown
    try {
      data = await readJsonFile<unknown>(file, [])
    } catch {
      // Corrupt file: keep it aside for inspection and start fresh instead of failing every report.
      await rename(file, `${file}.corrupt-${now().getTime()}`).catch(() => undefined)
      return []
    }
    return Array.isArray(data) ? data.filter(isReport) : []
  }

  /** Writes run one after another so concurrent reports never overwrite each other. */
  const mutate = <T>(change: (reports: BugReport[]) => { reports: BugReport[]; result: T }): Promise<T> => {
    const run = tail.then(async () => {
      const { reports, result } = change(await readAll())
      await writeJsonFile(file, evict(reports), { mode: 0o600 })
      return result
    })
    tail = run.catch(() => undefined)
    return run
  }

  const scrub = async () => {
    const known = (await options.knownSecrets?.().catch(() => [] as string[])) ?? []
    return (text: string) => redactSecrets(home ? text.split(home).join("~") : text, known)
  }

  const overBudget = (): boolean => {
    const at = now().getTime()
    autoWindow = autoWindow.filter((t) => at - t < 60_000)
    if (autoWindow.length >= MAX_AUTO_RECORDS_PER_MINUTE) return true
    autoWindow = [...autoWindow, at]
    return false
  }

  return {
    file,
    list: readAll,

    /**
     * Stores a report; automatic repeats of an open problem only raise its count. Returns null
     * when an automatic report was dropped by the per-minute budget.
     */
    async record(input: NewBugReport): Promise<BugReport | null> {
      if (input.source !== "user" && overBudget()) return null
      const clean = await scrub()
      const title = toSingleLine(clean(input.title)).slice(0, MAX_BUG_TITLE_CHARS) || "Tanpa judul"
      const details = toPlainText(clean(input.details ?? "")).slice(0, MAX_BUG_DETAILS_CHARS)
      const context: BugContext = {}
      for (const key of CONTEXT_KEYS) {
        const value = input.context?.[key]
        if (typeof value === "string" && value.trim()) context[key] = toSingleLine(clean(value)).slice(0, MAX_CONTEXT_FIELD_CHARS)
      }
      const fingerprint = bugFingerprint(input.source, title, context.where)
      const at = now().toISOString()
      return mutate((reports) => {
        const repeat = input.source === "user" ? undefined : reports.find((r) => r.fingerprint === fingerprint && r.status === "open")
        if (repeat) {
          // Keep the first details: the first occurrence is the one worth reading.
          const updated: BugReport = { ...repeat, count: repeat.count + 1, lastSeen: at, details: repeat.details || details }
          return { reports: [...reports.filter((r) => r.id !== repeat.id), updated], result: updated }
        }
        const report: BugReport = { id: randomUUID(), fingerprint, source: input.source, title, details, context, status: "open", count: 1, firstSeen: at, lastSeen: at }
        return { reports: [...reports, report], result: report }
      })
    },

    setStatus(id: string, status: BugStatus): Promise<BugReport> {
      return mutate((reports) => {
        const found = reports.find((r) => r.id === id)
        if (!found) throw new NotFoundError("Laporan bug tidak ditemukan")
        const updated = { ...found, status }
        return { reports: reports.map((r) => (r.id === id ? updated : r)), result: updated }
      })
    },

    remove(id: string): Promise<void> {
      return mutate((reports) => {
        if (!reports.some((r) => r.id === id)) throw new NotFoundError("Laporan bug tidak ditemukan")
        return { reports: reports.filter((r) => r.id !== id), result: undefined }
      })
    },
  }
}

export type BugReportStore = ReturnType<typeof createBugReportStore>
