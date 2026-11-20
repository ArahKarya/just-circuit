import { describe, expect, it } from "vitest"
import { classifyCadShortcut } from "./cad-shortcuts"

const ev = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}, target: unknown = null) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
  target: target as EventTarget | null,
})

describe("classifyCadShortcut", () => {
  it("maps Cmd/Ctrl+Z, Shift+Z and Ctrl+Y to undo and redo", () => {
    expect(classifyCadShortcut(ev("z", { metaKey: true }))).toEqual({ kind: "undo" })
    expect(classifyCadShortcut(ev("Z", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "redo" })
    expect(classifyCadShortcut(ev("y", { ctrlKey: true }))).toEqual({ kind: "redo" })
  })

  it("leaves browser shortcuts like Cmd+R, Ctrl+L and Cmd+W alone", () => {
    for (const key of ["r", "l", "w", "a", "Backspace"]) {
      expect(classifyCadShortcut(ev(key, { metaKey: true })).kind).toBe("ignore")
      expect(classifyCadShortcut(ev(key, { ctrlKey: true })).kind).toBe("ignore")
    }
    expect(classifyCadShortcut(ev("r", { altKey: true })).kind).toBe("ignore")
  })

  it("passes plain keys through as tool shortcuts", () => {
    expect(classifyCadShortcut(ev("R"))).toEqual({ kind: "tool", key: "r" })
    expect(classifyCadShortcut(ev("Delete"))).toEqual({ kind: "tool", key: "delete" })
  })

  it("ignores keys typed into fields and editable content", () => {
    expect(classifyCadShortcut(ev("r", {}, { tagName: "INPUT" })).kind).toBe("ignore")
    expect(classifyCadShortcut(ev("z", { metaKey: true }, { tagName: "TEXTAREA" })).kind).toBe("ignore")
    expect(classifyCadShortcut(ev("r", {}, { tagName: "DIV", isContentEditable: true })).kind).toBe("ignore")
  })
})
