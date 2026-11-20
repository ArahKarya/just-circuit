import { KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
import { extractPcbScene, extractSchematicScene } from "./circuit-extract"
import { roundMm } from "./tsx-ast"

export interface ImportedKicadProject {
  name: string
  entrypoint: string
  files: Record<string, string>
  stats: {
    components: number
    traces: number
    vias: number
  }
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
  const attrs: string[] = [`name=${JSON.stringify(name)}`]
  let tag = "chip"

  if (opts.ftype === "simple_resistor" || /^R\d+/i.test(name)) {
    tag = "resistor"
    attrs.push(`resistance=${JSON.stringify(opts.value || "10k")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_capacitor" || /^C\d+/i.test(name)) {
    tag = "capacitor"
    attrs.push(`capacitance=${JSON.stringify(opts.value || "100nF")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_inductor" || /^L\d+/i.test(name)) {
    tag = "inductor"
    attrs.push(`inductance=${JSON.stringify(opts.value || "10uH")}`)
    attrs.push(`footprint="0805"`)
  } else if (opts.ftype === "simple_led" || /^LED\d+/i.test(name)) {
    tag = "led"
    attrs.push(`color=${JSON.stringify(opts.value || "red")}`)
    attrs.push(`footprint="0603"`)
  } else if (opts.ftype === "simple_diode" || /^D\d+/i.test(name)) {
    tag = "diode"
    attrs.push(`footprint="sod123"`)
  } else {
    attrs.push(`footprint="soic8"`)
    if (opts.value) attrs.push(`manufacturerPartNumber=${JSON.stringify(opts.value)}`)
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

/** Converts a circuitJson array (e.g. from KiCad) into a clean, editable tscircuit TSX file. */
export function circuitJsonToTsx(circuitJson: readonly unknown[]): { tsx: string; stats: { components: number; traces: number; vias: number } } {
  const pcb = extractPcbScene(circuitJson)
  const sch = extractSchematicScene(circuitJson)
  const schByName = new Map(sch.components.map((c) => [c.name, c]))
  const pcbByName = new Map(pcb.components.map((c) => [c.name, c]))
  const allNames = [...new Set([...pcbByName.keys(), ...schByName.keys()])]

  const lines: string[] = []
  for (const name of allNames) {
    const p = pcbByName.get(name)
    const s = schByName.get(name)
    lines.push(
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
  }

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
    lines.push(`    <via pcbX={${roundMm(via.x)}} pcbY={${roundMm(via.y)}} fromLayer=${JSON.stringify(fromLayer)} toLayer=${JSON.stringify(toLayer)} />`)
  }

  const width = `${roundMm(Math.max(10, pcb.board.width))}mm`
  const height = `${roundMm(Math.max(10, pcb.board.height))}mm`
  const tsx = `export default () => (\n  <board width=${JSON.stringify(width)} height=${JSON.stringify(height)}>\n${lines.join("\n")}\n  </board>\n)\n`
  return {
    tsx,
    stats: {
      components: allNames.length,
      traces: pcb.traces.length,
      vias: pcb.vias.length,
    },
  }
}

/** Imports one or more KiCad files (.kicad_pcb / .kicad_sch) into a Just Circuit TSX project. */
export function importKicadFiles(files: { name: string; content: string }[]): ImportedKicadProject {
  if (files.length === 0) throw new Error("Pilih minimal satu file .kicad_pcb atau .kicad_sch")
  const converter = new KicadToCircuitJsonConverter()
  for (const file of files) {
    converter.addFile(file.name, file.content)
  }
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const { tsx, stats } = circuitJsonToTsx(circuitJson)
  return {
    name: sanitizeName(files[0].name),
    entrypoint: "index.circuit.tsx",
    files: { "index.circuit.tsx": tsx },
    stats,
  }
}
