import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { readProjectZip, ZipImportError } from "./zip-import"

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  Object.entries(files).forEach(([path, content]) => zip.file(path, content))
  return zip.generateAsync({ type: "uint8array" })
}

describe("readProjectZip", () => {
  it("reads a tsci folder zip, strips the wrapping folder and uses package.json", async () => {
    const data = await zipOf({
      "plc/package.json": JSON.stringify({ name: "plc-pico", main: "main.circuit.tsx" }),
      "plc/main.circuit.tsx": "export default () => <board />",
      "plc/lib/power.tsx": "export const P = 1",
      "plc/node_modules/x/index.js": "evil()",
      "plc/dist/circuit.json": "{}",
      "plc/tscircuit.config.json": "{}",
      "plc/.env": "SECRET=1",
      "plc/photo.png": "binary",
      "__MACOSX/plc/._main.circuit.tsx": "junk",
    })
    const project = await readProjectZip(data, "plc.zip")
    expect(project.name).toBe("plc-pico")
    expect(project.entrypoint).toBe("main.circuit.tsx")
    expect(Object.keys(project.files).sort()).toEqual(["lib/power.tsx", "main.circuit.tsx"])
    expect(project.skipped).toEqual(expect.arrayContaining(["node_modules/x/index.js", "dist/circuit.json", ".env", "photo.png"]))
  })

  it("finds a *.circuit.tsx entrypoint without package.json", async () => {
    const project = await readProjectZip(await zipOf({ "boards/amp.circuit.tsx": "x", "README.md": "hi" }), "Amplifier.zip")
    expect(project.entrypoint).toBe("boards/amp.circuit.tsx")
    expect(project.name).toBe("Amplifier")
  })

  it("rejects zips without a circuit and non-zip data", async () => {
    await expect(readProjectZip(await zipOf({ "notes.md": "x" }), "a.zip")).rejects.toBeInstanceOf(ZipImportError)
    await expect(readProjectZip(new TextEncoder().encode("not a zip"), "a.zip")).rejects.toBeInstanceOf(ZipImportError)
  })
})
