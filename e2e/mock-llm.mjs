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

// "AGENT-BUG": reads a part catalog, reports an app bug, then asks to remember a lesson.
const AGENT_BUG_SCRIPT = [
  { name: "search_parts", args: { query: "W5500" } },
  { name: "report_app_bug", args: { title: "build_circuit mengembalikan hasil kosong", details: "Kode valid tapi build_circuit tidak memberi errors maupun warnings." } },
]
const AGENT_BUG_SUMMARY = "Selesai, bug aplikasi sudah dilaporkan.\n\n```memory scope=global\n- Pelajaran: W5500 butuh kristal 25MHz (datasheet hal. 9)\n```"

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

/** A small valid one-page PDF (datasheet download in the part search tests). */
function pdfWith(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n"
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

/** Stand-ins for the tscircuit part services ("/parts/<source>/…"). */
function partsReply(url) {
  const q = (url.searchParams.get("q") ?? "").toUpperCase()
  const path = url.pathname.replace(/^\/parts/, "")
  if (path === "/ti/api/search") {
    return { components: q.includes("ADS8688") ? [{ mfr: "ADS8688IDBT", ti_product_number: "ADS8688IDBT", package: "38-TSSOP", description: "16-bit 8-channel SAR ADC", stock: 4103, price: 21.9, datasheet_url: "http://localhost:9911/parts/datasheet.pdf" }] : [] }
  }
  if (path === "/digikey/api/search") {
    return { components: q.includes("W5500") ? [{ mfr: "W5500", manufacturer: "WIZnet", digikey_product_number: "1278-1021-ND", package: "48-LQFP", stock: 900, price: 4.2 }] : [] }
  }
  if (path === "/mouser/api/search" || path === "/jlcpcb/api/search") return { components: [] }
  if (path === "/registry/packages/search") return { packages: [] }
  if (path === "/registry/datasheets/list") return { datasheets: [{ datasheet_id: "ds-w5500", chip_name: "W5500" }] }
  if (path === "/registry/datasheets/get") {
    if (url.searchParams.get("chip_name") !== "w5500") return null
    return {
      datasheet: {
        chip_name: "W5500",
        manufacturer_part_number: "W5500",
        ai_description: "Ethernet controller",
        footprinter_string: "soic8",
        pin_information: [
          { name: ["VDD"], pin_number: "1" },
          { name: ["GND"], pin_number: "2" },
          { name: ["GND"], pin_number: "3" },
          { name: ["SCLK"], pin_number: "4" },
        ],
        pin_attributes: { pin1: { requiresPower: true } },
        datasheet_pdf_urls: ["https://example.com/w5500.pdf"],
      },
    }
  }
  if (path === "/kicad/kicad_files.json") {
    return ["Package_SO.pretty/HTSSOP-38-1EP_4.4x9.7mm_P0.5mm_EP1.5x3.3mm.kicad_mod", "Package_SO.pretty/TSSOP-38_4.4x9.7mm_P0.5mm.kicad_mod", "Package_QFP.pretty/LQFP-48_7x7mm_P0.5mm.kicad_mod"]
  }
  return undefined
}

createServer(async (req, res) => {
  if (req.url?.startsWith("/parts/")) {
    const url = new URL(req.url, "http://localhost")
    if (url.pathname === "/parts/datasheet.pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" })
      res.end(pdfWith("ADS8688 pin 1 AUX_IN"))
      return
    }
    const body = partsReply(url)
    res.writeHead(body === undefined ? 404 : body === null ? 404 : 200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body ?? { error: "not found" }))
    return
  }
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
    // "AGENT-SLOW": the tool input arrives in small pieces for longer than the idle timeout.
    if (body.tools && firstUser.includes("AGENT-SLOW")) {
      if (body.messages.some((m) => m.role === "tool")) {
        res.write(chunk("Selesai menulis catatan panjang."))
        res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
        res.end("data: [DONE]\n\n")
        return
      }
      const args = JSON.stringify({ path: "lib/catatan.md", content: "Catatan desain. ".repeat(200) })
      const toolChunk = (delta) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: { tool_calls: [delta] }, finish_reason: null }] })}\n\n`
      // Some text first (as real models do), so the idle timer is past its first-chunk phase.
      res.write(chunk("Saya tulis catatannya. "))
      res.write(toolChunk({ index: 0, id: "call_slow", type: "function", function: { name: "write_file", arguments: "" } }))
      const pieces = 14
      const size = Math.ceil(args.length / pieces)
      for (let i = 0; i < pieces; i++) {
        await sleep(1000)
        res.write(toolChunk({ index: 0, function: { arguments: args.slice(i * size, (i + 1) * size) } }))
      }
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`)
      res.end("data: [DONE]\n\n")
      return
    }
    if (body.tools && firstUser.includes("AGENT-BUG")) {
      const done = body.messages.filter((m) => m.role === "tool").length
      if (done < AGENT_BUG_SCRIPT.length) {
        writeToolCall(res, AGENT_BUG_SCRIPT[done], done)
        return
      }
      for (let i = 0; i < AGENT_BUG_SUMMARY.length; i += 40) res.write(chunk(AGENT_BUG_SUMMARY.slice(i, i + 40)))
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
      res.end("data: [DONE]\n\n")
      return
    }
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
