import { KicadSymbolToCircuitJsonConverter, KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
import { extractPcbScene, extractSchematicScene, nextDesignator, type PcbCompView, type SchematicCompView } from "./circuit-extract"
import { buildNetNameMap } from "./net-names"
import { uniquePinLabels } from "./pin-labels"
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
  /** Nets whose KiCad name (+3V3, /SDA, Net-(R1-Pad1)) was rewritten into a valid tscircuit name. */
  renamedNets?: number
  /** Ports left out of `<trace>`s because they have no pin number to select them by. */
  skippedPorts?: number
  /** Copper pours left out because they had no net or repeated another pour on the same net and layer. */
  skippedZones?: number
  /** Chips given a stand-in footprint because the importer cannot carry the KiCad one over. */
  placeholderFootprints?: number
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
  /** Pin labels that had to be renamed ("~", duplicates, invalid characters). */
  renamedPins: number
}

export interface KicadSymbolOptions {
  customName?: string
  /** tscircuit footprint string (e.g. "soic8", "qfn32"); empty leaves the chip without one. */
  footprint?: string
}

/** Accepted symbol library extension. */
export const KICAD_SYMBOL_EXTENSION = ".kicad_sym"

/** Rough shape of a footprinter string such as soic8, qfn32_p0.5, pinrow4_p2.54. */
const FOOTPRINT_STRING = /^[A-Za-z][A-Za-z0-9_.]*$/

/** The stand-in footprint chips get when the KiCad one cannot be carried over. */
export const PLACEHOLDER_CHIP_FOOTPRINT = "soic8"

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
    attrs.push(`footprint=${jsxStringValue(PLACEHOLDER_CHIP_FOOTPRINT)}`)
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

function objectsOf(circuitJson: readonly unknown[]): RawEl[] {
  return circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
}

/** source_net_id -> valid, unique tscircuit net name, plus how many KiCad names were rewritten. */
function resolveNetNames(elements: readonly RawEl[]): { byId: Map<string, string>; renamed: number } {
  const nets = elements.flatMap((el) => {
    const id = str(el.source_net_id)
    const name = str(el.name)
    return el.type === "source_net" && id && name ? [{ id, name }] : []
  })
  const { names, renamed } = buildNetNameMap(nets.map((net) => net.name))
  const byId = new Map(nets.map((net) => [net.id, names.get(net.name) ?? net.name] as const))
  return { byId, renamed }
}

/** `pinN` selector for a source port; tscircuit parts generated here only expose pinN ports. */
function portSelectorName(port: RawEl): string | undefined {
  if (typeof port.pin_number === "number" && Number.isInteger(port.pin_number) && port.pin_number > 0) return `pin${port.pin_number}`
  const name = str(port.name)
  if (name && /^pin\d+$/.test(name)) return name
  if (name && /^\d+$/.test(name)) return `pin${Number(name)}`
  const hint = Array.isArray(port.port_hints) ? port.port_hints.find((h): h is string => typeof h === "string" && /^\d+$/.test(h)) : undefined
  return hint ? `pin${Number(hint)}` : undefined
}

/** source_port_id -> `.Part > .pinN`, counting ports of kept parts that cannot be selected. */
function resolvePortSelectors(elements: readonly RawEl[], finalNameBySourceId: ReadonlyMap<string, string>): { byId: Map<string, string>; skipped: Set<string> } {
  const byId = new Map<string, string>()
  const skipped = new Set<string>()
  for (const el of elements) {
    const portId = str(el.source_port_id)
    const compId = str(el.source_component_id)
    if (el.type !== "source_port" || !portId || !compId) continue
    const compName = finalNameBySourceId.get(compId)
    if (!compName) continue
    const pin = portSelectorName(el)
    if (pin) byId.set(portId, `.${compName} > .${pin}`)
    else skipped.add(portId)
  }
  return { byId, skipped }
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

function traceLine(from: string, to: string): string {
  return `    <trace from=${jsxStringValue(from)} to=${jsxStringValue(to)} />`
}

/** Pairs for one source_trace: every port to its net, or a chain between ports when there is no net. */
function tracePairs(el: RawEl, ports: ReadonlyMap<string, string>, nets: ReadonlyMap<string, string>): [string, string][] {
  const selectors = idsOf(el.connected_source_port_ids).flatMap((id) => ports.get(id) ?? [])
  const net = idsOf(el.connected_source_net_ids).flatMap((id) => nets.get(id) ?? [])[0]
  if (net) return selectors.map((p) => [p, `net.${net}`])
  return selectors.slice(1).map((p) => [selectors[0], p])
}

interface NetTraceResult {
  lines: string[]
  renamedNets: number
  skippedPorts: number
}

/** Extracts `<trace>` statements from `source_trace` elements using the final assigned component names. */
function extractNetTraces(circuitJson: readonly unknown[], finalNameBySourceId: ReadonlyMap<string, string>): NetTraceResult {
  const elements = objectsOf(circuitJson)
  const nets = resolveNetNames(elements)
  const ports = resolvePortSelectors(elements, finalNameBySourceId)
  const traces = elements.filter((el) => el.type === "source_trace")
  const pairs = traces.flatMap((el) => tracePairs(el, ports.byId, nets.byId))
  const unique = [...new Map(pairs.map(([from, to]) => [`${from}->${to}`, traceLine(from, to)] as const)).values()]
  const usedSkipped = new Set(traces.flatMap((el) => idsOf(el.connected_source_port_ids)).filter((id) => ports.skipped.has(id)))
  return { lines: unique, renamedNets: nets.renamed, skippedPorts: usedSkipped.size }
}

/** Extracts `<copperpour>` statements: pours without a net are skipped, one pour per net and layer. */
function extractCopperPourLines(circuitJson: readonly unknown[]): { lines: string[]; skipped: number } {
  const elements = objectsOf(circuitJson)
  const nets = resolveNetNames(elements).byId
  const pours = elements.filter((el) => el.type === "pcb_copper_pour")
  const keyed = pours.flatMap((el) => {
    const netId = str(el.source_net_id)
    const net = netId ? nets.get(netId) : undefined
    return net ? [{ net, layer: str(el.layer) ?? "bottom" }] : []
  })
  const unique = [...new Map(keyed.map((pour) => [`${pour.net}|${pour.layer}`, pour] as const)).values()]
  const lines = unique.map(
    (pour) => `    <copperpour connectsTo=${jsxStringValue(`net.${pour.net}`)} layer=${jsxStringValue(pour.layer)} useThermalReliefs />`,
  )
  return { lines, skipped: pours.length - unique.length }
}

type PcbScene = ReturnType<typeof extractPcbScene>

function pcbTraceLines(pcb: PcbScene): string[] {
  return pcb.traces
    .filter((trace) => trace.points.length >= 2)
    .map((trace) => {
      const pts = trace.points
        .map((pt) => `{ route_type: "wire", x: ${roundMm(pt.x)}, y: ${roundMm(pt.y)}, width: ${roundMm(trace.width)}, layer: ${JSON.stringify(trace.layer)} }`)
        .join(", ")
      return `    <pcbtrace route={[${pts}]} />`
    })
}

function viaLines(pcb: PcbScene): string[] {
  return pcb.vias.map((via) => {
    const fromLayer = via.layers[0] ?? "top"
    const toLayer = via.layers[1] ?? "bottom"
    return `    <via pcbX={${roundMm(via.x)}} pcbY={${roundMm(via.y)}} fromLayer=${jsxStringValue(fromLayer)} toLayer=${jsxStringValue(toLayer)} />`
  })
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
  const finalNameBySourceId = new Map(parts.filter((p) => p.sourceId).map((p) => [p.sourceId, p.name] as const))

  const componentLines = parts.map(({ name, pcb: p, sch: s }) =>
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
  const netTraces = extractNetTraces(circuitJson, finalNameBySourceId)
  const pours = extractCopperPourLines(circuitJson)
  const lines = [...componentLines, ...netTraces.lines, ...pours.lines, ...pcbTraceLines(pcb), ...viaLines(pcb)]

  const width = `${roundMm(Math.max(10, pcb.board.width))}mm`
  const height = `${roundMm(Math.max(10, pcb.board.height))}mm`
  const tsx = `export default () => (\n  <board width="${width}" height="${height}">\n${lines.join("\n")}\n  </board>\n)\n`
  return {
    tsx,
    stats: {
      components: parts.length,
      traces: pcb.traces.length,
      vias: pcb.vias.length,
      ...(netTraces.lines.length > 0 ? { netTraces: netTraces.lines.length } : {}),
      ...(pours.lines.length > 0 ? { zones: pours.lines.length } : {}),
    },
    notes: {
      skippedSymbols: paired.length - realParts.length,
      renamed,
      importedNetTraces: netTraces.lines.length,
      importedZones: pours.lines.length,
      renamedNets: netTraces.renamedNets,
      skippedPorts: netTraces.skippedPorts,
      skippedZones: pours.skipped,
      placeholderFootprints: componentLines.filter((line) => line.startsWith("    <chip ")).length,
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

/** Rejects a symbol upload before it is read: wrong extension or over the size limit. */
export function assertKicadSymbolFile(file: { name: string; size: number }): void {
  if (!file.name.toLowerCase().endsWith(KICAD_SYMBOL_EXTENSION)) {
    throw new Error(`${file.name} bukan file ${KICAD_SYMBOL_EXTENSION}`)
  }
  if (file.size > MAX_KICAD_FILE_BYTES) {
    throw new Error(`${file.name} terlalu besar untuk diimpor (maks ${MAX_KICAD_FILE_BYTES / 1024 / 1024} MB)`)
  }
}

/** Pins of the first symbol, by number; source ports win over their schematic duplicates. */
function symbolPins(output: readonly RawEl[]): { num: number; raw?: string }[] {
  const sourcePorts = output.filter((el) => el.type === "source_port")
  const ports = sourcePorts.length > 0 ? sourcePorts : output.filter((el) => el.type === "schematic_port")
  const byNumber = new Map<number, string | undefined>()
  ports.forEach((el, index) => {
    const num = typeof el.pin_number === "number" ? el.pin_number : index + 1
    if (!byNumber.has(num)) byNumber.set(num, str(el.name) ?? str(el.display_pin_label))
  })
  return [...byNumber.entries()].sort(([a], [b]) => a - b).map(([num, raw]) => ({ num, raw }))
}

function normalizeFootprint(raw: string | undefined): string | undefined {
  const footprint = raw?.trim()
  if (!footprint) return undefined
  if (!FOOTPRINT_STRING.test(footprint)) throw new Error(`Footprint "${footprint}" tidak valid (contoh: soic8, qfn32, tssop20)`)
  return footprint
}

function symbolTsx(compName: string, pinEntries: string, footprint: string | undefined): string {
  const todo = footprint ? "" : "// Footprint belum dipilih: tambahkan footprint sesuai paket di datasheet, mis. footprint=\"soic8\".\n"
  const footprintLine = footprint ? `    footprint=${jsxStringValue(footprint)}\n` : ""
  return `import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
${pinEntries}
} as const

${todo}export const ${compName} = (props: ChipProps<typeof pinLabels>) => (
  <chip
${footprintLine}    manufacturerPartNumber=${jsxStringValue(compName)}
    pinLabels={pinLabels}
    {...props}
  />
)
`
}

/** Converts a KiCad symbol library (.kicad_sym) into a reusable tscircuit component TSX file. */
export function importKicadSymbol(filename: string, content: string, options: KicadSymbolOptions = {}): ImportedKicadSymbol {
  if (content.length > MAX_KICAD_FILE_BYTES) throw new Error(`${filename} terlalu besar`)
  const footprint = normalizeFootprint(options.footprint)
  const converter = new KicadSymbolToCircuitJsonConverter()
  converter.addFile(filename, content)
  converter.runUntilFinished()
  const output = converter.getOutput() as RawEl[]

  const compName = toPascalIdent(options.customName?.trim() || sanitizeName(filename))
  const found = symbolPins(output)
  const { pins, renamed } = uniquePinLabels(found.length > 0 ? found : [{ num: 1 }, { num: 2 }])
  const pinEntries = pins.map((p) => `  pin${p.num}: ${JSON.stringify(p.label)},`).join("\n")
  return {
    componentName: compName,
    filePath: `lib/parts/${compName}.tsx`,
    tsx: symbolTsx(compName, pinEntries, footprint),
    pinCount: pins.length,
    renamedPins: renamed,
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
  if (notes.renamedNets) parts.push(`${notes.renamedNets} nama net disesuaikan (mis. +3V3→P3V3)`)
  if (notes.skippedPorts) parts.push(`${notes.skippedPorts} pin tanpa nomor tidak disambungkan`)
  if (notes.skippedZones) parts.push(`${notes.skippedZones} copper zone tanpa net/duplikat dilewati`)
  if (notes.placeholderFootprints) parts.push(`${notes.placeholderFootprints} chip memakai footprint sementara "${PLACEHOLDER_CHIP_FOOTPRINT}"`)
  if (notes.skippedSymbols > 0) parts.push(`${notes.skippedSymbols} simbol power/flag dilewati`)
  if (!notes.importedNetTraces) parts.push("koneksi net & footprint khusus perlu dicek ulang")
  return `. ${parts.join("; ")}.`
}
