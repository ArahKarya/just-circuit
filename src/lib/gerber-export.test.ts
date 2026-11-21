import { runTscircuitCode } from "@tscircuit/eval/eval"
import { describe, expect, it, vi } from "vitest"
import { buildGerberFiles } from "./gerber-export"

const board = { type: "pcb_board", width: 10, height: 10 }
const drcError = { type: "pcb_trace_error", error_type: "pcb_trace_error", message: "x" }

describe("buildGerberFiles", () => {
  it("passes only fabrication elements to the converter", async () => {
    const convertCircuitJsonToGerberFiles = vi.fn(() => ({ "F_Cu.gbr": "x" }))
    expect(await buildGerberFiles([board, drcError], async () => ({ convertCircuitJsonToGerberFiles }))).toEqual({ "F_Cu.gbr": "x" })
    expect(convertCircuitJsonToGerberFiles).toHaveBeenCalledWith([board], { flip_y_axis: false })
  })

  it("rejects a circuit without a board and surfaces loader failures", async () => {
    await expect(buildGerberFiles([drcError])).rejects.toThrow(/pcb_board/)
    await expect(buildGerberFiles([board], async () => Promise.reject(new Error("rusak")))).rejects.toThrow("rusak")
  })

  it("generates real copper Gerbers and a drill file from a rendered board", async () => {
    const circuitJson = await runTscircuitCode(
      {
        "index.circuit.tsx": `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} />
    <pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX={4} />
    <trace from=".R1 > .pin1" to=".J1 > .pin1" />
  </board>
)`,
      },
      { mainComponentPath: "index.circuit.tsx" },
    )
    const files = await buildGerberFiles(circuitJson)
    const names = Object.keys(files)
    const copper = names.find((n) => /F_Cu|\.gtl$/i.test(n))
    const drill = names.find((n) => /\.drl$/i.test(n))
    expect(copper, names.join(", ")).toBeDefined()
    expect(drill, names.join(", ")).toBeDefined()
    expect(files[copper!]).toMatch(/%FSLAX/)
    expect(files[drill!]).toMatch(/M48/)
  }, 30_000)
})
