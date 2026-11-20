import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { footprintSegments, kicadFootprintsIn, prepareKicadFootprints } from "./kicad-footprints"

let cacheDir: string
beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "just-circuit-fp-"))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(cacheDir, { recursive: true, force: true })
})

describe("KiCad footprints for server builds", () => {
  it("finds the footprints a project names and refuses anything that isn't library/name", () => {
    const files = {
      "index.circuit.tsx": `<chip footprint="kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm" /><chip footprint={"kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm"} />`,
      "lib/a.tsx": "footprint='kicad:Connector_PinHeader_2.54mm/PinHeader_1x04_P2.54mm_Vertical' footprint=`kicad:../../etc/passwd` footprint=\"kicad:a/b/c\"",
    }
    expect(kicadFootprintsIn(files)).toEqual(["Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm", "Connector_PinHeader_2.54mm/PinHeader_1x04_P2.54mm_Vertical"])
    expect(footprintSegments("../x")).toBeNull()
    expect(footprintSegments("Lib/..")).toBeNull()
    expect(footprintSegments("Lib/na me")).toBeNull()
  })

  it("fetches once, then serves the footprint from the disk cache", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("SALAH") ? new Response("missing", { status: 404 }) : new Response(JSON.stringify([{ type: "pcb_smtpad" }]), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const first = await prepareKicadFootprints(["Package_SO/SOIC-8", "Package_SO/SALAH"], cacheDir)
    expect(first.footprints).toEqual({ "Package_SO/SOIC-8": [{ type: "pcb_smtpad" }] })
    expect(first.missing).toEqual(["Package_SO/SALAH"])
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://kicad-mod-cache.tscircuit.com/Package_SO/SOIC-8.circuit.json")
    expect(JSON.parse(await readFile(path.join(cacheDir, "Package_SO", "SOIC-8.circuit.json"), "utf8"))).toEqual([{ type: "pcb_smtpad" }])

    fetchMock.mockClear()
    const second = await prepareKicadFootprints(["Package_SO/SOIC-8"], cacheDir)
    expect(second.footprints["Package_SO/SOIC-8"]).toEqual([{ type: "pcb_smtpad" }])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
