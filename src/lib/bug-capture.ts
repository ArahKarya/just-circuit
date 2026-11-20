import { bugFingerprint, type NewBugReport } from "../../shared/bug-reports"

/** Errors the page can't act on: browser noise, extensions, user aborts. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /AbortError/i, /The user aborted a request/i, /signal is aborted/i]

/** At most this many automatic reports per page load, so an error loop cannot flood the log. */
export const MAX_AUTO_REPORTS_PER_SESSION = 5
const RECENT_LIMIT = 20

export interface CapturedError {
  time: string
  message: string
  stack?: string
}

export interface ErrorLike {
  message: string
  stack?: string
  /** Script that threw, when the browser knows it. */
  filename?: string
}

/** Turns whatever was thrown or rejected into a message and stack. */
export function describeThrown(value: unknown): ErrorLike {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack }
  if (typeof value === "string") return { message: value }
  try {
    return { message: JSON.stringify(value)?.slice(0, 300) ?? String(value) }
  } catch {
    return { message: String(value) }
  }
}

export function shouldIgnore(error: ErrorLike): boolean {
  if (error.filename && /^(chrome|moz|safari(-web)?)-extension:/.test(error.filename)) return true
  if (error.stack && /(chrome|moz|safari(-web)?)-extension:\/\//.test(error.stack)) return true
  return IGNORED.some((pattern) => pattern.test(error.message))
}

/**
 * Keeps the last errors for manual reports and decides which ones to file automatically: each
 * distinct error once per page load, and only a handful in total.
 */
export function createErrorCollector(now: () => Date = () => new Date()) {
  const recent: CapturedError[] = []
  const reported = new Set<string>()

  return {
    recent: (): readonly CapturedError[] => [...recent],

    /** Records the error and returns the report to file, or null when it should not be filed. */
    capture(error: ErrorLike): NewBugReport | null {
      if (shouldIgnore(error)) return null
      recent.push({ time: now().toISOString(), message: error.message.slice(0, 500), stack: error.stack?.slice(0, 2000) })
      if (recent.length > RECENT_LIMIT) recent.shift()
      const fingerprint = bugFingerprint("client", error.message)
      if (reported.has(fingerprint) || reported.size >= MAX_AUTO_REPORTS_PER_SESSION) return null
      reported.add(fingerprint)
      return { source: "client", title: error.message.slice(0, 200), details: error.stack ?? "" }
    },
  }
}

export const errorCollector = createErrorCollector()

/** Files uncaught errors and unhandled rejections as "client" bug reports. Returns an uninstaller. */
export function installBugCapture(send: (report: NewBugReport) => Promise<unknown>): () => void {
  const file = (error: ErrorLike) => {
    const report = errorCollector.capture(error)
    if (!report) return
    const context = { where: window.location.pathname, url: window.location.href.split("?")[0], userAgent: navigator.userAgent }
    // Reporting must never throw into the page or loop on its own failure.
    send({ ...report, context }).catch(() => undefined)
  }
  const onError = (event: ErrorEvent) => file({ ...describeThrown(event.error ?? event.message), filename: event.filename })
  const onRejection = (event: PromiseRejectionEvent) => file(describeThrown(event.reason))
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}
