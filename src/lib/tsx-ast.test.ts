import { describe, expect, it } from "vitest"
import {
  listManualPcbTraces,
  addPcbTrace,
  addTrace,
  addVia,
  deleteComponent,
  duplicateComponent,
  findBoardElement,
  inspectComponent,
  insertIntoBoard,
  jsxStringValue,
  listComponents,
  parseJsxElements,
  patchBoardProps,
  patchComponentProps,
  selectorComponent,
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

describe("hardening", () => {
  it("treats quotes and slashes in JSX text as text, not string starts", () => {
    const src = `export default () => (
  <board width="10mm" height="10mm">
    <silkscreentext text="x" />
    don't use // this "part"
    <resistor name="R1" resistance="1k" footprint="0402" />
    {items.map((it) => <resistor name="R2" resistance={'1k'} footprint="0402" />)}
  </board>
)`
    expect(listComponents({ "index.circuit.tsx": src }).map((c) => c.name)).toEqual(["R1", "R2"])
    expect(findBoardElement({ "index.circuit.tsx": src }, "index.circuit.tsx")?.closeStart).not.toBeNull()
  })

  it("writes values with quotes, backslashes or newlines as JS string expressions", () => {
    expect(jsxStringValue("10k")).toBe('"10k"')
    expect(jsxStringValue('a"b')).toBe('{"a\\"b"}')
    expect(jsxStringValue("a\\b")).toBe('{"a\\\\b"}')
    expect(jsxStringValue("a\nb")).toBe('{"a\\nb"}')
  })

  it("cannot be broken out of with a crafted value, and reads the value back intact", () => {
    const files = { "index.circuit.tsx": `export default () => (<board><resistor name="R1" resistance="1k" /></board>)` }
    const evil = '1k" onClick={alert(1)} x="'
    const res = patchComponentProps(files, "R1", { resistance: evil })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    const [el] = parseJsxElements(res.files["index.circuit.tsx"]).filter((e) => e.tagName === "resistor")
    expect(el.attributes.map((a) => a.name)).toEqual(["name", "resistance"])
    expect(inspectComponent(res.files, "R1")?.element.attributes[1].parsed).toEqual({ kind: "string", value: evil })
    const again = patchComponentProps(res.files, "R1", { resistance: "2k" })
    expect(again.status).toBe("updated")
  })

  it("removes only the deleted part's traces and net labels", () => {
    const src = `export default () => (
  <board>
    <resistor name="R1" resistance="1k" />
    <resistor name="R1-2" resistance="1k" />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from="R1.pin2" to="R1-2.pin1" />
    <trace from=".R1-2 > .pin2" to="net.VCC" />
    <netlabel net="VCC" connection="R1.pin1" />
  </board>
)`
    const res = deleteComponent({ "index.circuit.tsx": src }, "R1", { removeConnectedTraces: true })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    const out = res.files["index.circuit.tsx"]
    expect(out).not.toContain('".R1 > .pin1"')
    expect(out).not.toContain('"R1.pin2"')
    expect(out).not.toContain("<netlabel")
    expect(out).toContain('from=".R1-2 > .pin2"')
    expect(out).toContain('name="R1-2"')
  })

  it("finds the component a selector points at", () => {
    expect(selectorComponent(".U1 > .pin3")).toBe("U1")
    expect(selectorComponent("U1.pin3")).toBe("U1")
    expect(selectorComponent("net.GND")).toBeNull()
    expect(selectorComponent(undefined)).toBeNull()
  })
})

describe("duplicateComponent", () => {
  const ENTRY = "index.circuit.tsx"
  it("offsets existing coordinates and keeps the original", () => {
    const files = {
      [ENTRY]: `export default () => (\n  <board width="30mm" height="20mm">\n    <resistor name="R9" resistance="1k" pcbX={0} pcbY={0} schX={0} schY={2} />\n  </board>\n)\n`,
    }
    const dup = duplicateComponent(files, "R9", "R10", { pcbDx: 2, pcbDy: 3 })
    expect(dup.status).toBe("updated")
    if (dup.status !== "updated") return
    expect(dup.files[ENTRY]).toContain('<resistor name="R9" resistance="1k" pcbX={0} pcbY={0} schX={0} schY={2} />')
    expect(dup.files[ENTRY]).toContain('name="R10"')
    expect(dup.files[ENTRY]).toContain("pcbX={2} pcbY={3}")
  })

  it("strips connections so the copy is not shorted to the original's nets", () => {
    const files = {
      [ENTRY]: `export default () => (\n  <board>\n    <chip name="U1" footprint="soic8" connections={{ pin1: "net.VCC" }} pcbX={1} pcbY={1} />\n  </board>\n)\n`,
    }
    const dup = duplicateComponent(files, "U1", "U2", { pcbDx: 3 })
    expect(dup.status).toBe("updated")
    if (dup.status !== "updated") return
    const copy = inspectComponent(dup.files, "U2")
    expect(copy?.element.attributes.map((a) => a.name)).not.toContain("connections")
    expect(inspectComponent(dup.files, "U1")?.element.attributes.map((a) => a.name)).toContain("connections")
  })

  it("uses the rendered position as base when the code has no coordinates", () => {
    const files = { [ENTRY]: `export default () => (\n  <board>\n    <resistor name="R1" resistance="1k" />\n  </board>\n)\n` }
    const dup = duplicateComponent(files, "R1", "R2", { schDx: 2 }, { schX: 4, schY: 1 })
    expect(dup.status).toBe("updated")
    if (dup.status !== "updated") return
    expect(inspectComponent(dup.files, "R2")).toMatchObject({ schX: 6, schY: 1 })
    expect(inspectComponent(dup.files, "R2")?.pcbX).toBeUndefined()
  })

  it("applies a default offset when none is given for a coordinate that exists", () => {
    const files = { [ENTRY]: `export default () => (\n  <board>\n    <resistor name="R1" pcbX={0} pcbY={0} schX={0} schY={0} />\n  </board>\n)\n` }
    const dup = duplicateComponent(files, "R1", "R2", {})
    expect(dup.status).toBe("updated")
    if (dup.status !== "updated") return
    const copy = inspectComponent(dup.files, "R2")
    expect(copy?.pcbX).not.toBe(0)
    expect(copy?.schX).not.toBe(0)
  })
})

describe("patchComponentProps with a file path", () => {
  it("patches the component in the requested file when names repeat", () => {
    const files = {
      "a.tsx": `export const A = () => <resistor name="R1" resistance="1k" />`,
      "b.tsx": `export const B = () => <resistor name="R1" resistance="1k" />`,
    }
    const res = patchComponentProps(files, "R1", { resistance: "2k" }, { path: "b.tsx" })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    expect(res.path).toBe("b.tsx")
    expect(res.files["a.tsx"]).toContain('resistance="1k"')
    expect(res.files["b.tsx"]).toContain('resistance="2k"')
  })
})

describe("listManualPcbTraces", () => {
  it("reads the written route points of each manual trace", () => {
    const source = `export default () => (<board><pcbtrace route={[{ route_type: "wire", x: -5, y: 4.25, width: 0.2, layer: "top" }, { route_type: "wire", x: 5, y: 4.25, width: 0.2, layer: "top" }]} /></board>)`
    const [trace] = listManualPcbTraces({ "index.tsx": source })
    expect(trace.points).toEqual([{ x: -5, y: 4.25 }, { x: 5, y: 4.25 }])
  })
})
