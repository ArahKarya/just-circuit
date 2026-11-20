import { KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
import { extractPcbScene, extractSchematicScene, nextDesignator, type PcbCompView, type SchematicCompView } from "./circuit-extract"
import { jsxStringValue, roundMm } from "./tsx-ast"

/** Largest KiCad file accepted; parsing runs in the browser's main thread. */
export const MAX_KICAD_FILE_BYTES = 20 * 1024 * 1024

/** What the importer changed or left out, shown to the user after an import. */
export interface KicadImportNotes {
  /** KiCad power and flag symbols (#PWR, #FLG), which are not real parts. */
  skippedSymbols: number
  /** Parts given a new designator because theirs was missing, duplicated or invalid. */
  renamed: { from: string; to: string }[]
}

export interface ImportedKicadProject {
  name: string
  entrypoint: string
  files: Record<string, string>
  stats: {
    components: number
    traces: number
    vias: number
  }
  notes: KicadImportNotes
}

function sanitizeName(filename: string): string {
  return (
    filename
      .replace(/\.(kicad_pcb|kicad_sch)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Proyek KiCad"
  )
}

function componentJsx(
  name: string,
  opts: {
    ftype?: string
    value?: string
    pcbX?: number
    pcbY?: number
    pcbRotation?: number
    layer?: string
    schX?: number
    schY?: number
    schRotation?: number
  },
): string {
  const attrs: string[] = [`name=${jsxStringValue(name)}`]
  let tag = "chip"

  if (opts.ftype === "simple_resistor" || /^R\d+/i.test(name)) {
    tag = "resistor"
    attrs.push(`resistance=${jsxStringValue(opts.value || "10k")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_capacitor" || /^C\d+/i.test(name)) {
    tag = "capacitor"
    attrs.push(`capacitance=${jsxStringValue(opts.value || "100nF")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_inductor" || /^L\d+/i.test(name)) {
    tag = "inductor"
    attrs.push(`inductance=${jsxStringValue(opts.value || "10uH")}`)
    attrs.push(`footprint="0805"`)
  } else if (opts.ftype === "simple_led" || /^LED\d+/i.test(name)) {
    tag = "led"
    attrs.push(`color=${jsxStringValue(opts.value || "red")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_diode" || /^D\d+/i.test(name)) {
    tag = "diode"
    attrs.push(`footprint="sod123"`)
  } else {
    attrs.push(`footprint="soic8"`)
    if (opts.value) attrs.push(`manufacturerPartNumber=${jsxStringValue(opts.value)}`)
  }

  if (opts.pcbX !== undefined) attrs.push(`pcbX={${roundMm(opts.pcbX)}}`)
  if (opts.pcbY !== undefined) attrs.push(`pcbY={${roundMm(opts.pcbY)}}`)
  if (opts.pcbRotation) attrs.push(`pcbRotation={${roundMm(opts.pcbRotation)}}`)
  if (opts.layer === "bottom") attrs.push(`layer="bottom"`)
  if (opts.schX !== undefined) attrs.push(`schX={${roundMm(opts.schX)}}`)
  if (opts.schY !== undefined) attrs.push(`schY={${roundMm(opts.schY)}}`)
  if (opts.schRotation) attrs.push(`schRotation={${roundMm(opts.schRotation)}}`)

  return `    <${tag} ${attrs.join(" ")} />`
}

const DESIGNATOR = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ImportedPart {
  name: string
  pcb?: PcbCompView
  sch?: SchematicCompView
}

/** Pairs PCB and schematic views of the same source part; parts with no source stay separate. */
function pairParts(pcbParts: readonly PcbCompView[], schParts: readonly SchematicCompView[]): ImportedPart[] {
  const parts = new Map<string, ImportedPart>()
  const keyOf = (sourceId: string, id: string) => (sourceId ? `src:${sourceId}` : `id:${id}`)
  for (const pcb of pcbParts) parts.set(keyOf(pcb.sourceId, pcb.id), { name: pcb.name, pcb })
  for (const sch of schParts) {
    const key = keyOf(sch.sourceId, sch.id)
    const existing = parts.get(key)
    parts.set(key, existing ? { ...existing, sch } : { name: sch.name, sch })
  }
  return [...parts.values()]
}

/** Gives every part a unique, valid designator, keeping the original whenever possible. */
function assignNames(parts: readonly ImportedPart[]): { parts: ImportedPart[]; renamed: KicadImportNotes["renamed"] } {
  // First pass: keep every valid designator the first time it appears, so `R1` is never
  // renamed just because an unannotated `R?` came before it.
  const kept = new Set<number>()
  const used: string[] = []
  parts.forEach((part, index) => {
    if (DESIGNATOR.test(part.name) && !used.includes(part.name)) {
      kept.add(index)
      used.push(part.name)
    }
  })
  const renamed: KicadImportNotes["renamed"] = []
  const named = parts.map((part, index) => {
    if (kept.has(index)) return part
    const prefix = part.name.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "U"
    const name = nextDesignator(prefix, used)
    used.push(name)
    renamed.push({ from: part.name, to: name })
    return { ...part, name }
  })
  return { parts: named, renamed }
}

/** Converts a circuitJson array (e.g. from KiCad) into a clean, editable tscircuit TSX file. */
export function circuitJsonToTsx(circuitJson: readonly unknown[]): {
  tsx: string
  stats: { components: number; traces: number; vias: number }
  notes: KicadImportNotes
} {
  const pcb = extractPcbScene(circuitJson)
  const sch = extractSchematicScene(circuitJson)
  const paired = pairParts(pcb.components, sch.components)
  const realParts = paired.filter((part) => !part.name.startsWith("#"))
  const { parts, renamed } = assignNames(realParts)

  const lines: string[] = parts.map(({ name, pcb: p, sch: s }) =>
    componentJsx(name, {
      ftype: s?.ftype,
      value: s?.value,
      pcbX: p?.x,
      pcbY: p?.y,
      pcbRotation: p?.rotation,
      layer: p?.layer,
      schX: s?.x,
      schY: s?.y,
      schRotation: s?.rotation,
    }),
  )

  for (const trace of pcb.traces) {
    if (trace.points.length < 2) continue
    const pts = trace.points
      .map((pt) => `{ route_type: "wire", x: ${roundMm(pt.x)}, y: ${roundMm(pt.y)}, width: ${roundMm(trace.width)}, layer: ${JSON.stringify(trace.layer)} }`)
      .join(", ")
    lines.push(`    <pcbtrace route={[${pts}]} />`)
  }

  for (const via of pcb.vias) {
    const fromLayer = via.layers[0] ?? "top"
    const toLayer = via.layers[1] ?? "bottom"
    lines.push(`    <via pcbX={${roundMm(via.x)}} pcbY={${roundMm(via.y)}} fromLayer=${jsxStringValue(fromLayer)} toLayer=${jsxStringValue(toLayer)} />`)
  }

  const width = `${roundMm(Math.max(10, pcb.board.width))}mm`
  const height = `${roundMm(Math.max(10, pcb.board.height))}mm`
  const tsx = `export default () => (\n  <board width="${width}" height="${height}">\n${lines.join("\n")}\n  </board>\n)\n`
  return {
    tsx,
    stats: {
      components: parts.length,
      traces: pcb.traces.length,
      vias: pcb.vias.length,
    },
    notes: { skippedSymbols: paired.length - realParts.length, renamed },
  }
}

/** Imports one or more KiCad files (.kicad_pcb / .kicad_sch) into a Just Circuit TSX project. */
export function importKicadFiles(files: { name: string; content: string }[]): ImportedKicadProject {
  if (files.length === 0) throw new Error("Pilih minimal satu file .kicad_pcb atau .kicad_sch")
  const tooBig = files.find((file) => file.content.length > MAX_KICAD_FILE_BYTES)
  if (tooBig) throw new Error(`${tooBig.name} terlalu besar untuk diimpor (maks ${MAX_KICAD_FILE_BYTES / 1024 / 1024} MB)`)
  const converter = new KicadToCircuitJsonConverter()
  for (const file of files) {
    converter.addFile(file.name, file.content)
  }
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const { tsx, stats, notes } = circuitJsonToTsx(circuitJson)
  return {
    name: sanitizeName(files[0].name),
    entrypoint: "index.circuit.tsx",
    files: { "index.circuit.tsx": tsx },
    stats,
    notes,
  }
}

/** Short Indonesian note for the import toast: what was renamed, skipped and not imported. */
export function kicadImportNote(notes: KicadImportNotes): string {
  const parts: string[] = []
  if (notes.renamed.length > 0) {
    const sample = notes.renamed.slice(0, 3).map((r) => `${r.from}→${r.to}`).join(", ")
    parts.push(`${notes.renamed.length} part diberi nama baru (${sample}${notes.renamed.length > 3 ? ", …" : ""})`)
  }
  if (notes.skippedSymbols > 0) parts.push(`${notes.skippedSymbols} simbol power/flag dilewati`)
  parts.push("koneksi net dan footprint asli belum ikut diimpor, periksa ulang sebelum dipakai")
  return `. ${parts.join("; ")}.`
}
