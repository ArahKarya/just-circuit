/** Errors and warnings from one preview run, as plain messages. */
export interface ClassifiedRun {
  errors: string[]
  warnings: string[]
}

/**
 * Checks that report a real design concern but don't stop the circuit from building.
 * They are shown as warnings and never trigger the AI auto-fix loop.
 */
const WARNING_MESSAGES = [
  // Part-orientation analysis: the auto-picked JLCPCB part has the opposite diode polarity.
  /but supplier part .+ matching diode polarity/i,
]

export function describeRunError(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error_message ?? record.error
    if (typeof message === "string") return message
  }
  try {
    return JSON.stringify(error).slice(0, 500)
  } catch {
    return "Error tidak dikenal"
  }
}

function isWarning(error: unknown, message: string): boolean {
  const type = error && typeof error === "object" ? (error as Record<string, unknown>).type : undefined
  return (typeof type === "string" && type.endsWith("_warning")) || WARNING_MESSAGES.some((pattern) => pattern.test(message))
}

export function classifyRunErrors(errors: readonly unknown[]): ClassifiedRun {
  const result: ClassifiedRun = { errors: [], warnings: [] }
  for (const error of errors) {
    const message = describeRunError(error)
    if (!message) continue
    if (isWarning(error, message)) result.warnings.push(message)
    else result.errors.push(message)
  }
  return result
}
