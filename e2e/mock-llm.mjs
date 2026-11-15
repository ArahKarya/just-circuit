// Minimal OpenAI-compatible server used by the E2E tests.
// The first reply contains code that throws, so the app's auto-fix loop runs;
// the reply to the fix request contains working code.
import { createServer } from "node:http"

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9911)

const BROKEN = "Ini rangkaian LED.\n```tsx file=index.circuit.tsx\nexport default () => {\n  throw new Error(\"komponen salah\")\n}\n```"
const FIXED = [
  "Sudah diperbaiki: LED biru dengan resistor 220Ω.",
  "```tsx file=index.circuit.tsx",
  "export default () => (",
  "  <board width=\"20mm\" height=\"12mm\">",
  "    <resistor name=\"R1\" resistance=\"220\" footprint=\"0603\" pcbX={-3} />",
  "    <led name=\"D1\" color=\"blue\" footprint=\"0603\" pcbX={3} />",
  "    <trace from=\".R1 > .pin2\" to=\".D1 > .anode\" />",
  "  </board>",
  ")",
  "```",
].join("\n")

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data ? JSON.parse(data) : {}))
  })
}

function chunk(content) {
  return `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-1" }, { id: "mock-2" }] }))
    return
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    const body = await readBody(req)
    const last = body.messages?.at(-1)?.content ?? ""
    const reply = last.includes("gagal di-build") ? FIXED : BROKEN
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    for (let i = 0; i < reply.length; i += 40) res.write(chunk(reply.slice(i, i + 40)))
    res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
    res.end("data: [DONE]\n\n")
    return
  }
  res.writeHead(404).end()
}).listen(PORT)
