import { KicadSymbolToCircuitJsonConverter, KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
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
  /** Number of netlist <trace> connections preserved from the KiCad file. */
  importedNetTraces?: number
  /** Number of copper pour zones preserved. */
  importedZones?: number
}

export interface ImportedKicadProject {
  name: string
  entrypoint: string
  files: Record<string, string>
  stats: {
    components: number
    traces: number
    vias: number
    netTraces?: number
    zones?: number
  }
  notes: KicadImportNotes
}

export interface ImportedKicadSymbol {
  componentName: string
  filePath: string
  tsx: string
  pinCount: number
}

function sanitizeName(filename: string): string {
  return (
    filename
      .replace(/\.(kicad_pcb|kicad_sch|kicad_sym)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Proyek KiCad"
  )
}

function toPascalIdent(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join("")
  if (!cleaned) return "KicadPart"
  return /^[0-9]/.test(cleaned) ? `Part${cleaned}` : cleaned
}

function componentJsx(
  name: string,
  opts: {
    ftype?: string
    value?: string
    footprint?: string
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
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "0603")}`)
  } else if (opts.ftype === "simple_capacitor" || /^C\d+/i.test(name)) {
    tag = "capacitor"
    attrs.push(`capacitance=${jsxStringValue(opts.value || "100nF")}`)
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "0603")}`)
  } else if (opts.ftype === "simple_inductor" || /^L\d+/i.test(name)) {
    tag = "inductor"
    attrs.push(`inductance=${jsxStringValue(opts.value || "10uH")}`)
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "0805")}`)
  } else if (opts.ftype === "simple_led" || /^LED\d+/i.test(name)) {
    tag = "led"
    attrs.push(`color=${jsxStringValue(opts.value || "red")}`)
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "0603")}`)
  } else if (opts.ftype === "simple_diode" || /^D\d+/i.test(name)) {
    tag = "diode"
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "sod123")}`)
  } else {
    attrs.push(`footprint=${jsxStringValue(opts.footprint || "soic8")}`)
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
  sourceId: string
  pcb?: PcbCompView
  sch?: SchematicCompView
}

/** Pairs PCB and schematic views of the same source part; parts with no source stay separate. */
function pairParts(pcbParts: readonly PcbCompView[], schParts: readonly SchematicCompView[]): ImportedPart[] {
  const parts = new Map<string, ImportedPart>()
  const keyOf = (sourceId: string, id: string) => (sourceId ? `src:${sourceId}` : `id:${id}`)
  for (const pcb of pcbParts) parts.set(keyOf(pcb.sourceId, pcb.id), { name: pcb.name, sourceId: pcb.sourceId, pcb })
  for (const sch of schParts) {
    const key = keyOf(sch.sourceId, sch.id)
    const existing = parts.get(key)
    parts.set(key, existing ? { ...existing, sch } : { name: sch.name, sourceId: sch.sourceId, sch })
  }
  return [...parts.values()]
}

/** Gives every part a unique, valid designator, keeping the original whenever possible. */
function assignNames(parts: readonly ImportedPart[]): { parts: ImportedPart[]; renamed: KicadImportNotes["renamed"] } {
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

type RawEl = Record<string, unknown> & { type?: string }
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

/** Extracts `<trace>` statements from `source_trace` elements using the final assigned component names. */
function extractNetTraces(circuitJson: readonly unknown[], finalNameBySourceId: Map<string, string>): string[] {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const portSelector = new Map<string, string>()
  const netById = new Map<string, string>()

  for (const el of elements) {
    if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      netById.set(str(el.source_net_id)!, str(el.name)!)
    } else if (el.type === "source_port" && str(el.source_port_id) && str(el.source_component_id)) {
      const compName = finalNameBySourceId.get(str(el.source_component_id)!)
      const portName = str(el.name) ?? (typeof el.pin_number === "number" ? `pin${el.pin_number}` : undefined)
      if (compName && portName) {
        portSelector.set(str(el.source_port_id)!, `.${compName} > .${portName}`)
      }
    }
  }

  const seen = new Set<string>()
  const lines: string[] = []
  for (const el of elements) {
    if (el.type !== "source_trace") continue
    const ports = Array.isArray(el.connected_source_port_ids)
      ? el.connected_source_port_ids.map((id) => (typeof id === "string" ? portSelector.get(id) : undefined)).filter((s): s is string => Boolean(s))
      : []
    const nets = Array.isArray(el.connected_source_net_ids)
      ? el.connected_source_net_ids
          .map((id) => (typeof id === "string" ? netById.get(id) : undefined))
          .filter((n): n is string => Boolean(n && DESIGNATOR.test(n)))
      : []
    if (nets.length > 0) {
      const netSel = `net.${nets[0]}`
      for (const p of ports) {
        const key = `${p}->${netSel}`
        if (!seen.has(key)) {
          seen.add(key)
          lines.push(`    <trace from=${jsxStringValue(p)} to=${jsxStringValue(netSel)} />`)
        }
      }
    } else if (ports.length >= 2) {
      for (let i = 1; i < ports.length; i += 1) {
        const key = `${ports[0]}->${ports[i]}`
        if (!seen.has(key)) {
          seen.add(key)
          lines.push(`    <trace from=${jsxStringValue(ports[0])} to=${jsxStringValue(ports[i])} />`)
        }
      }
    }
  }
  return lines
}

/** Extracts `<copperpour>` statements from `pcb_copper_pour` elements if present. */
function extractCopperPourLines(circuitJson: readonly unknown[]): string[] {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const netById = new Map<string, string>()
  for (const el of elements) {
    if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      netById.set(str(el.source_net_id)!, str(el.name)!)
    }
  }
  const lines: string[] = []
  for (const el of elements) {
    if (el.type !== "pcb_copper_pour") continue
    const net = (str(el.source_net_id) ? netById.get(str(el.source_net_id)!) : undefined) ?? "GND"
    const layer = str(el.layer) ?? "bottom"
    lines.push(`    <copperpour connectsTo=${jsxStringValue(net)} layer=${jsxStringValue(layer)} useThermalReliefs />`)
  }
  return lines
}

/** Converts a circuitJson array (e.g. from KiCad) into a clean, editable tscircuit TSX file. */
export function circuitJsonToTsx(circuitJson: readonly unknown[]): {
  tsx: string
  stats: { components: number; traces: number; vias: number; netTraces?: number; zones?: number }
  notes: KicadImportNotes
} {
  const pcb = extractPcbScene(circuitJson)
  const sch = extractSchematicScene(circuitJson)
  const paired = pairParts(pcb.components, sch.components)
  const realParts = paired.filter((part) => !part.name.startsWith("#"))
  const { parts, renamed } = assignNames(realParts)

  const finalNameBySourceId = new Map<string, string>()
  for (const p of parts) {
    if (p.sourceId) finalNameBySourceId.set(p.sourceId, p.name)
  }

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

  const netTraceLines = extractNetTraces(circuitJson, finalNameBySourceId)
  lines.push(...netTraceLines)

  const pourLines = extractCopperPourLines(circuitJson)
  lines.push(...pourLines)

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
      ...(netTraceLines.length > 0 ? { netTraces: netTraceLines.length } : {}),
      ...(pourLines.length > 0 ? { zones: pourLines.length } : {}),
    },
    notes: {
      skippedSymbols: paired.length - realParts.length,
      renamed,
      importedNetTraces: netTraceLines.length,
      importedZones: pourLines.length,
    },
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

/** Converts a KiCad symbol library (.kicad_sym) into a reusable tscircuit component TSX file. */
export function importKicadSymbol(filename: string, content: string, customName?: string): ImportedKicadSymbol {
  if (content.length > MAX_KICAD_FILE_BYTES) throw new Error(`${filename} terlalu besar`)
  const converter = new KicadSymbolToCircuitJsonConverter()
  converter.addFile(filename, content)
  converter.runUntilFinished()
  const output = converter.getOutput() as RawEl[]

  const compName = toPascalIdent(customName?.trim() || sanitizeName(filename))
  const pins: { num: number; label: string }[] = []
  let idx = 1
  for (const el of output) {
    if (el.type === "source_port" || el.type === "schematic_port") {
      const n = typeof el.pin_number === "number" ? el.pin_number : idx
      const lbl = str(el.display_pin_label) ?? str(el.name) ?? `P${n}`
      if (!pins.some((p) => p.num === n)) {
        pins.push({ num: n, label: lbl })
        idx += 1
      }
    }
  }
  pins.sort((a, b) => a.num - b.num)
  const effectivePins = pins.length > 0 ? pins : [{ num: 1, label: "P1" }, { num: 2, label: "P2" }]
  const pinMapEntries = effectivePins.map((p) => `  pin${p.num}: ${JSON.stringify(p.label)},`).join("\n")
  const fp = effectivePins.length <= 8 ? "soic8" : effectivePins.length <= 16 ? "soic16" : `qfp${Math.max(32, effectivePins.length)}`

  const tsx = `import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
${pinMapEntries}
} as const

export const ${compName} = (props: ChipProps<typeof pinLabels>) => (
  <chip
    footprint=${jsxStringValue(fp)}
    manufacturerPartNumber=${jsxStringValue(compName)}
    pinLabels={pinLabels}
    {...props}
  />
)
`
  return {
    componentName: compName,
    filePath: `lib/parts/${compName}.tsx`,
    tsx,
    pinCount: effectivePins.length,
  }
}

/** Short Indonesian note for the import toast: what was renamed, skipped and imported. */
export function kicadImportNote(notes: KicadImportNotes): string {
  const parts: string[] = []
  if (notes.importedNetTraces) parts.push(`${notes.importedNetTraces} koneksi net diimpor`)
  if (notes.importedZones) parts.push(`${notes.importedZones} copper zone diimpor`)
  if (notes.renamed.length > 0) {
    const sample = notes.renamed.slice(0, 3).map((r) => `${r.from}→${r.to}`).join(", ")
    parts.push(`${notes.renamed.length} part diberi nama baru (${sample}${notes.renamed.length > 3 ? ", …" : ""})`)
  }
  if (notes.skippedSymbols > 0) parts.push(`${notes.skippedSymbols} simbol power/flag dilewati`)
  if (!notes.importedNetTraces) parts.push("koneksi net & footprint khusus perlu dicek ulang")
  return `. ${parts.join("; ")}.`
}
