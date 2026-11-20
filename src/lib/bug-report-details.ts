import type { CapturedError } from "./bug-capture"

export interface BugReportEnvironment {
  projectName?: string
  buildState?: string
  buildErrors?: readonly string[]
  recentErrors?: readonly CapturedError[]
  userAgent?: string
}

const MAX_LISTED = 5

/** The user's description followed by what the app knew at the time, for whoever fixes the bug. */
export function buildBugDetails(description: string, env: BugReportEnvironment | null): string {
  const parts = [description.trim()]
  if (env) {
    const lines: string[] = []
    if (env.projectName) lines.push(`Proyek: ${env.projectName}`)
    if (env.buildState) lines.push(`Status build: ${env.buildState}`)
    for (const error of (env.buildErrors ?? []).slice(0, MAX_LISTED)) lines.push(`Error build: ${error.slice(0, 300)}`)
    for (const error of (env.recentErrors ?? []).slice(-MAX_LISTED)) lines.push(`Error browser (${error.time}): ${error.message}`)
    if (env.userAgent) lines.push(`Browser: ${env.userAgent}`)
    if (lines.length > 0) parts.push(`--- Konteks otomatis ---\n${lines.join("\n")}`)
  }
  return parts.filter(Boolean).join("\n\n")
}
