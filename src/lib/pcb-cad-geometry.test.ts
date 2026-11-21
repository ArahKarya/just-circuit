import { describe, expect, it } from "vitest"
import type { PcbCompView } from "./circuit-extract"
import {
  clampZoom,
  computeAlignment,
  distanceMm,
  fitViewport,
  miter45Point,
  polylineLength,
  screenToBoardMm,
  snapPointToGrid,
  snapToGrid,
  snapToPadOrGrid,
  toSvgPoints,
} from "./pcb-cad-geometry"

function comp(name: string, x: number, y: number, pads: { x: number; y: number }[] = []): PcbCompView {
  return {
    id: name,
    sourceId: name,
    name,
    x,
    y,
    width: 1,
    height: 1,
    rotation: 0,
    layer: "top",
    pads: pads.map((p, i) => ({ id: `${name}-${i}`, componentName: name, pinLabel: `pin${i + 1}`, x: p.x, y: p.y, width: 0.5, height: 0.5, shape: "rect", layer: "top" })),
  }
}

describe("miter45Point", () => {
  it("returns null for straight or exact 45° segments", () => {
    expect(miter45Point({ x: 0, y: 0 }, { x: 5, y: 0 }, false)).toBeNull()
    expect(miter45Point({ x: 0, y: 0 }, { x: 0, y: 5 }, false)).toBeNull()
    expect(miter45Point({ x: 0, y: 0 }, { x: 3, y: 3 }, false)).toBeNull()
  })

  it("goes straight first, then diagonal, by default", () => {
    expect(miter45Point({ x: 0, y: 0 }, { x: 5, y: 2 }, false)).toEqual({ x: 3, y: 0 })
    expect(miter45Point({ x: 0, y: 0 }, { x: -2, y: -5 }, false)).toEqual({ x: 0, y: -3 })
  })

  it("goes diagonal first when the posture is flipped", () => {
    expect(miter45Point({ x: 0, y: 0 }, { x: 5, y: 2 }, true)).toEqual({ x: 2, y: 2 })
    expect(miter45Point({ x: 1, y: 1 }, { x: -4, y: 3 }, true)).toEqual({ x: -1, y: 3 })
  })
})

describe("lengths", () => {
  it("sums polyline segments", () => {
    expect(polylineLength([])).toBe(0)
    expect(polylineLength([{ x: 0, y: 0 }])).toBe(0)
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11)
  })

  it("measures point distance", () => {
    expect(distanceMm({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5)
  })
})

describe("snapping", () => {
  it("snaps values to the grid without float noise", () => {
    expect(snapToGrid(1.26, 0.25)).toBe(1.25)
    expect(snapToGrid(-0.1, 0.5)).toBe(0)
    expect(snapToGrid(3.9, 2.54)).toBe(5.08)
    expect(snapPointToGrid({ x: 0.74, y: -0.76 }, 0.5)).toEqual({ x: 0.5, y: -1 })
  })

  it("prefers a nearby pad over the grid", () => {
    const comps = [comp("R1", 0, 0, [{ x: 0.8, y: 0.123 }])]
    expect(snapToPadOrGrid({ x: 0.6, y: 0.3 }, comps, 0.5)).toEqual({ x: 0.8, y: 0.12 })
    expect(snapToPadOrGrid({ x: 3.1, y: 3.1 }, comps, 0.5)).toEqual({ x: 3, y: 3 })
  })

  it("widens pad reach with coarse grids", () => {
    const comps = [comp("J1", 0, 0, [{ x: 0, y: 0 }])]
    expect(snapToPadOrGrid({ x: 1.9, y: 0 }, comps, 2.54)).toEqual({ x: 0, y: 0 })
    expect(snapToPadOrGrid({ x: 0.6, y: 0 }, comps, 0.1)).toEqual({ x: 0.6, y: 0 })
  })
})

describe("viewport", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it("maps the canvas centre to the pan origin with +Y up", () => {
    expect(screenToBoardMm(300, 150, rect, { x: 0, y: 0 }, 10)).toEqual({ x: 0, y: -0 })
    expect(screenToBoardMm(320, 130, rect, { x: 0, y: 0 }, 10)).toEqual({ x: 2, y: 2 })
    expect(screenToBoardMm(320, 130, rect, { x: 20, y: -20 }, 10)).toEqual({ x: 0, y: -0 })
  })

  it("fits the board and centres it", () => {
    const fit = fitViewport({ width: 1000, height: 600 }, { width: 20, height: 15, center: { x: 2, y: -1 } })
    expect(fit.zoom).toBeCloseTo(31.2)
    expect(fit.pan.x).toBeCloseTo(-62.4)
    expect(fit.pan.y).toBeCloseTo(-31.2)
  })

  it("clamps fit and manual zoom", () => {
    expect(fitViewport({ width: 10, height: 10 }, { width: 100, height: 100, center: { x: 0, y: 0 } }).zoom).toBe(4)
    expect(fitViewport({ width: 5000, height: 5000 }, { width: 1, height: 1, center: { x: 0, y: 0 } }).zoom).toBe(48)
    expect(clampZoom(1)).toBe(3)
    expect(clampZoom(200)).toBe(80)
    expect(clampZoom(12)).toBe(12)
  })

  it("formats SVG points with flipped Y", () => {
    expect(toSvgPoints([{ x: 1, y: 2 }, { x: -1, y: 0.5 }], 10)).toBe("10,-20 -10,-5")
  })
})

describe("computeAlignment", () => {
  const comps = [comp("A", 4, 1), comp("B", -2, 3.333), comp("C", 1, -5)]

  it("needs at least two parts", () => {
    expect(computeAlignment([comps[0]], "left")).toEqual([])
  })

  it("aligns left and top", () => {
    expect(computeAlignment(comps, "left").map((p) => p.patch)).toEqual([{ pcbX: -2 }, { pcbX: -2 }, { pcbX: -2 }])
    expect(computeAlignment(comps, "top").map((p) => p.patch)).toEqual([{ pcbY: 3.33 }, { pcbY: 3.33 }, { pcbY: 3.33 }])
  })

  it("distributes evenly in sorted order", () => {
    expect(computeAlignment(comps, "distX")).toEqual([
      { name: "B", patch: { pcbX: -2 } },
      { name: "C", patch: { pcbX: 1 } },
      { name: "A", patch: { pcbX: 4 } },
    ])
    expect(computeAlignment(comps, "distY")).toEqual([
      { name: "B", patch: { pcbY: 3.33 } },
      { name: "A", patch: { pcbY: -0.83 } },
      { name: "C", patch: { pcbY: -5 } },
    ])
  })

  it("does not mutate the input order", () => {
    const input = [...comps]
    computeAlignment(input, "distX")
    expect(input.map((c) => c.name)).toEqual(["A", "B", "C"])
  })
})
