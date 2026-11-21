/**
 * Parsing for free-text numeric form fields. Inputs keep their raw string so
 * users can type "0.", clear the field, or enter "0,5"; the value is parsed
 * where it is used and invalid text is reported instead of silently replaced.
 */

export interface NumberInputSpec {
  /** Inclusive lower bound. */
  min?: number
  /** Exclusive lower bound (e.g. `gt: 0` for strictly positive values). */
  gt?: number
  /** Inclusive upper bound. */
  max?: number
  /** Empty text is allowed and parses to `null`. */
  optional?: boolean
}

export type ParsedNumber = { ok: true; value: number | null } | { ok: false; error: string }

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const SEPARATOR_ERROR = "Pakai titik atau koma desimal saja, tanpa pemisah ribuan"

/** "1,000" or "1.000,5" could mean a thousands separator, so they are rejected rather than guessed. */
function isAmbiguousSeparator(text: string): boolean {
  const commas = (text.match(/,/g) ?? []).length
  if (commas === 0) return false
  return commas > 1 || text.includes(".") || /^[+-]?[1-9]\d{0,2},\d{3}$/.test(text)
}

export function parseNumberInput(raw: string, spec: NumberInputSpec = {}): ParsedNumber {
  const trimmed = raw.trim()
  if (trimmed === "") return spec.optional ? { ok: true, value: null } : { ok: false, error: "Wajib diisi" }
  if (isAmbiguousSeparator(trimmed)) return { ok: false, error: SEPARATOR_ERROR }
  const text = trimmed.replace(",", ".")
  if (!NUMBER_RE.test(text)) return { ok: false, error: "Bukan angka yang valid" }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, error: "Bukan angka yang valid" }
  return checkBounds(value, spec)
}

function checkBounds(value: number, spec: NumberInputSpec): ParsedNumber {
  if (spec.gt !== undefined && value <= spec.gt) return { ok: false, error: `Harus lebih dari ${spec.gt}` }
  if (spec.min !== undefined && value < spec.min) return { ok: false, error: `Minimal ${spec.min}` }
  if (spec.max !== undefined && value > spec.max) return { ok: false, error: `Maksimal ${spec.max}` }
  return { ok: true, value }
}

/** Returns the parsed number, or null when the field is invalid or empty. */
export function numberOrNull(parsed: ParsedNumber): number | null {
  return parsed.ok ? parsed.value : null
}
