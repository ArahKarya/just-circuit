import { runTscircuitCode } from "@tscircuit/eval/eval"
import { describe, expect, it } from "vitest"
import {
  buildFootprintTsx,
  effectivePinCount,
  FAMILY_DEFAULTS,
  footprintWarnings,
  generatePads,
  padRowOffset,
  pin1Marker,
  safeComponentName,
  silkscreenRoutes,
  type FootprintParams,
  type PackageFamily,
} from "./footprint-wizard"

const paramsFor = (family: PackageFamily, overrides: Partial<FootprintParams> = {}): FootprintParams => ({
  family,
  ...FAMILY_DEFAULTS[family],
  ...overrides,
})

type CircuitElement = Record<string, unknown>

async function renderPart(tsx: string): Promise<CircuitElement[]> {
  const json = await runTscircuitCode(
    {
      "lib/parts/MyIc.tsx": tsx,
      "index.circuit.tsx": `import { MyIc } from "./lib/parts/MyIc"\nexport default () => (<board width="20mm" height="20mm"><MyIc name="U1" /></board>)`,
    },
    { mainComponentPath: "index.circuit.tsx" },
  )
  return json as unknown as CircuitElement[]
}

describe("SOIC land pattern", () => {
  it("matches the KiCad SOIC-8 3.9x4.9 P1.27 pad centres", () => {
    const params = paramsFor("soic")
    expect(padRowOffset(params)).toBeCloseTo(2.475, 3)
    const pads = generatePads(params)
    expect(pads).toHaveLength(8)
    expect(pads[0]).toMatchObject({ num: 1, x: -2.475, y: 1.905 })
    expect(pads[4]).toMatchObject({ num: 5, x: 2.475, y: -1.905 })
  })

  it("keeps pads overlapping the lead span instead of fully outside the body", () => {
    const params = paramsFor("soic")
    const pads = generatePads(params)
    const innerEdge = Math.abs(pads[0].x) - pads[0].w / 2
    const outerEdge = Math.abs(pads[0].x) + pads[0].w / 2
    expect(innerEdge).toBeLessThan(params.bodyWidth / 2)
    expect(outerEdge).toBeCloseTo(params.leadSpan / 2 + 0.45, 3)
  })

  it("rounds odd pin counts up to an even count", () => {
    expect(effectivePinCount("soic", 7)).toBe(8)
    expect(footprintWarnings(paramsFor("soic", { pinCount: 7 }), generatePads(paramsFor("soic", { pinCount: 7 })))[0]).toMatch(/8/)
  })

  it("draws silkscreen only above and below the pads", () => {
    const params = paramsFor("soic")
    const pads = generatePads(params)
    const routes = silkscreenRoutes(params, pads)
    const topY = Math.max(...pads.map((p) => p.y + p.h / 2))
    expect(routes).toHaveLength(2)
    for (const route of routes) for (const pt of route) expect(Math.abs(pt.y)).toBeGreaterThan(topY)
  })
})

describe("QFN land pattern", () => {
  it("adds the exposed thermal pad as the last pin when requested", () => {
    const pads = generatePads(paramsFor("qfn"))
    expect(pads).toHaveLength(17)
    expect(pads[16]).toMatchObject({ num: 17, x: 0, y: 0, w: 1.65, h: 1.65 })
    expect(generatePads(paramsFor("qfn", { exposedPad: 0 }))).toHaveLength(16)
  })

  it("warns when the exposed pad would crowd the signal pads", () => {
    const params = paramsFor("qfn", { exposedPad: 2.5 })
    expect(footprintWarnings(params, generatePads(params)).join(" ")).toMatch(/Exposed pad/)
    expect(footprintWarnings(paramsFor("qfn"), generatePads(paramsFor("qfn")))).toEqual([])
  })
})

describe("pin-1 marker", () => {
  it.each(["soic", "qfn", "pinrow", "bga"] as const)("sits outside pin 1 for %s", (family) => {
    const pads = generatePads(paramsFor(family))
    const first = pads.find((p) => p.num === 1)!
    const marker = pin1Marker(pads)
    expect(marker.x).toBeLessThan(first.x - first.w / 2)
    expect(marker.y).toBe(first.y)
  })
})

describe("warnings", () => {
  it("flags pads wider than the pitch and rows that collide", () => {
    const params = paramsFor("soic", { padWidth: 1.3, leadSpan: 2 })
    const text = footprintWarnings(params, generatePads(params)).join(" ")
    expect(text).toMatch(/bersentuhan/)
    expect(text).toMatch(/bertumpuk/)
  })
})

describe("buildFootprintTsx", () => {
  it("cleans the component name", () => {
    expect(safeComponentName("my-ic v2")).toBe("myicv2")
    expect(safeComponentName("555")).toBe("Part555")
    expect(safeComponentName("!!")).toBe("CustomPart")
  })

  it("marks the output as a starting point to check against the datasheet", () => {
    expect(buildFootprintTsx({ name: "MyIc", params: paramsFor("soic"), pinNames: [] })).toMatch(/datasheet/)
  })

  it.each(["soic", "qfn", "pinrow", "bga"] as const)("renders a %s part in tscircuit without errors", async (family) => {
    const tsx = buildFootprintTsx({ name: "MyIc", params: paramsFor(family), pinNames: ["VCC", "GND", "GND", "~", "SDA/SDI"] })
    const json = await renderPart(tsx)
    const errors = json.filter((e) => String(e.type).includes("error"))
    expect(errors).toEqual([])
    const pads = json.filter((e) => e.type === "pcb_smtpad" || e.type === "pcb_plated_hole")
    expect(pads).toHaveLength(generatePads(paramsFor(family)).length)
    const ports = json.filter((e) => e.type === "source_port").map((e) => e.name)
    const expected = ["VCC", "GND", "GND_2", "pin4", "SDA_SDI"]
    expect(ports.slice(0, 5)).toEqual(expected.slice(0, Math.min(5, ports.length)))
    if (family === "qfn") expect(ports).toContain("EP")
    expect(json.some((e) => e.type === "pcb_silkscreen_circle")).toBe(true)
  }, 30_000)
})
