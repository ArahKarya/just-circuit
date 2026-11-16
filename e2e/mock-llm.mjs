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

const editBlock = (search, replace) =>
  `\`\`\`tsx edit=index.circuit.tsx\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``
// "EDIT": first a SEARCH that doesn't match the file, then (after the app reports it) a correct one.
const BAD_EDIT = `Ganti resistor.\n${editBlock('resistance="999"', 'resistance="470"')}`
const GOOD_EDIT = `Resistor diganti 470Ω.\n${editBlock('    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} />', '    <resistor name="R1" resistance="470" footprint="0603" pcbX={0} />')}`

function pickReply(last, body) {
  if (last.includes("ECHO-RULES")) {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? ""
    const match = system.match(/ATURAN-KHUSUS[^\n]*/)
    return match ? `Aturan diterima: ${match[0]}` : "Tidak ada aturan proyek."
  }
  if (last.includes("gagal di-build")) return `${FIXED}\n\n(model: ${body.model})`
  if (last.includes("Sebagian edit tidak bisa")) return GOOD_EDIT
  if (last.includes("EDIT")) return BAD_EDIT
  return last.includes("gagal di-build") || last.includes("THINK") ? FIXED : BROKEN
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data ? JSON.parse(data) : {}))
  })
}

function chunk(content, field = "content") {
  return `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: { [field]: content }, finish_reason: null }] })}\n\n`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-1" }, { id: "mock-2" }] }))
    return
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    const body = await readBody(req)
    const last = body.messages?.at(-1)?.content ?? ""
    // Non-streaming requests (the "Tes koneksi" button) get a plain JSON completion.
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    // "HANG": send nothing after the headers, to exercise the idle timeout.
    if (last.includes("HANG")) return
    // "THINK": stream reasoning for a while before answering.
    if (last.includes("THINK")) {
      for (let i = 0; i < 6; i++) {
        res.write(chunk(`Langkah ${i + 1}: menghitung nilai resistor. `, "reasoning_content"))
        await sleep(500)
      }
    }
    const reply = pickReply(last, body)
    for (let i = 0; i < reply.length; i += 40) res.write(chunk(reply.slice(i, i + 40)))
    res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
    res.end("data: [DONE]\n\n")
    return
  }
  res.writeHead(404).end()
}).listen(PORT)
