import { describe, expect, it } from "vitest"
import { safeFileSlug } from "./file-name"

describe("safeFileSlug", () => {
  it("keeps letters, digits, dash and underscore", () => {
    expect(safeFileSlug("Board_v2-final")).toBe("board_v2-final")
  })

  it("strips path separators, dots and control characters", () => {
    expect(safeFileSlug("../../etc/passwd")).toBe("etc-passwd")
    expect(safeFileSlug('a\\b:c*d?"e<f>|g\u0000h')).toBe("a-b-c-d-e-f-g-h")
  })

  it("falls back when nothing usable remains", () => {
    expect(safeFileSlug("...")).toBe("board")
    expect(safeFileSlug("", "proyek")).toBe("proyek")
  })

  it("caps very long names", () => {
    expect(safeFileSlug("x".repeat(300)).length).toBe(80)
  })
})
