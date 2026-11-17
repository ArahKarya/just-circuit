/**
 * Script run with bun inside the build sandbox. It renders the project with @tscircuit/core
 * directly (like the browser preview), so the build can skip the schematic or the autorouter,
 * which `tsci build` cannot do for the schematic. Written into the temp build folder.
 */
export const RUNNER_FILE = ".cds-build-runner.tsx"
/** KiCad footprints the server fetched before the build (the sandbox has no network). */
export const FOOTPRINTS_FILE = ".cds-footprints.json"

export const RUNNER_SOURCE = `import { RootCircuit } from "@tscircuit/core"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [entry, platformJson] = process.argv.slice(2)
const footprints = existsSync("${FOOTPRINTS_FILE}") ? JSON.parse(readFileSync("${FOOTPRINTS_FILE}", "utf8")) : {}
const platform = {
  ...JSON.parse(platformJson || "{}"),
  footprintLibraryMap: {
    // Same filtering as the browser preview: KiCad's own text fields except the reference designator.
    kicad: async (name) => {
      const footprint = footprints[name]
      if (!footprint) throw new Error("Footprint KiCad " + JSON.stringify(name) + " tidak ditemukan; cek namanya dengan search_footprints")
      return { footprintCircuitJson: footprint.filter((el) => (el?.type === "pcb_silkscreen_text" ? el?.text === "REF**" : true)) }
    },
  },
}
const module = await import(pathToFileURL(resolve(entry)).href)
const Main = module.default
if (Main === undefined) throw new Error(entry + " tidak punya export default")
const circuit = new RootCircuit({ platform })
circuit.add(typeof Main === "function" ? <Main /> : Main)
await circuit.renderUntilSettled()
mkdirSync("dist", { recursive: true })
writeFileSync("dist/circuit.json", JSON.stringify(circuit.getCircuitJson()))
`
