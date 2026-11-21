/** What tscircuit core accepts after `net.`: no dots, +/-, spaces or a leading digit. */
export const NET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Maps a KiCad net name (+3V3, /SDA, Net-(R1-Pad1)) onto a valid tscircuit net name. */
export function sanitizeNetName(raw: string): string {
  const withoutSheet = raw.trim().replace(/^\/+/, "")
  const overbar = withoutSheet.match(/^~\{(.+)\}$/)
  const base = overbar ? overbar[1] : withoutSheet
  const signed = base.replace(/^\+/, "P").replace(/^-/, "N")
  const cleaned = signed
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!cleaned) return "NET"
  return /^[0-9]/.test(cleaned) ? `N_${cleaned}` : cleaned
}

function nextFree(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * Raw net name -> unique valid name, in input order. Names that are already valid claim their
 * spelling first, so sanitising another net can never steal it.
 */
export function buildNetNameMap(rawNames: readonly string[]): { names: Map<string, string>; renamed: number } {
  const unique = [...new Set(rawNames)]
  const valid = unique.filter((raw) => NET_NAME_PATTERN.test(raw))
  const used = new Set(valid)
  const assigned = new Map(valid.map((raw) => [raw, raw] as const))
  for (const raw of unique) {
    if (assigned.has(raw)) continue
    const name = nextFree(sanitizeNetName(raw), used)
    used.add(name)
    assigned.set(raw, name)
  }
  const names = new Map(unique.map((raw) => [raw, assigned.get(raw) ?? raw] as const))
  return { names, renamed: unique.length - valid.length }
}
