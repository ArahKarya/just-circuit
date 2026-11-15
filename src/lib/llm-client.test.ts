import { afterEach, describe, expect, it, vi } from "vitest"
import { streamChat } from "./llm-client"
import type { Connection } from "./types"

const connection: Connection = { id: "c", name: "t", kind: "openai-compatible", baseUrl: "http://x/v1", apiKey: "", model: "m" }

function mockStream(lines: string[]) {
  const body = new ReadableStream({
    start(controller) {
      lines.forEach((line) => controller.enqueue(new TextEncoder().encode(line)))
      controller.close()
    },
  })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })))
}

function request(onText = vi.fn()) {
  return { connection, system: "s", messages: [{ role: "user" as const, content: "hi" }], temperature: 0, maxOutputTokens: 1000, onText }
}

afterEach(() => vi.unstubAllGlobals())

describe("streamChat", () => {
  it("joins text split across chunk boundaries", async () => {
    mockStream(['{"type":"text","text":"Hal', 'o"}\n{"type":"text","text":" dunia"}\n', '{"type":"done","finishReason":"stop"}\n'])
    const onText = vi.fn()
    await expect(streamChat(request(onText))).resolves.toEqual({ text: "Halo dunia", truncated: false })
    expect(onText).toHaveBeenCalledTimes(2)
  })

  it("flags replies cut off by the token limit", async () => {
    mockStream(['{"type":"text","text":"a"}\n{"type":"done","finishReason":"length"}'])
    await expect(streamChat(request())).resolves.toEqual({ text: "a", truncated: true })
  })

  it("rejects a stream that ends without a done event", async () => {
    mockStream(['{"type":"text","text":"```tsx\\nexport default 1\\n```"}\n'])
    await expect(streamChat(request())).rejects.toThrow(/terputus/)
  })

  it("rejects on an error event", async () => {
    mockStream(['{"type":"error","message":"kuota habis"}\n'])
    await expect(streamChat(request())).rejects.toThrow("kuota habis")
  })

  it("surfaces the server's error message for non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, error: "Model wajib diisi" }, { status: 400 })))
    await expect(streamChat(request())).rejects.toThrow("Model wajib diisi")
  })
})
