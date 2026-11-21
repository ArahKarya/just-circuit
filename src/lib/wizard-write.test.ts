import { describe, expect, it } from "vitest"
import type { Project } from "./types"
import { planFileWrite } from "./wizard-write"

const project = (files: Record<string, string>): Project =>
  ({ id: "p", name: "P", entrypoint: "index.circuit.tsx", files, createdAt: 0, updatedAt: 0 }) as unknown as Project

const PART = "export const MyIc = () => <chip />\n"

describe("planFileWrite", () => {
  it("writes only the part file unless asked to insert it", () => {
    const plan = planFileWrite(project({ "index.circuit.tsx": "ENTRY" }), "lib/parts/MyIc.tsx", PART)
    expect(plan.files).toEqual({ "index.circuit.tsx": "ENTRY", "lib/parts/MyIc.tsx": PART })
    expect(plan.overwrites).toEqual([])
  })

  it("adds the entry import when the user asks for it", () => {
    const plan = planFileWrite(project({ "index.circuit.tsx": "ENTRY" }), "lib/parts/MyIc.tsx", PART, true)
    expect(plan.files["index.circuit.tsx"]).toBe('import { MyIc } from "./lib/parts/MyIc"\nENTRY')
  })

  it("reports an existing file with different content as an overwrite", () => {
    const base = project({ "index.circuit.tsx": "ENTRY", "lib/parts/MyIc.tsx": "OLD" })
    expect(planFileWrite(base, "lib/parts/MyIc.tsx", PART).overwrites).toEqual(["lib/parts/MyIc.tsx"])
    expect(planFileWrite({ ...base, files: { ...base.files, "lib/parts/MyIc.tsx": PART } }, "lib/parts/MyIc.tsx", PART).overwrites).toEqual([])
  })
})
