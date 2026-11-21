import { getAttr, getStringAttr, insertIntoBoard, jsxStringValue, parseJsxElements, roundMm, type PatchResult } from "./tsx-ast"
import type { ProjectFiles } from "./types"

/**
 * Routing-rule and copper helpers (`<net>`, `<copperpour>`, `<differentialpair>`, `<bus>`),
 * kept apart from the core parser in tsx-ast.ts.
 */

const NET_PREFIX = "net."

/**
 * tscircuit resolves `connectsTo` with `selectOne`, so a bare "GND" matches nothing.
 * Bare names become `net.GND`; anything that already looks like a selector is kept.
 */
export function toNetSelector(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith(NET_PREFIX) || /[.>\s]/.test(trimmed)) return trimmed
  return `${NET_PREFIX}${trimmed}`
}

/** Display form of a net selector: `net.GND` → `GND`. */
export function netSelectorLabel(selector: string): string {
  return selector.startsWith(NET_PREFIX) ? selector.slice(NET_PREFIX.length) : selector
}

export interface CopperPourEntry {
  path: string
  start: number
  end: number
  net: string
  layer: string
  useThermalReliefs: boolean
}

/** Lists all `<copperpour />` elements across project TSX files. */
export function listCopperPours(files: ProjectFiles): CopperPourEntry[] {
  const pours: CopperPourEntry[] = []
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue
    for (const el of parseJsxElements(source)) {
      if (el.tagName !== "copperpour") continue
      const thermalAttr = getAttr(el, "useThermalReliefs")
      pours.push({
        path,
        start: el.start,
        end: el.end,
        net: netSelectorLabel(getStringAttr(el, "connectsTo") ?? "?"),
        layer: getStringAttr(el, "layer") ?? "bottom",
        useThermalReliefs: thermalAttr?.parsed.kind === "boolean" ? thermalAttr.parsed.value : true,
      })
    }
  }
  return pours
}

/** Inserts a `<copperpour />` plane into `<board>`. A bare net name is written as `net.<name>`. */
export function addCopperPour(
  files: ProjectFiles,
  entrypoint: string,
  options: { net: string; layer: string; useThermalReliefs?: boolean; clearance?: string },
): PatchResult {
  const attrs = [`connectsTo=${jsxStringValue(toNetSelector(options.net))}`, `layer=${jsxStringValue(options.layer)}`]
  if (options.useThermalReliefs !== false) attrs.push("useThermalReliefs")
  if (options.clearance?.trim()) attrs.push(`clearance=${jsxStringValue(options.clearance.trim())}`)
  return insertIntoBoard(files, entrypoint, `<copperpour ${attrs.join(" ")} />`)
}

/**
 * Inserts a `<differentialpair />` skew constraint into `<board>`. Connections are kept as given:
 * @tscircuit/core matches them against trace names first, then as port selectors, so a bare
 * name refers to a named `<trace>` and must not be rewritten to a net selector.
 */
export function addDifferentialPair(
  files: ProjectFiles,
  entrypoint: string,
  options: { name: string; positiveConnection: string; negativeConnection: string; maxLengthSkew?: number },
): PatchResult {
  const attrs = [
    `name=${jsxStringValue(options.name)}`,
    `positiveConnection=${jsxStringValue(options.positiveConnection.trim())}`,
    `negativeConnection=${jsxStringValue(options.negativeConnection.trim())}`,
  ]
  if (options.maxLengthSkew !== undefined) attrs.push(`maxLengthSkew={${roundMm(options.maxLengthSkew)}}`)
  return insertIntoBoard(files, entrypoint, `<differentialpair ${attrs.join(" ")} />`)
}

/** Inserts a `<net />` declaration with a nominal trace width (NetProps has no clearance field). */
export function addNetRule(files: ProjectFiles, entrypoint: string, options: { name: string; nominalTraceWidth?: string }): PatchResult {
  const attrs = [`name=${jsxStringValue(options.name)}`]
  const width = options.nominalTraceWidth?.trim()
  if (width) attrs.push(`nominalTraceWidth=${jsxStringValue(width)}`)
  return insertIntoBoard(files, entrypoint, `<net ${attrs.join(" ")} />`)
}

/** Inserts a `<bus />` routing group. `connections` are trace names or port selectors (at least one). */
export function addBus(files: ProjectFiles, entrypoint: string, options: { name: string; connections: readonly string[] }): PatchResult {
  const connections = options.connections.map((c) => c.trim()).filter(Boolean)
  if (connections.length === 0) return { status: "not-found" }
  const list = connections.map((c) => JSON.stringify(c)).join(", ")
  return insertIntoBoard(files, entrypoint, `<bus name=${jsxStringValue(options.name)} connections={[${list}]} />`)
}
