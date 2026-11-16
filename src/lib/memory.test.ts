import { describe, expect, it } from "vitest"
import { appendMemory, extractMemoryNotes, MAX_MEMORY_CHARS } from "./memory"
import { stripCodeBlocks } from "./extract-code"

describe("memory", () => {
  it("reads project and global notes from memory blocks", () => {
    const reply = "Oke.\n```memory\n- LDO 3V3 terpisah (AP2112K)\n- V3V3_EN Pico dimatikan\n```\n```memory scope=global\n* Pakai resistor 0603\n```"
    expect(extractMemoryNotes(reply)).toEqual({ project: ["LDO 3V3 terpisah (AP2112K)", "V3V3_EN Pico dimatikan"], global: ["Pakai resistor 0603"] })
    expect(stripCodeBlocks(reply)).toContain("[memori diperbarui]")
  })

  it("appends only new notes and refuses to overflow", () => {
    const first = appendMemory("", ["LDO 3V3 terpisah"])
    expect(first).toBe("- LDO 3V3 terpisah\n")
    expect(appendMemory(first ?? "", ["ldo 3v3  terpisah"])).toBeNull()
    expect(appendMemory(first ?? "", ["Relay 24V"])).toBe("- LDO 3V3 terpisah\n- Relay 24V\n")
    expect(() => appendMemory("x".repeat(MAX_MEMORY_CHARS), ["baru"])).toThrow(/Memori penuh/)
  })
})
