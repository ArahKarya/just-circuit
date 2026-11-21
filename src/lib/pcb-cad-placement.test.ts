import { describe, expect, it } from "vitest"
import { dimensionElement, isPlacementTool, placementElement } from "./pcb-cad-placement"

const ctx = { existingNames: ["R1", "TP1", "FID1", "FID2"], silkText: "REV 1.0", layer: "top" }
const at = { x: 1.5, y: -2 }

describe("pcb-cad-placement", () => {
  it("recognises placement tools only", () => {
    expect(["hole", "cutout", "fiducial", "testpoint", "silktext"].every(isPlacementTool)).toBe(true)
    expect(["select", "route", "via", "dimension", "measure"].some(isPlacementTool)).toBe(false)
  })

  it("builds hole and cutout elements", () => {
    expect(placementElement("hole", at, ctx)).toBe('<hole diameter="3.2mm" pcbX={1.5} pcbY={-2} />')
    expect(placementElement("cutout", at, ctx)).toBe('<cutout shape="rect" width="4mm" height="2mm" pcbX={1.5} pcbY={-2} />')
  })

  it("picks the next free designator for fiducials and testpoints", () => {
    expect(placementElement("fiducial", at, ctx)).toBe('<fiducial name="FID3" padDiameter="1mm" pcbX={1.5} pcbY={-2} />')
    expect(placementElement("testpoint", at, ctx)).toBe('<testpoint name="TP2" footprintVariant="pad" padDiameter="1.2mm" pcbX={1.5} pcbY={-2} />')
  })

  it("writes silkscreen text on the active layer and falls back to TEXT", () => {
    expect(placementElement("silktext", at, { ...ctx, layer: "bottom" })).toBe(
      '<silkscreentext text="REV 1.0" pcbX={1.5} pcbY={-2} layer="bottom" fontSize="1mm" />',
    )
    expect(placementElement("silktext", at, { ...ctx, silkText: "  " })).toContain('text="TEXT"')
    expect(placementElement("silktext", at, { ...ctx, silkText: 'a"b' })).toContain('text={"a\\"b"}')
  })

  it("builds a PCB note dimension", () => {
    expect(dimensionElement({ x: 0, y: 1 }, { x: 5, y: -1 })).toBe("<pcbnotedimension from={{ x: 0, y: 1 }} to={{ x: 5, y: -1 }} />")
  })
})
