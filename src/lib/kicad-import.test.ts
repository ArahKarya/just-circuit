import { describe, expect, it } from "vitest"
import { circuitJsonToTsx } from "./kicad-import"

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
