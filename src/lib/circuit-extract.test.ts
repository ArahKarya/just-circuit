import { describe, expect, it } from "vitest"
import { extractPcbScene, extractSchematicScene, nextDesignator } from "./circuit-extract"

const SAMPLE_CIRCUIT = [
  { type: "pcb_board", width: 40, height: 25, center: { x: 0, y: 0 } },
  { type: "source_component", source_component_id: "sc1", name: "R1", display_resistance: "10k" },
  { type: "source_port", source_port_id: "sp1", source_component_id: "sc1", name: "pin1", pin_number: 1 },
  { type: "schematic_component", schematic_component_id: "sch1", source_component_id: "sc1", center: { x: 1, y: 2 }, size: { width: 1.5, height: 0.6 }, rotation: 0 },
  { type: "schematic_port", schematic_port_id: "schp1", schematic_component_id: "sch1", source_port_id: "sp1", center: { x: 0.25, y: 2 }, pin_number: 1 },
  { type: "schematic_trace", schematic_trace_id: "st1", edges: [{ from: { x: 0.25, y: 2 }, to: { x: -1, y: 2 } }] },
  { type: "schematic_net_label", schematic_net_label_id: "nl1", text: "VCC", center: { x: -1, y: 2.5 } },
  { type: "pcb_component", pcb_component_id: "pc1", source_component_id: "sc1", center: { x: 5, y: -3 }, width: 2, height: 1, rotation: 90, layer: "top" },
  { type: "pcb_port", pcb_port_id: "pp1", source_port_id: "sp1", x: 4.5, y: -3 },
  { type: "pcb_smtpad", pcb_smtpad_id: "pad1", pcb_component_id: "pc1", pcb_port_id: "pp1", shape: "rect", x: 4.5, y: -3, width: 0.8, height: 0.9, layer: "top" },
  {
    type: "pcb_trace",
    pcb_trace_id: "tr1",
    route: [
      { route_type: "wire", x: 4.5, y: -3, width: 0.25, layer: "top" },
      { route_type: "wire", x: 10, y: -3, width: 0.25, layer: "top" },
    ],
  },
  { type: "pcb_via", pcb_via_id: "v1", x: 10, y: -3, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] },
]

describe("circuit-extract", () => {
  it("extracts schematic components, pins, wires, and labels", () => {
    const scene = extractSchematicScene(SAMPLE_CIRCUIT)
    expect(scene.components).toHaveLength(1)
    expect(scene.components[0]).toMatchObject({ name: "R1", value: "10k", x: 1, y: 2 })
    expect(scene.components[0].pins[0]).toMatchObject({ selector: ".R1 > .pin1", x: 0.25, y: 2 })
    expect(scene.wires).toHaveLength(1)
    expect(scene.labels[0].text).toBe("VCC")
  })

  it("extracts PCB board, components, pads, copper traces, and vias", () => {
    const scene = extractPcbScene(SAMPLE_CIRCUIT)
    expect(scene.board).toMatchObject({ width: 40, height: 25 })
    expect(scene.components[0]).toMatchObject({ name: "R1", x: 5, y: -3, rotation: 90, layer: "top" })
    expect(scene.components[0].pads[0]).toMatchObject({ componentName: "R1", pinLabel: "pin1", layer: "top" })
    expect(scene.traces[0]).toMatchObject({ layer: "top", width: 0.25 })
    expect(scene.traces[0].points).toHaveLength(2)
    // tr1 has no source trace: it was drawn by hand with <pcbtrace>.
    expect(scene.traces[0].manual).toBe(true)
    const routed = extractPcbScene([...SAMPLE_CIRCUIT.slice(0, -1).map((el) => (el.type === "pcb_trace" ? { ...el, source_trace_id: "st_1" } : el))])
    expect(routed.traces[0].manual).toBeUndefined()
    expect(scene.vias[0]).toMatchObject({ x: 10, y: -3, outerDiameter: 0.6 })
  })

  it("picks the next unused designator", () => {
    expect(nextDesignator("R", ["R1", "R2", "C1"])).toBe("R3")
    expect(nextDesignator("U", [])).toBe("U1")
  })
})
