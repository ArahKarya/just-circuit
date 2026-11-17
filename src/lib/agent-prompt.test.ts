import { describe, expect, it } from "vitest"
import type { DesignIssue } from "./drc"
import { buildAgentSystemPrompt, buildSystemPrompt, describeProblems } from "./system-prompt"

describe("buildAgentSystemPrompt", () => {
  it("lists files without their content and keeps memory", () => {
    const prompt = buildAgentSystemPrompt({ "index.circuit.tsx": "SECRET-CODE", "lib/a.tsx": "x" }, "index.circuit.tsx", { projectMemory: "- LDO terpisah" })
    expect(prompt).toContain("- index.circuit.tsx (11 karakter) ← entrypoint")
    expect(prompt).toContain("## Agent mode")
    expect(prompt).toContain("- LDO terpisah")
    expect(prompt).not.toContain("SECRET-CODE")
    expect(prompt).not.toContain("## Current project")
    expect(prompt).toContain("never rewrite an existing file with write_file")
  })
})

const issue = (severity: DesignIssue["severity"], message: string, components: string[] = []): DesignIssue => ({ key: message, severity, category: "pcb", type: "x", message, components })

describe("problems and build scope in the prompt", () => {
  it("lists errors before warnings and caps the list", () => {
    const text = describeProblems([issue("warning", "W1"), issue("error", "E1", ["R1", "R2"]), issue("warning", "W2")], 2)
    expect(text).toBe("- [error] E1 (R1, R2)\n- [warning] W1\n- …and 1 more")
  })

  it("tells the AI about problems and skipped build parts, in agent mode too", () => {
    const context = { problems: [issue("error", "C1 extends outside board boundaries", ["C1"])], scope: { schematicDisabled: true, routingDisabled: true } }
    for (const prompt of [buildSystemPrompt({ "a.tsx": "x" }, "a.tsx", context), buildAgentSystemPrompt({ "a.tsx": "x" }, "a.tsx", context)]) {
      expect(prompt).toContain("## Problems in the last build (from the preview, 1 total)\n- [error] C1 extends outside board boundaries (C1)")
      expect(prompt).toContain("switched off the schematic and PCB autorouting")
      expect(prompt).toContain("Unrouted PCB connections are expected")
    }
  })

  it("adds nothing when the build is complete and clean", () => {
    const prompt = buildSystemPrompt({ "a.tsx": "x" }, "a.tsx", { problems: [], scope: {} })
    expect(prompt).not.toContain("## Build scope")
    expect(prompt).not.toContain("## Problems")
  })
})

