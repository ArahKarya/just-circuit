import { describe, expect, it } from "vitest"
import { addFile, buildTree, deletePath, FileOpError, renamePath, searchFiles, starterContent } from "./file-tree"
import type { Project } from "./types"

const project = (files: Record<string, string>, entrypoint = "index.circuit.tsx"): Project => ({ id: "p", name: "P", files, entrypoint, createdAt: 0, updatedAt: 0 })

describe("buildTree", () => {
  it("nests folders, puts folders first and the entrypoint first among files", () => {
    const tree = buildTree(["z.tsx", "index.circuit.tsx", "lib/power/reg.tsx", "lib/io.tsx", "a.md"], "index.circuit.tsx")
    expect(tree.map((n) => n.name)).toEqual(["lib", "index.circuit.tsx", "a.md", "z.tsx"])
    const lib = tree[0]
    expect(lib.kind === "folder" && lib.children.map((n) => n.path)).toEqual(["lib/power", "lib/io.tsx"])
  })
})

describe("file operations", () => {
  it("adds files with starter content and rejects bad or duplicate names", () => {
    const next = addFile(project({ "index.circuit.tsx": "x" }), "lib/power-supply.tsx")
    expect(next.files["lib/power-supply.tsx"]).toContain("export const PowerSupply")
    expect(() => addFile(next, "lib/power-supply.tsx")).toThrow(FileOpError)
    expect(() => addFile(next, "../x.tsx")).toThrow(FileOpError)
    expect(() => addFile(next, "node_modules/a.js")).toThrow(FileOpError)
    expect(starterContent("data.json")).toBe("{}\n")
  })

  it("renames files and folders and follows the entrypoint", () => {
    const base = project({ "index.circuit.tsx": "e", "lib/a.tsx": "a", "lib/b.tsx": "b" })
    const moved = renamePath(base, "lib", "modules")
    expect(Object.keys(moved.files).sort()).toEqual(["index.circuit.tsx", "modules/a.tsx", "modules/b.tsx"])
    const entry = renamePath(base, "index.circuit.tsx", "main.circuit.tsx")
    expect(entry.entrypoint).toBe("main.circuit.tsx")
    expect(() => renamePath(base, "lib/a.tsx", "lib/b.tsx")).toThrow(FileOpError)
  })

  it("refuses file/folder clashes, folder merges and prototype names", () => {
    const base = project({ "index.circuit.tsx": "e", "foo.json": "{}", "lib/a.tsx": "a", "mods/b.tsx": "b" })
    expect(() => addFile(base, "foo.json/bar.ts")).toThrow(/adalah file/)
    expect(() => addFile(base, "lib")).toThrow(FileOpError)
    expect(() => renamePath(base, "lib", "mods")).toThrow(/sudah ada/)
    expect(() => deletePath(project({ "index.circuit.tsx": "e" }), "constructor")).not.toThrow()
    expect(() => renamePath(project({ "index.circuit.tsx": "e" }), "toString", "x")).toThrow(/tidak ditemukan/)
  })

  it("keeps the manual-edits import working when the entrypoint moves", () => {
    const base = project({ "index.circuit.tsx": 'import manualEdits from "./manual-edits.json"\nexport default 1', "manual-edits.json": "{}" })
    const moved = renamePath(base, "index.circuit.tsx", "boards/main.circuit.tsx")
    expect(moved.files["boards/main.circuit.tsx"]).toContain('from "../manual-edits.json"')
    expect(() => renamePath(base, "index.circuit.tsx", "index.md")).toThrow(/\.tsx/)
  })

  it("deletes files or folders but never the entrypoint", () => {
    const base = project({ "index.circuit.tsx": "e", "lib/a.tsx": "a", "lib/b.tsx": "b" })
    expect(Object.keys(deletePath(base, "lib").files)).toEqual(["index.circuit.tsx"])
    expect(() => deletePath(base, "index.circuit.tsx")).toThrow(FileOpError)
  })
})

describe("searchFiles", () => {
  it("finds every line with the text, case-insensitively by default", () => {
    const files = { "a.tsx": "const R1 = 1\nconst r2 = 2", "b.tsx": "<resistor name=\"R1\" />" }
    expect(searchFiles(files, "r1").hits.map((h) => `${h.path}:${h.line}:${h.column}`)).toEqual(["a.tsx:1:7", "b.tsx:1:17"])
    expect(searchFiles(files, "r1", true).hits).toEqual([])
    expect(searchFiles(files, "").hits).toEqual([])
  })
})
