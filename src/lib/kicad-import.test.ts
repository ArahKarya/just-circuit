import { describe, expect, it } from "vitest"
import { circuitJsonToTsx, importKicadFiles, MAX_KICAD_FILE_BYTES } from "./kicad-import"
import { getStringAttr, parseJsxElements } from "./tsx-ast"

describe("kicad-import", () => {
  it("generates editable TSX with board, components, copper traces, and vias", () => {
    const circuitJson = [
      { type: "pcb_board", width: 50, height: 30, center: { x: 0, y: 0 } },
      { type: "source_component", source_component_id: "s1", name: "R1", ftype: "simple_resistor", display_resistance: "4.7k" },
      { type: "pcb_component", pcb_component_id: "p1", source_component_id: "s1", center: { x: -5, y: 2 }, width: 2, height: 1, rotation: 90, layer: "top" },
      { type: "schematic_component", schematic_component_id: "sc1", source_component_id: "s1", center: { x: 1, y: 1 }, size: { width: 1, height: 0.5 }, rotation: 0 },
      {
        type: "pcb_trace",
        pcb_trace_id: "t1",
        route: [
          { route_type: "wire", x: -5, y: 2, width: 0.25, layer: "top" },
          { route_type: "wire", x: 5, y: 2, width: 0.25, layer: "top" },
        ],
      },
      { type: "pcb_via", pcb_via_id: "v1", x: 5, y: 2, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] },
    ]
    const { tsx, stats } = circuitJsonToTsx(circuitJson)
    expect(stats).toEqual({ components: 1, traces: 1, vias: 1 })
    expect(tsx).toContain('<board width="50mm" height="30mm">')
    expect(tsx).toContain('<resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-5} pcbY={2} pcbRotation={90} schX={1} schY={1} />')
    expect(tsx).toContain('<pcbtrace route={[{ route_type: "wire", x: -5, y: 2, width: 0.25, layer: "top" }')
    expect(tsx).toContain('<via pcbX={5} pcbY={2} fromLayer="top" toLayer="bottom" />')
  })
})

describe("kicad-import hardening", () => {
  const part = (id: string, name: string, extra: Record<string, unknown> = {}) => [
    { type: "source_component", source_component_id: `s${id}`, name, ftype: "simple_resistor", ...extra },
    { type: "pcb_component", pcb_component_id: `p${id}`, source_component_id: `s${id}`, center: { x: Number(id), y: 0 }, width: 2, height: 1, rotation: 0, layer: "top" },
  ]

  it("keeps unannotated and duplicated parts apart, renaming them uniquely", () => {
    const json = [{ type: "pcb_board", width: 20, height: 20 }, ...part("1", "R?"), ...part("2", "R?"), ...part("3", "R1"), ...part("4", "R1")]
    const { tsx, stats, notes } = circuitJsonToTsx(json)
    expect(stats.components).toBe(4)
    const names = [...tsx.matchAll(/name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(4)
    expect(names).toContain("R1")
    expect(notes.renamed.map((r) => r.from).sort()).toEqual(["R1", "R?", "R?"])
  })

  it("skips KiCad power and flag symbols", () => {
    const json = [{ type: "pcb_board", width: 20, height: 20 }, ...part("1", "#PWR01"), ...part("2", "R1")]
    const { stats, notes } = circuitJsonToTsx(json)
    expect(stats.components).toBe(1)
    expect(notes.skippedSymbols).toBe(1)
  })

  it("never lets a crafted value escape its attribute", () => {
    const json = [
      { type: "pcb_board", width: 20, height: 20 },
      ...part("1", "R1", { display_resistance: '1k" x={alert(1)} y="' }),
      { type: "schematic_component", schematic_component_id: "sc1", source_component_id: "s1", center: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ]
    const { tsx } = circuitJsonToTsx(json)
    const [el] = parseJsxElements(tsx).filter((e) => e.tagName === "resistor")
    expect(el.attributes.map((a) => a.name)).not.toContain("x")
    expect(getStringAttr(el, "resistance")).toBe('1k" x={alert(1)} y="')
  })

  it("refuses files over the size limit", () => {
    expect(() => importKicadFiles([{ name: "big.kicad_pcb", content: "x".repeat(MAX_KICAD_FILE_BYTES + 1) }])).toThrow(/terlalu besar/)
  })
})
