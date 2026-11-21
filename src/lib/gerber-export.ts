import type { AnyCircuitElement } from "circuit-json"

type GerberModule = typeof import("circuit-json-to-gerber")

export type GerberModuleLoader = () => Promise<Pick<GerberModule, "convertCircuitJsonToGerberFiles">>

/** Bundled, version-pinned converter; a dynamic import keeps it in its own chunk. */
const loadBundled: GerberModuleLoader = () => import("circuit-json-to-gerber")

/** Drops DRC/ERC errors and warnings, which the converter does not understand. */
function fabricationElements(circuitJson: readonly unknown[]): AnyCircuitElement[] {
  return circuitJson.filter((el): el is AnyCircuitElement => {
    if (!el || typeof el !== "object") return false
    return !("error_type" in el) && !("warning_type" in el)
  })
}

/** Gerber layers + Excellon drill files for the board, keyed by file name. */
export async function buildGerberFiles(circuitJson: readonly unknown[], load: GerberModuleLoader = loadBundled): Promise<Record<string, string>> {
  const elements = fabricationElements(circuitJson)
  if (!elements.some((el) => el.type === "pcb_board")) throw new Error("Tidak ada pcb_board untuk dibuat Gerber-nya")
  const { convertCircuitJsonToGerberFiles } = await load()
  return convertCircuitJsonToGerberFiles(elements, { flip_y_axis: false })
}
