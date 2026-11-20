import { describe, expect, it } from "vitest"
import {
  addPcbTrace,
  addTrace,
  addVia,
  deleteComponent,
  findBoardElement,
  inspectComponent,
  insertIntoBoard,
  listComponents,
  parseJsxElements,
  patchBoardProps,
  patchComponentProps,
} from "./tsx-ast"

const SAMPLE = `import React from "react"

// LED blinker
export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
    <led name="D1" color="red" footprint="0603" pcbX={4} pcbY={0} pcbRotation={90} />
    <chip name="U1" footprint="soic8" pcbX={x + 1} pinLabels={{ pin1: "VCC", pin2: "GND" }} />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
  </board>
)
`

describe("parseJsxElements", () => {
  it("parses nested JSX elements, comments, and object expressions accurately", () => {
    const elements = parseJsxElements(SAMPLE)
    expect(elements.map((e) => e.tagName)).toEqual(["board", "resistor", "led", "chip", "trace"])
    const board = elements[0]
    expect(board.selfClosing).toBe(false)
    expect(board.closeStart).not.toBeNull()
    expect(SAMPLE.slice(board.closeStart!, board.closeEnd!)).toBe("</board>")
  })

  it("ignores JSX-like text inside comments and strings", () => {
    const src = `// <resistor name="Fake" />\nconst s = "<led name='Fake2' />"\nexport default () => <board><resistor name="R1" /></board>`
    const comps = listComponents({ "index.circuit.tsx": src })
    expect(comps.map((c) => c.name)).toEqual(["R1"])
  })
})

describe("inspectComponent & listComponents", () => {
  it("reads component properties including numbers, units, and values", () => {
    const files = { "index.circuit.tsx": SAMPLE }
    expect(listComponents(files).map((c) => c.name)).toEqual(["R1", "D1", "U1"])
    const r1 = inspectComponent(files, "R1")
    expect(r1).toMatchObject({ tagName: "resistor", value: "1k", footprint: "0603", pcbX: -4, pcbY: 0 })
    const d1 = inspectComponent(files, "D1")
    expect(d1).toMatchObject({ tagName: "led", value: "red", pcbRotation: 90 })
  })
})

describe("patchComponentProps", () => {
  it("updates existing props, inserts new props, and deletes null/undefined props without disturbing formatting", () => {
    const files = { "index.circuit.tsx": SAMPLE }
    const res = patchComponentProps(files, "R1", {
      resistance: "4.7k",
      pcbX: 2.345,
      pcbRotation: 180,
      layer: "bottom",
    })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    expect(res.files["index.circuit.tsx"]).toContain(
      '<resistor name="R1" resistance="4.7k" footprint="0603" pcbX={2.35} pcbY={0} pcbRotation={180} layer="bottom" />',
    )
    // Remove layer prop
    const res2 = patchComponentProps(res.files, "R1", { layer: undefined })
    expect(res2.status).toBe("updated")
    if (res2.status !== "updated") return
    expect(res2.files["index.circuit.tsx"]).not.toContain('layer="bottom"')
  })

  it("refuses to overwrite dynamic expression props unless forced", () => {
    const files = { "index.circuit.tsx": SAMPLE }
    const res = patchComponentProps(files, "U1", { pcbX: 5 })
    expect(res).toEqual({ status: "unsupported", path: "index.circuit.tsx", prop: "pcbX" })
  })
})

describe("board & element mutations", () => {
  it("updates board dimensions", () => {
    const files = { "index.circuit.tsx": SAMPLE }
    expect(findBoardElement(files, "index.circuit.tsx")?.tagName).toBe("board")
    const res = patchBoardProps(files, "index.circuit.tsx", { width: "50mm", height: "40mm" })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    expect(res.files["index.circuit.tsx"]).toContain('<board width="50mm" height="40mm">')
  })

  it("inserts components, traces, raw copper pcbtraces, and vias cleanly inside <board>", () => {
    let files: Record<string, string> = { "index.circuit.tsx": SAMPLE }
    const r1 = insertIntoBoard(files, "index.circuit.tsx", '<capacitor name="C1" capacitance="100nF" footprint="0603" />')
    expect(r1.status).toBe("updated")
    if (r1.status !== "updated") return
    files = r1.files

    const r2 = addTrace(files, "index.circuit.tsx", ".C1 > .pin1", "net.GND")
    expect(r2.status).toBe("updated")
    if (r2.status !== "updated") return
    files = r2.files

    const r3 = addPcbTrace(
      files,
      "index.circuit.tsx",
      [
        { x: 0, y: 0 },
        { x: 5.5, y: 0 },
        { x: 5.5, y: 3.25 },
      ],
      { layer: "top", width: 0.25, net: "VCC" },
    )
    expect(r3.status).toBe("updated")
    if (r3.status !== "updated") return
    files = r3.files

    const r4 = addVia(files, "index.circuit.tsx", 5.5, 3.25, { fromLayer: "top", toLayer: "bottom", net: "VCC" })
    expect(r4.status).toBe("updated")
    if (r4.status !== "updated") return

    const out = r4.files["index.circuit.tsx"]
    expect(out).toContain('<capacitor name="C1" capacitance="100nF" footprint="0603" />')
    expect(out).toContain('<trace from=".C1 > .pin1" to="net.GND" />')
    expect(out).toContain('<pcbtrace route={[{ route_type: "wire", x: 0, y: 0, width: 0.25, layer: "top" }')
    expect(out).toContain('<via pcbX={5.5} pcbY={3.25} fromLayer="top" toLayer="bottom" net="VCC" />')
  })

  it("deletes a component and its connected traces cleanly", () => {
    const files = { "index.circuit.tsx": SAMPLE }
    const res = deleteComponent(files, "R1", { removeConnectedTraces: true })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    expect(res.files["index.circuit.tsx"]).not.toContain('name="R1"')
    expect(res.files["index.circuit.tsx"]).not.toContain('from=".R1 > .pin2"')
    expect(res.files["index.circuit.tsx"]).toContain('name="D1"')
  })
})
