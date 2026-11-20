/** Bug reports about Just Circuit itself (not about a circuit design), shared by server and client. */

export const BUG_SOURCES = ["user", "client", "server", "agent"] as const
export type BugSource = (typeof BUG_SOURCES)[number]

export const BUG_STATUSES = ["open", "fixed", "ignored"] as const
export type BugStatus = (typeof BUG_STATUSES)[number]

export const MAX_BUG_TITLE_CHARS = 200
export const MAX_BUG_DETAILS_CHARS = 8000

export interface BugContext {
  projectId?: string
  projectName?: string
  /** Where it happened: a route, a tool name, a UI area. */
  where?: string
  url?: string
  userAgent?: string
}

export interface BugReport {
  id: string
  /** Same fingerprint = same problem; automatic reports are counted instead of repeated. */
  fingerprint: string
  source: BugSource
  title: string
  details: string
  context: BugContext
  status: BugStatus
  count: number
  firstSeen: string
  lastSeen: string
}

export interface NewBugReport {
  source: BugSource
  title: string
  details?: string
  context?: BugContext
}

export const BUG_SOURCE_LABELS: Record<BugSource, string> = {
  user: "Laporan pengguna",
  client: "Error di browser",
  server: "Error di server",
  agent: "Dilaporkan agen AI",
}

const HIDDEN = "[disembunyikan]"

const REDACTIONS: [RegExp, string][] = [
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, `$1-${HIDDEN}`],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, `AIza${HIDDEN}`],
  [/\b(gh[pousr]_)[A-Za-z0-9]{20,}/g, `$1${HIDDEN}`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${HIDDEN}`],
  // URL credentials and query parameters that carry keys: https://user:pass@host, ?key=…, &sig=…
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${HIDDEN}@`],
  [/([?&](?:key|api[_-]?key|sig|signature|auth|token|access[_-]?token|secret|password)=)[^&\s"'#]+/gi, `$1${HIDDEN}`],
  // Cookies and key-like headers or fields, in JSON, headers or key=value form.
  [/\b((?:set-)?cookie\s*:\s*)[^\n]+/gi, `$1${HIDDEN}`],
  [
    /("?(?:api[_-]?key|apikey|x-api-key|x-goog-api-key|password|passwd|secret|client[_-]?secret|access[_-]?key|token|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi,
    `$1${HIDDEN}`,
  ],
]

/** Removes things that look like API keys, tokens or passwords, plus any exact `known` secret. */
export function redactSecrets(text: string, known: readonly string[] = []): string {
  const exact = known.filter((secret) => secret.length >= 6).reduce((out, secret) => out.split(secret).join(HIDDEN), text)
  return REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), exact)
}

/** Terminal escape sequences and control characters, which could make a report imitate tool output. */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[\]P^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b./g
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** One line of plain text: no escapes, no line breaks, no bidi tricks. */
export function toSingleLine(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL_ALL, " ").replace(/ {2,}/g, " ").trim()
}

/** Multi-line plain text: keeps line breaks and tabs, drops escapes and other control characters. */
export function toPlainText(text: string): string {
  return text.replace(ANSI, "").replace(/\r\n?/g, "\n").replace(CONTROL_EXCEPT_NEWLINE, (ch) => (ch === "\t" ? ch : ""))
}

/**
 * Groups repeats of the same automatic error: digits, hex ids and quoted values are blanked so
 * "timeout after 121s" and "timeout after 125s" count as one problem.
 */
export function bugFingerprint(source: BugSource, title: string, where = ""): string {
  const normalized = `${source}|${where}|${title}`
    .toLowerCase()
    .replace(/"[^"]*"|'[^']*'/g, "''")
    .replace(/\b[0-9a-f]{8,}\b/g, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
