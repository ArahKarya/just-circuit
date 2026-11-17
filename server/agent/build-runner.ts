/**
 * Script run with bun inside the build sandbox. It renders the project with @tscircuit/core
 * directly (like the browser preview), so the build can skip the schematic or the autorouter,
 * which `tsci build` cannot do for the schematic. Written into the temp build folder.
 */
export const RUNNER_FILE = ".cds-build-runner.tsx"

export const RUNNER_SOURCE = `import { RootCircuit } from "@tscircuit/core"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [entry, platformJson] = process.argv.slice(2)
const platform = JSON.parse(platformJson || "{}")
const module = await import(pathToFileURL(resolve(entry)).href)
const Main = module.default
if (Main === undefined) throw new Error(entry + " tidak punya export default")
const circuit = new RootCircuit({ platform })
circuit.add(typeof Main === "function" ? <Main /> : Main)
await circuit.renderUntilSettled()
mkdirSync("dist", { recursive: true })
writeFileSync("dist/circuit.json", JSON.stringify(circuit.getCircuitJson()))
`
