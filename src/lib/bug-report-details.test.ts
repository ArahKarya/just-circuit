import { describe, expect, it } from "vitest"
import { buildBugDetails } from "./bug-report-details"

describe("buildBugDetails", () => {
  it("appends build state and recent errors below the description", () => {
    const out = buildBugDetails("  3D viewer kosong  ", {
      projectName: "PLC Pico",
      buildState: "error",
      buildErrors: ["e1", "e2"],
      recentErrors: [{ time: "t", message: "TypeError: boom" }],
    })
    expect(out.startsWith("3D viewer kosong\n\n--- Konteks otomatis ---")).toBe(true)
    expect(out).toContain("Proyek: PLC Pico")
    expect(out).toContain("Error build: e2")
    expect(out).toContain("Error browser (t): TypeError: boom")
  })

  it("leaves the description alone when context is not attached", () => {
    expect(buildBugDetails("hanya ini", null)).toBe("hanya ini")
  })
})
