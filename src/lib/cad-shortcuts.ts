/** Keyboard routing shared by the schematic and PCB editors' window-level shortcuts. */

type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">

export type CadShortcut = { kind: "undo" } | { kind: "redo" } | { kind: "tool"; key: string } | { kind: "ignore" }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false
  const el = target as HTMLElement
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true
}

/**
 * Decides what a keydown means to a CAD editor. Typing in a field is never a shortcut, and
 * single-key tool shortcuts only fire without Ctrl/Cmd/Alt so browser keys such as Cmd+R
 * (reload), Cmd+L or Cmd+W keep working.
 */
export function classifyCadShortcut(event: ShortcutEvent): CadShortcut {
  if (isTypingTarget(event.target)) return { kind: "ignore" }
  const key = event.key.toLowerCase()
  const mod = event.metaKey || event.ctrlKey
  if (mod && !event.altKey && key === "z") return event.shiftKey ? { kind: "redo" } : { kind: "undo" }
  if (mod && !event.altKey && key === "y") return { kind: "redo" }
  if (mod || event.altKey) return { kind: "ignore" }
  return { kind: "tool", key }
}
