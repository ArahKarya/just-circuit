import { KicadFootprintToCircuitJsonConverter } from "kicad-to-circuit-json"
import { componentNameFor, partFilePath, type KicadModPart } from "../../shared/parts.js"
import { ValidationError } from "../storage/errors.js"

export const MAX_KICAD_MOD_CHARS = 512 * 1024
const MAX_PADS = 2000
const PAD_TYPES = new Set(["pcb_smtpad", "pcb_plated_hole"])

interface Element {
  type?: string
  text?: string
  port_hints?: unknown
}

const cleanName = (raw: string) => raw.replace(/[^\w.\-+#(),%]+/g, "").slice(0, 80)

/** Pad numbers become pinN; lettered pads (BGA "A1", "EP") get the next free pinN with that name as label. */
export function pinLabelsForPads(hints: readonly string[]): Record<string, string[]> {
  const numbers = [...new Set(hints.filter((hint) => /^\d{1,4}$/.test(hint)).map(Number))].sort((a, b) => a - b)
  const named = [...new Set(hints.filter((hint) => !/^\d{1,4}$/.test(hint)).map((hint) => hint.replace(/[^A-Za-z0-9_]/g, "_")).filter(Boolean))]
  const labels: Record<string, string[]> = {}
  for (const number of numbers) labels[`pin${number}`] = [`P${number}`]
  let next = (numbers.at(-1) ?? 0) + 1
  for (const name of named) labels[`pin${next++}`] = [name]
  return labels
}

/** Turns a KiCad footprint file into a component (TSX + footprint JSON) the project can use. */
export function convertKicadMod(content: string, fileName: string, partName = ""): KicadModPart {
  if (content.length > MAX_KICAD_MOD_CHARS) throw new ValidationError("File .kicad_mod terlalu besar (maksimal 512 KB)")
  const head = /^\s*\((footprint|module)\s+"?([^"\s)]+)/.exec(content)
  if (!head) throw new ValidationError(`${fileName} bukan file footprint KiCad (.kicad_mod)`)
  const footprintName = cleanName(head[2]) || "footprint"

  let elements: Element[]
  let warnings: string[]
  try {
    const converter = new KicadFootprintToCircuitJsonConverter()
    converter.addFile("footprint.kicad_mod", content)
    converter.runUntilFinished()
    elements = converter.getOutput() as Element[]
    warnings = converter.getWarnings().slice(0, 20).map((warning) => String(warning).slice(0, 200))
  } catch (error) {
    throw new ValidationError(`${fileName} tidak bisa dibaca: ${error instanceof Error ? error.message.slice(0, 200) : "format tidak dikenal"}`)
  }
  // Same as the browser preview's KiCad loader: KiCad's own text fields except the reference designator.
  const footprint = elements.filter((element) => (element.type === "pcb_silkscreen_text" ? element.text === "REF**" : true))
  const pads = footprint.filter((element) => PAD_TYPES.has(element.type ?? ""))
  if (pads.length === 0) throw new ValidationError(`${fileName} tidak punya pad`)
  if (pads.length > MAX_PADS) throw new ValidationError(`${fileName} punya terlalu banyak pad`)
  const hints = pads.flatMap((pad) => (Array.isArray(pad.port_hints) ? pad.port_hints.filter((hint): hint is string => typeof hint === "string") : []))
  const labels = pinLabelsForPads(hints)

  const componentName = componentNameFor(cleanName(partName) || footprintName)
  const tsxPath = partFilePath(componentName)
  const jsonPath = tsxPath.replace(/\.tsx$/, ".footprint.json")
  const tsx = [
    `// ${componentName}: footprint dari ${cleanName(fileName) || "file .kicad_mod"} (KiCad ${footprintName}).`,
    `// Nama pin masih nomor pad (P1, P2, …): ganti dengan nama dari datasheet. File footprint JSON jangan diubah.`,
    `import type { ChipProps } from "tscircuit"`,
    `import footprint from "./${componentName}.footprint.json"`,
    ``,
    `const pinLabels = {`,
    ...Object.entries(labels).map(([pin, names]) => `  ${pin}: ${JSON.stringify(names)},`),
    `} as const`,
    ``,
    `export const ${componentName} = (props: ChipProps<typeof pinLabels>) => (`,
    `  <chip name="U1" footprint={footprint} pinLabels={pinLabels} {...props} />`,
    `)`,
    ``,
    `export default ${componentName}`,
    ``,
  ].join("\n")
  return {
    componentName,
    footprintName,
    padCount: Object.keys(labels).length,
    files: { [tsxPath]: tsx, [jsonPath]: `${JSON.stringify(footprint, null, 1)}\n` },
    tsxPath,
    warnings,
  }
}
