import { describe, expect, it } from "vitest"
import { toTurns } from "./chat-history"
import type { ChatMessage } from "./types"

const message = (role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: crypto.randomUUID(),
  projectId: "p",
  role,
  content,
  createdAt: 0,
  ...extra,
})

describe("toTurns", () => {
  it("replaces code in assistant replies with markers but keeps user text", () => {
    const turns = toTurns([
      message("user", "buat LED\n```tsx\nmy code\n```"),
      message("assistant", "Ini LED.\n```tsx file=index.circuit.tsx\nexport default 1\n```"),
    ])
    expect(turns[0].content).toContain("my code")
    expect(turns[1].content).toBe("Ini LED.\n\n[kode: index.circuit.tsx]")
  })

  it("drops errors and keeps only the last messages", () => {
    const messages = [message("user", "a"), message("assistant", "gagal", { isError: true }), message("user", "b"), message("assistant", "c")]
    expect(toTurns(messages, 2).map((t) => t.content)).toEqual(["b", "c"])
  })

  it("never sends an empty assistant turn", () => {
    expect(toTurns([message("assistant", "```tsx file=a.tsx\nx\n```")])[0].content).toBe("[kode: a.tsx]")
  })
})
