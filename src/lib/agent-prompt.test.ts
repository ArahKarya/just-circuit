import { describe, expect, it } from "vitest"
import { buildAgentSystemPrompt } from "./system-prompt"

describe("buildAgentSystemPrompt", () => {
  it("lists files without their content and keeps memory", () => {
    const prompt = buildAgentSystemPrompt({ "index.circuit.tsx": "SECRET-CODE", "lib/a.tsx": "x" }, "index.circuit.tsx", { projectMemory: "- LDO terpisah" })
    expect(prompt).toContain("- index.circuit.tsx (11 karakter) ← entrypoint")
    expect(prompt).toContain("## Agent mode")
    expect(prompt).toContain("- LDO terpisah")
    expect(prompt).not.toContain("SECRET-CODE")
    expect(prompt).not.toContain("## Current project")
  })
})
