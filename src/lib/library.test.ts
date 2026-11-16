import { describe, expect, it } from "vitest"
import { describeLibrary, insertLibraryItem, selectForLibrary, type LibraryItemWithFiles } from "./library"
import type { Project } from "./types"

const project = (files: Record<string, string>): Project => ({ id: "p", name: "P", files, entrypoint: "index.circuit.tsx", createdAt: 0, updatedAt: 0 })

describe("selectForLibrary", () => {
  it("keeps a folder's structure and reports imports that stay behind", () => {
    const base = project({
      "index.circuit.tsx": "x",
      "modules/power/index.tsx": 'import { Ldo } from "./ldo"\nimport { C1 } from "../../imports/C46749"\nexport const Power = () => null',
      "modules/power/ldo.tsx": "export const Ldo = () => null",
      "imports/C46749.tsx": "export const C1 = () => null",
    })
    const picked = selectForLibrary(base, "modules/power")
    expect(Object.keys(picked.files).sort()).toEqual(["index.tsx", "ldo.tsx"])
    expect(picked.entry).toBe("index.tsx")
    expect(picked.missingImports).toEqual(["../../imports/C46749"])
  })

  it("saves a single file at the root of the item", () => {
    const picked = selectForLibrary(project({ "index.circuit.tsx": "x", "lib/relay.tsx": "export const Relay = () => null" }), "lib/relay.tsx")
    expect(picked).toEqual({ files: { "relay.tsx": "export const Relay = () => null" }, entry: "relay.tsx", missingImports: [] })
  })
})

describe("insertLibraryItem", () => {
  const item: LibraryItemWithFiles = {
    id: "i", name: "Power 3V3", description: "", entry: "index.tsx", exports: ["Power"], fileCount: 2, createdAt: 0, updatedAt: 0,
    files: { "index.tsx": "export const Power = () => null", "ldo.tsx": "x" },
  }

  it("copies into lib/<name>/ and imports the component in the entrypoint", () => {
    const result = insertLibraryItem(project({ "index.circuit.tsx": "export default () => <board />" }), item)
    expect(result.folder).toBe("lib/power-3v3")
    expect(Object.keys(result.project.files).sort()).toEqual(["index.circuit.tsx", "lib/power-3v3/index.tsx", "lib/power-3v3/ldo.tsx"])
    expect(result.project.files["index.circuit.tsx"]).toMatch(/^import \{ Power \} from "\.\/lib\/power-3v3\/index"/)
  })

  it("uses a new folder the second time and doesn't import a name twice", () => {
    const once = insertLibraryItem(project({ "index.circuit.tsx": "export default 1" }), item).project
    const twice = insertLibraryItem(once, item)
    expect(twice.folder).toBe("lib/power-3v3-2")
    expect(twice.componentName).toBeNull()
  })

  it("describes the library for the AI", () => {
    expect(describeLibrary([{ ...item, description: "AMS1117 + caps" }])).toBe("- Power 3V3 (exports: Power): AMS1117 + caps")
  })
})
