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

/** Text of a message whose content is a string or a list of parts (attachments). */
const textOf = (content) => (Array.isArray(content) ? content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : String(content ?? ""))

function describeAttachments(body) {
  const parts = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  const images = parts.filter((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image/")).length
  const labels = parts.filter((p) => p.type === "text" && p.text.startsWith("[Lampiran")).map((p) => p.text.split("\n")[0])
  const text = parts.filter((p) => p.type === "text").map((p) => p.text).join(" ")
  const found = ["R1 = 4k7", "NE555 pinout"].filter((needle) => text.includes(needle))
  return `Gambar: ${images}. Label: ${labels.join(" ")} Terbaca: ${found.join(", ") || "-"}`
}

function pickReply(last, body) {
  if (last.includes("ECHO-ATTACH")) return describeAttachments(body)
  if (last.includes("ECHO-CONTEXT")) {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? ""
    const problems = system.match(/## Problems in the last build \(from the preview, (\d+) total\)/)
    const scope = system.match(/switched off ([^.]+) for this project/)
    return `Konteks: masalah ${problems ? problems[1] : 0}, dimatikan: ${scope ? scope[1] : "-"}`
  }
  if (last.includes("ECHO-LIBRARY")) {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? ""
    const line = system.split("\n").find((l) => l.startsWith("- Relay modul"))
    return line ? `Library terlihat: ${line.slice(2)}` : "Library kosong"
  }
  if (last.includes("REMEMBER")) {
    return "Siap, saya catat.\n```memory\n- LDO 3V3 terpisah (AP2112K)\n```\n```memory scope=global\n- Pakai part JLCPCB basic\n```"
  }
  if (last.includes("ECHO-MEMORY")) {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? ""
    const project = system.includes("## Memory: this project") && system.includes("AP2112K")
    const global = system.includes("## Memory: about the user") && system.includes("JLCPCB basic")
    return `Memori proyek: ${project ? "ada" : "tidak"}, memori global: ${global ? "ada" : "tidak"}`
  }
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

// "AGENT": a scripted tool-using run, one tool per request, decided by how many tool results came back.
const AGENT_SCRIPT = [
  { name: "read_file", args: { path: "index.circuit.tsx" } },
  { name: "edit_file", args: { path: "index.circuit.tsx", search: 'resistance="330"', replace: 'resistance="1k"' } },
  { name: "build_circuit", args: {} },
  { name: "propose_command", args: { command: "echo PERINTAH-$((40+2))", reason: "contoh" } },
]

function writeToolCall(res, step, index) {
  const call = { index: 0, id: `call_${index}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }
  res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`)
  res.end("data: [DONE]\n\n")
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
    const last = textOf(body.messages?.at(-1)?.content)
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
    const firstUser = textOf(body.messages?.filter((m) => m.role === "user").at(-1)?.content)
    if (body.tools && firstUser.includes("AGENT")) {
      const done = body.messages.filter((m) => m.role === "tool").length
      if (done < AGENT_SCRIPT.length) {
        writeToolCall(res, AGENT_SCRIPT[done], done)
        return
      }
      const build = body.messages.filter((m) => m.role === "tool").map((m) => String(m.content)).find((c) => c.includes('"ok"') && c.includes("warnings")) ?? ""
      const summary = `Selesai: R1 diganti 1k. Build ${build.includes('"ok":true') ? "OK" : build.includes("dimatikan") ? "dicek preview" : "gagal"}.`
      for (let i = 0; i < summary.length; i += 40) res.write(chunk(summary.slice(i, i + 40)))
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
      res.end("data: [DONE]\n\n")
      return
    }
    const reply = pickReply(last, body)
    for (let i = 0; i < reply.length; i += 40) res.write(chunk(reply.slice(i, i + 40)))
    res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
    res.end("data: [DONE]\n\n")
    return
  }
  res.writeHead(404).end()
}).listen(PORT)
