import { describe, expect, it } from "vitest"
import { deleteElementSpan } from "./tsx-ast"
import { addBus, addCopperPour, addDifferentialPair, addNetRule, listCopperPours, toNetSelector } from "./tsx-rules"

const ENTRY = "index.circuit.tsx"
const FILES = { [ENTRY]: `export default () => (\n  <board width="30mm" height="20mm">\n  </board>\n)\n` }

function out(res: ReturnType<typeof addNetRule>): string {
  if (res.status !== "updated") throw new Error(`expected update, got ${res.status}`)
  return res.files[ENTRY]
}

describe("toNetSelector", () => {
  it("prefixes bare net names and keeps selectors", () => {
    expect(toNetSelector("GND")).toBe("net.GND")
    expect(toNetSelector(" net.GND ")).toBe("net.GND")
    expect(toNetSelector(".U1 > .GND")).toBe(".U1 > .GND")
    expect(toNetSelector("U1.pin1")).toBe("U1.pin1")
  })
})

describe("addNetRule", () => {
  it("emits nominalTraceWidth (a real NetProps field)", () => {
    const text = out(addNetRule(FILES, ENTRY, { name: "V5", nominalTraceWidth: "0.5mm" }))
    expect(text).toContain('<net name="V5" nominalTraceWidth="0.5mm" />')
    expect(text).not.toContain("traceWidth=\"")
    expect(text).not.toContain("clearance")
  })
})

describe("addCopperPour / listCopperPours", () => {
  it("writes a net selector and shows the bare net name", () => {
    const text = out(addCopperPour(FILES, ENTRY, { net: "GND", layer: "bottom" }))
    expect(text).toContain('<copperpour connectsTo="net.GND" layer="bottom" useThermalReliefs />')
    const [pour] = listCopperPours({ [ENTRY]: text })
    expect(pour).toMatchObject({ net: "GND", layer: "bottom" })
    const removed = deleteElementSpan({ [ENTRY]: text }, ENTRY, pour.start, pour.end)
    expect(removed.status === "updated" && listCopperPours(removed.files)).toEqual([])
  })
})

describe("addDifferentialPair", () => {
  it("keeps trace names / port selectors as given (core resolves them as trace names first)", () => {
    const text = out(addDifferentialPair(FILES, ENTRY, { name: "USB", positiveConnection: "USB_DP", negativeConnection: ".J1 > .DM" }))
    expect(text).toContain('<differentialpair name="USB" positiveConnection="USB_DP" negativeConnection=".J1 > .DM" />')
  })
})

describe("addBus", () => {
  it("emits a <bus> with a connections array", () => {
    const text = out(addBus(FILES, ENTRY, { name: "SPI", connections: [".U1 > .SCK", '.U1 > .M"OSI'] }))
    expect(text).toContain('<bus name="SPI" connections={[".U1 > .SCK", ".U1 > .M\\"OSI"]} />')
  })

  it("refuses an empty bus", () => {
    expect(addBus(FILES, ENTRY, { name: "SPI", connections: [] }).status).toBe("not-found")
  })
})
