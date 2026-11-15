import { describe, expect, it } from "vitest"
import {
  addImportedComponent,
  createProject,
  DEFAULT_ENTRYPOINT,
  duplicateProject,
  exportedNames,
  renamed,
  withFiles,
  withoutFile,
} from "./project-ops"

describe("project ops", () => {
  const base = createProject("Uji", 1)

  it("creates a project with the starter entrypoint", () => {
    expect(base.entrypoint).toBe(DEFAULT_ENTRYPOINT)
    expect(base.files[DEFAULT_ENTRYPOINT]).toContain("<board")
  })

  it("falls back to a default name", () => {
    expect(createProject("   ").name).toBe("Proyek tanpa nama")
  })

  it("updates files without mutating the original", () => {
    const next = withFiles(base, { "a.tsx": "x" }, 2)
    expect(next.files["a.tsx"]).toBe("x")
    expect(base.files["a.tsx"]).toBeUndefined()
    expect(next.updatedAt).toBe(2)
  })

  it("removes files but never the entrypoint", () => {
    const withExtra = withFiles(base, { "a.tsx": "x" })
    expect(Object.keys(withoutFile(withExtra, "a.tsx").files)).toEqual([DEFAULT_ENTRYPOINT])
    expect(withoutFile(base, DEFAULT_ENTRYPOINT)).toBe(base)
  })

  it("ignores blank renames and duplicates with a new id", () => {
    expect(renamed(base, "  ")).toBe(base)
    expect(renamed(base, "Baru").name).toBe("Baru")
    const copy = duplicateProject(base)
    expect(copy.id).not.toBe(base.id)
    expect(copy.name).toBe("Uji (salinan)")
  })
})

describe("addImportedComponent", () => {
  const tsx = "export const NE555P = (props: any) => <chip {...props} />\n"

  it("adds the part file and imports it into the entrypoint", () => {
    const result = addImportedComponent(createProject("x"), "C46749", tsx)
    expect(result.filePath).toBe("imports/C46749.tsx")
    expect(result.componentName).toBe("NE555P")
    expect(result.project.files[DEFAULT_ENTRYPOINT].startsWith('import { NE555P } from "./imports/C46749"')).toBe(true)
  })

  it("does not import the same part twice", () => {
    const once = addImportedComponent(createProject("x"), "C1", tsx).project
    const twice = addImportedComponent(once, "C1", tsx).project
    expect(twice.files[DEFAULT_ENTRYPOINT].match(/import \{ NE555P \}/g)).toHaveLength(1)
  })

  it("sanitises the part id", () => {
    expect(addImportedComponent(createProject("x"), "../C1", tsx).filePath).toBe("imports/___C1.tsx")
  })

  it("lists exported names", () => {
    expect(exportedNames("export const A = 1\nexport function B() {}\nexport const A = 2")).toEqual(["A", "B"])
  })
})
