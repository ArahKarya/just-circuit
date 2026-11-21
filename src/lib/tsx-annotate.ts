import { MANUAL_EDITS_FILE, parseManualEdits } from "./manual-edits"
import { getAttr, getStringAttr, listComponents, parseJsxElements, type ComponentSummary, type JsxAttrNode, type JsxElementNode } from "./tsx-ast"
import type { ProjectFiles } from "./types"

/**
 * Auto-annotation: renumbers designators (R1..Rn, C1..Cn, …) by position and rewrites every
 * string selector that points at a renamed component.
 */

/** Named elements that are not components, so their `name` is never a designator. */
const NON_COMPONENT_TAGS: ReadonlySet<string> = new Set([
  "board",
  "group",
  "subcircuit",
  "panel",
  "net",
  "trace",
  "pcbtrace",
  "tracehint",
  "copperpour",
  "differentialpair",
  "bus",
  "drccheck",
  "netlabel",
  "netalias",
  "via",
  "hole",
  "platedhole",
  "smtpad",
  "port",
  "footprint",
  "cutout",
  "breakout",
  "breakoutpoint",
  "autoroutingphase",
  "schematictext",
  "schematicbox",
  "schematictable",
  "silkscreentext",
])

/** Props that hold port/trace selectors (from TraceProps, NetProps, NetLabelProps, CopperPourProps, DifferentialPairProps, BusProps, …). */
const SELECTOR_ATTRS: ReadonlySet<string> = new Set([
  "from",
  "to",
  "path",
  "connections",
  "connectsTo",
  "connection",
  "positiveConnection",
  "negativeConnection",
  "lengthMatchTo",
])

/** `.R1 > .pin1`, `.R1`, `R1.pin1` — never a bare word like "R1" or "R1, 1%". */
const SELECTOR_LIKE = /^\s*(?:\.|[A-Za-z_$][\w$-]*\.[\w$-]+\s*$)|>/

const DESIGNATOR = /^([A-Za-z]+)(\d+)$/
const ROW_TOLERANCE = 0.5

export interface AutoAnnotateResult {
  files: ProjectFiles
  renamed: { from: string; to: string }[]
  /** Old designator → new designator, for remapping locks/selection held outside the code. */
  renames: Record<string, string>
  /** Designators left alone (duplicates) or references that could not be rewritten (template literals). */
  skipped: AnnotateSkip[]
}

export type AnnotateSkip = { name: string; reason: "duplicate" } | { name: string; reason: "template"; path: string }

interface TextEdit {
  start: number
  end: number
  text: string
}

/**
 * Renames the component segment of a selector (`.R9 > .pin1`, `R9.pin1`, `R9`), including each
 * part of a comma list. Port names (`.U1 > .D1`) and nets (`net.R9`) are never touched.
 */
export function renameSelector(selector: string, renames: ReadonlyMap<string, string>): string {
  return selector
    .split(",")
    .map((part) => {
      const match = part.match(/^(\s*\.?)([A-Za-z_$][\w$-]*)(?=$|[\s>.])/)
      if (!match || match[2] === "net") return part
      const next = renames.get(match[2])
      return next === undefined ? part : `${match[1]}${next}${part.slice(match[0].length)}`
    })
    .join(",")
}

/** Renames each comma-separated part of a JSX string only when it looks like a selector. */
function renameSelectorLiteral(text: string, renames: ReadonlyMap<string, string>): string {
  return text
    .split(",")
    .map((part) => (SELECTOR_LIKE.test(part) ? renameSelector(part, renames) : part))
    .join(",")
}

/** True when the literal at `offset` is an object key (`{ "R9": ... }`), not a value. */
function isObjectKey(raw: string, offset: number, colon: string | undefined): boolean {
  if (!colon) return false
  const before = raw.slice(0, offset).trimEnd()
  return before.endsWith("{") || before.endsWith(",")
}

/** Rewrites string literals inside a `{...}` expression; object keys and escaped strings are kept. */
function renameInExpression(raw: string, renames: ReadonlyMap<string, string>): string {
  return raw.replace(
    /(["'])((?:\\.|(?!\1)[^\\\n])*)\1(\s*:)?/g,
    (whole: string, quote: string, inner: string, colon: string | undefined, offset: number) => {
      if (inner.includes("\\") || isObjectKey(raw, offset, colon)) return whole
      return `${quote}${renameSelectorLiteral(inner, renames)}${quote}${colon ?? ""}`
    },
  )
}

function renameAttrValue(attr: JsxAttrNode, renames: ReadonlyMap<string, string>): string | null {
  const raw = attr.rawValue
  if (raw === null) return null
  const quote = raw[0]
  const next =
    quote === '"' || quote === "'" ? `${quote}${renameSelectorLiteral(raw.slice(1, -1), renames)}${quote}` : renameInExpression(raw, renames)
  return next === raw ? null : next
}

function elementEdits(el: JsxElementNode, renames: ReadonlyMap<string, string>): TextEdit[] {
  const edits: TextEdit[] = []
  const name = getStringAttr(el, "name")
  const nameAttr = getAttr(el, "name")
  const target = name === undefined ? undefined : renames.get(name)
  if (nameAttr && target !== undefined && !NON_COMPONENT_TAGS.has(el.tagName) && nameAttr.valueStart !== null) {
    edits.push({ start: nameAttr.valueStart, end: nameAttr.end, text: `"${target}"` })
  }
  for (const attr of el.attributes) {
    if (!SELECTOR_ATTRS.has(attr.name) || attr.valueStart === null) continue
    const next = renameAttrValue(attr, renames)
    if (next !== null) edits.push({ start: attr.valueStart, end: attr.end, text: next })
  }
  return edits
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((text, e) => `${text.slice(0, e.start)}${e.text}${text.slice(e.end)}`, source)
}

function renameInSource(source: string, renames: ReadonlyMap<string, string>): string {
  const edits = parseJsxElements(source).flatMap((el) => elementEdits(el, renames))
  return edits.length === 0 ? source : applyEdits(source, edits)
}

function renameSelectorField(entry: unknown, key: string, renames: ReadonlyMap<string, string>): unknown {
  if (!entry || typeof entry !== "object") return entry
  const record = entry as Record<string, unknown>
  const value = record[key]
  return typeof value === "string" ? { ...record, [key]: renameSelector(value, renames) } : entry
}

const MANUAL_EDIT_SELECTORS: readonly (readonly [string, string])[] = [
  ["pcb_placements", "selector"],
  ["schematic_placements", "selector"],
  ["manual_trace_hints", "pcb_port_selector"],
]

/** Rewrites component selectors in manual-edits.json; returns null when nothing changed. */
function renameManualEdits(raw: string | undefined, renames: ReadonlyMap<string, string>): string | null {
  if (raw === undefined) return null
  const parsed = parseManualEdits(raw)
  const next = MANUAL_EDIT_SELECTORS.reduce<Record<string, unknown>>((acc, [list, key]) => {
    const entries = acc[list]
    return Array.isArray(entries) ? { ...acc, [list]: entries.map((entry) => renameSelectorField(entry, key, renames)) } : acc
  }, parsed)
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  return serialized === `${JSON.stringify(parsed, null, 2)}\n` ? null : serialized
}

type Position = { x: number; y: number }

/** Uses schematic coordinates when every part has them, else PCB ones, else source order. */
function positionsFor(list: readonly ComponentSummary[]): (Position | null)[] {
  if (list.every((c) => c.schX !== undefined && c.schY !== undefined)) return list.map((c) => ({ x: c.schX!, y: c.schY! }))
  if (list.every((c) => c.pcbX !== undefined && c.pcbY !== undefined)) return list.map((c) => ({ x: c.pcbX!, y: c.pcbY! }))
  return list.map(() => null)
}

/** Top-to-bottom rows, then left-to-right; ties keep source order. */
function orderGroup(list: readonly ComponentSummary[]): ComponentSummary[] {
  const positions = positionsFor(list)
  const indexed = list.map((comp, index) => ({ comp, index, pos: positions[index] }))
  return indexed
    .sort((a, b) => {
      if (a.pos && b.pos) {
        const rowA = Math.round(a.pos.y / ROW_TOLERANCE)
        const rowB = Math.round(b.pos.y / ROW_TOLERANCE)
        if (rowA !== rowB) return rowB - rowA
        if (a.pos.x !== b.pos.x) return a.pos.x - b.pos.x
      }
      return a.index - b.index
    })
    .map((entry) => entry.comp)
}

function groupByPrefix(comps: readonly ComponentSummary[]): Map<string, ComponentSummary[]> {
  const groups = new Map<string, ComponentSummary[]>()
  for (const comp of comps) {
    if (NON_COMPONENT_TAGS.has(comp.tagName)) continue
    const match = comp.name.match(DESIGNATOR)
    if (!match) continue
    const prefix = match[1].toUpperCase()
    groups.set(prefix, [...(groups.get(prefix) ?? []), comp])
  }
  return groups
}

function duplicateNames(list: readonly ComponentSummary[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const comp of list) {
    if (seen.has(comp.name)) dupes.add(comp.name)
    seen.add(comp.name)
  }
  return [...dupes]
}

/**
 * A name-keyed rename map cannot tell two parts called R1 apart, so a prefix group with any
 * duplicate designator is left untouched and reported instead.
 */
function planRenames(files: ProjectFiles): { renamed: { from: string; to: string }[]; skipped: AnnotateSkip[] } {
  const renamed: { from: string; to: string }[] = []
  const skipped: AnnotateSkip[] = []
  for (const [prefix, list] of groupByPrefix(listComponents(files))) {
    const dupes = duplicateNames(list)
    if (dupes.length > 0) {
      skipped.push(...dupes.map((name) => ({ name, reason: "duplicate" as const })))
      continue
    }
    orderGroup(list).forEach((comp, idx) => {
      const target = `${prefix}${idx + 1}`
      if (comp.name !== target) renamed.push({ from: comp.name, to: target })
    })
  }
  return { renamed, skipped }
}

/** Template literals (`.R9 > .pin${n}`) are not rewritten; report the ones that mention a renamed part. */
function templateMentions(files: ProjectFiles, renames: ReadonlyMap<string, string>): AnnotateSkip[] {
  const found: AnnotateSkip[] = []
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue
    const templates = source.match(/`[^`]*`/g) ?? []
    for (const name of renames.keys()) {
      const token = new RegExp(`(^|[^\\w$-])${name}(?![\\w$-])`)
      if (templates.some((t) => token.test(t))) found.push({ name, reason: "template", path })
    }
  }
  return found
}

/**
 * Renumbers designators by position. All names are substituted in one pass over the original
 * text, so permutations such as R9→R1 with R1→R9 cannot collide.
 */
export function autoAnnotateProject(files: ProjectFiles): AutoAnnotateResult {
  const { renamed, skipped } = planRenames(files)
  if (renamed.length === 0) return { files, renamed: [], renames: {}, skipped }
  const renames = new Map(renamed.map((r) => [r.from, r.to]))

  const nextFiles: Record<string, string> = { ...files }
  for (const [path, source] of Object.entries(files)) {
    if (/\.(tsx|jsx)$/.test(path)) nextFiles[path] = renameInSource(source, renames)
  }
  const manual = renameManualEdits(files[MANUAL_EDITS_FILE], renames)
  if (manual !== null) nextFiles[MANUAL_EDITS_FILE] = manual

  return { files: nextFiles, renamed, renames: Object.fromEntries(renames), skipped: [...skipped, ...templateMentions(files, renames)] }
}

/** Toast text for designators Auto-Annotate left alone or could not fully rewrite. */
export function describeAnnotateSkips(skipped: readonly AnnotateSkip[]): string | null {
  const dupes = [...new Set(skipped.filter((s) => s.reason === "duplicate").map((s) => s.name))]
  const templates = [...new Set(skipped.filter((s) => s.reason === "template").map((s) => s.name))]
  const parts = [
    dupes.length > 0 ? `Designator ganda dilewati (grupnya tidak diubah): ${dupes.join(", ")}` : null,
    templates.length > 0 ? `Cek manual template string yang menyebut: ${templates.join(", ")}` : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(". ") : null
}
