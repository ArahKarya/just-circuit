import { nextDesignator, type Point2D } from "./circuit-extract"
import { jsxStringValue } from "./tsx-ast"

/** PCB CAD tools that drop a single board element at the clicked point. */
export type PlacementTool = "hole" | "cutout" | "fiducial" | "testpoint" | "silktext"

export interface PlacementContext {
  existingNames: readonly string[]
  silkText: string
  layer: string
}

const PLACEMENT_TOOLS: ReadonlySet<string> = new Set<PlacementTool>(["hole", "cutout", "fiducial", "testpoint", "silktext"])

export function isPlacementTool(tool: string): tool is PlacementTool {
  return PLACEMENT_TOOLS.has(tool)
}

/** Builds the JSX element a placement tool inserts into `<board>` at `pt`. */
export function placementElement(tool: PlacementTool, pt: Point2D, ctx: PlacementContext): string {
  const at = `pcbX={${pt.x}} pcbY={${pt.y}}`
  switch (tool) {
    case "hole":
      return `<hole diameter="3.2mm" ${at} />`
    case "cutout":
      return `<cutout shape="rect" width="4mm" height="2mm" ${at} />`
    case "fiducial": {
      const name = nextDesignator("FID", ctx.existingNames)
      return `<fiducial name=${jsxStringValue(name)} padDiameter="1mm" ${at} />`
    }
    case "testpoint": {
      const name = nextDesignator("TP", ctx.existingNames)
      return `<testpoint name=${jsxStringValue(name)} footprintVariant="pad" padDiameter="1.2mm" ${at} />`
    }
    case "silktext": {
      const txt = ctx.silkText.trim() || "TEXT"
      return `<silkscreentext text=${jsxStringValue(txt)} ${at} layer=${jsxStringValue(ctx.layer)} fontSize="1mm" />`
    }
  }
}

export function dimensionElement(from: Point2D, to: Point2D): string {
  return `<pcbnotedimension from={{ x: ${from.x}, y: ${from.y} }} to={{ x: ${to.x}, y: ${to.y} }} />`
}
