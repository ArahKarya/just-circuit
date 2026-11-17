import { describe, expect, it } from "vitest"
import { attachmentProblem, fitWithin, namePasted } from "./attachments"

describe("attachments in the browser", () => {
  it("explains files that can't be attached", () => {
    expect(attachmentProblem("skema.png", 1000)).toBeNull()
    expect(attachmentProblem("program.exe", 10)).toMatch(/tidak didukung/)
    expect(attachmentProblem("ds.pdf", 40 * 1024 * 1024)).toMatch(/PDF "ds.pdf" terlalu besar \(40\.0 MB, maksimal 32\.0 MB\)/)
    expect(attachmentProblem("foto.jpg", 12 * 1024 * 1024)).toBeNull()
    expect(attachmentProblem("kosong.txt", 0)).toMatch(/kosong/)
  })

  it("fits big images inside the longest-edge limit", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10, 9000, 2048)).toEqual({ width: 2, height: 2048 })
  })

  it("names pasted screenshots", () => {
    const pasted = namePasted(new File(["x"], "image.png", { type: "image/png" }), new Date(2026, 10, 17, 9, 5, 7))
    expect(pasted.name).toBe("tempel-090507.png")
    const named = new File(["x"], "skema.png", { type: "image/png" })
    expect(namePasted(named)).toBe(named)
  })
})
