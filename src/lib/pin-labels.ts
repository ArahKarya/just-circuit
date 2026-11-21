/** tscircuit's schematicPinLabel pattern. */
export const PIN_LABEL_PATTERN = /^[A-Za-z0-9_]+$/

export interface PinLabelInput {
  num: number
  raw?: string
}

export interface PinLabel {
  num: number
  label: string
}

/** Cleans one label into tscircuit's pattern; undefined when nothing usable is left. */
export function sanitizePinLabel(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim()
  if (!trimmed || trimmed === "~") return undefined
  const overbar = trimmed.match(/^~\{(.+)\}$/)
  const base = overbar ? `${overbar[1]}_N` : trimmed
  const cleaned = base
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
  return cleaned || undefined
}

function nextFree(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * Valid, unique labels for a list of pins: empty or "~" names fall back to `pinN`, duplicates and
 * labels that would shadow another pin's `pinN` get a numeric suffix.
 */
export function uniquePinLabels(inputs: readonly PinLabelInput[]): { pins: PinLabel[]; renamed: number } {
  const reserved = new Set(inputs.map((pin) => `pin${pin.num}`))
  const used = new Set<string>()
  let renamed = 0
  const pins = inputs.map(({ num, raw }) => {
    const clean = sanitizePinLabel(raw)
    const own = `pin${num}`
    const base = clean ?? own
    const shadowsOther = base !== own && reserved.has(base)
    const label = nextFree(shadowsOther ? `${base}_2` : base, used)
    used.add(label)
    const given = raw?.trim()
    if (given && label !== given) renamed += 1
    return { num, label }
  })
  return { pins, renamed }
}
