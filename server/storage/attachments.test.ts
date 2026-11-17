import { mkdir, mkdtemp, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanFileName, kindFromName } from "../../shared/attachments"
import { makePdf, TINY_PNG } from "../test-fixtures/make-pdf"
import { createAttachmentStore, decodeText, MAX_PROJECT_ATTACHMENTS, readPdfText, sniffImage, type AttachmentStore } from "./attachments"
import { NotFoundError, ValidationError } from "./errors"
import { createProjectStore, type ProjectStore } from "./projects"

const ENTRY = "index.circuit.tsx"
let dataDir: string
let projects: ProjectStore
let store: AttachmentStore
let projectId: string

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-attach-"))
  projects = createProjectStore(dataDir)
  store = createAttachmentStore(projects)
  projectId = (await projects.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })).id
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

const attachmentsDir = async () => path.join(await projects.pathOf(projectId), ".cds", "attachments")

describe("attachment rules", () => {
  it("knows which files can be sent", () => {
    expect(kindFromName("skema.PNG")).toBe("image")
    expect(kindFromName("datasheet.pdf")).toBe("pdf")
    expect(kindFromName("board.kicad_sch")).toBe("text")
    expect(kindFromName("netlist.net")).toBe("text")
    expect(kindFromName("program.exe")).toBeNull()
    expect(kindFromName("noext")).toBeNull()
  })

  it("cleans names from folders and control characters", () => {
    expect(cleanFileName("../../etc/passwd.txt")).toBe("passwd.txt")
    expect(cleanFileName("C:\\Users\\a\\skema\u0007.png")).toBe("skema.png")
    expect(cleanFileName(`${"a".repeat(200)}.pdf`)).toHaveLength(120)
    expect(cleanFileName(`${"a".repeat(200)}.pdf`).endsWith(".pdf")).toBe(true)
    expect(cleanFileName("")).toBe("lampiran")
    // A right-to-left override would show "skema\u202Efdp.exe" as "skemaexe.pdf".
    expect(cleanFileName("skema\u202Egnp.txt")).toBe("skemagnp.txt")
    expect(cleanFileName("a\u2028b.txt")).toBe("ab.txt")
  })

  it("sniffs images from their bytes and rejects binary text", () => {
    expect(sniffImage(TINY_PNG)).toBe("image/png")
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffImage(Buffer.from("GIF89a...."))).toBe("image/gif")
    expect(sniffImage(Buffer.from("<svg></svg>"))).toBeNull()
    expect(decodeText(Buffer.from("\uFEFFR1 1k"))).toBe("R1 1k")
    expect(decodeText(Buffer.from([0x00, 0x01]))).toBeNull()
    expect(decodeText(Buffer.from([0xc3, 0x28]))).toBeNull()
  })
})

describe("attachment store", () => {
  it("stores an image with the type found in its bytes", async () => {
    const meta = await store.add(projectId, "foto.jpg", TINY_PNG)
    expect(meta).toMatchObject({ name: "foto.jpg", kind: "image", mediaType: "image/png", size: TINY_PNG.length })
    const stored = await store.get(projectId, meta.id)
    expect(stored.bytes.equals(TINY_PNG)).toBe(true)
    expect(await store.text(projectId, meta.id)).toBe("")
  })

  it("rejects files that are not what their name says", async () => {
    await expect(store.add(projectId, "skema.png", Buffer.from("not an image"))).rejects.toBeInstanceOf(ValidationError)
    await expect(store.add(projectId, "data.pdf", Buffer.from("hello"))).rejects.toBeInstanceOf(ValidationError)
    await expect(store.add(projectId, "notes.txt", Buffer.from([0, 1, 2]))).rejects.toBeInstanceOf(ValidationError)
    await expect(store.add(projectId, "virus.exe", Buffer.from("MZ"))).rejects.toThrow(/tidak didukung/)
    await expect(store.add(projectId, "kosong.txt", Buffer.alloc(0))).rejects.toThrow(/kosong/)
    await expect(store.add(projectId, "besar.txt", Buffer.alloc(3 * 1024 * 1024, 0x61))).rejects.toThrow(/terlalu besar/)
  })

  it("reads the text of each PDF page", async () => {
    const meta = await store.add(projectId, "ne555.pdf", makePdf(["NE555 pinout: 1 GND 8 VCC", "Typical application astable"]))
    expect(meta).toMatchObject({ kind: "pdf", mediaType: "application/pdf", pages: 2 })
    expect(meta.textChars).toBeGreaterThan(20)
    const text = await store.text(projectId, meta.id)
    expect(text).toContain("--- Halaman 1 ---\nNE555 pinout: 1 GND 8 VCC")
    expect(text).toContain("--- Halaman 2 ---\nTypical application astable")
  })

  it("gives up on a PDF that takes too long", async () => {
    await expect(readPdfText(makePdf(["a"]), 1)).rejects.toThrow(/terlalu lama/)
    // The queue keeps working after a timeout.
    expect((await readPdfText(makePdf(["b"]))).pages).toBe(1)
  })

  it("rejects a broken PDF", async () => {
    await expect(store.add(projectId, "rusak.pdf", Buffer.from("%PDF-1.4\ngarbage"))).rejects.toThrow(/PDF/)
  })

  it("keeps text files as they are", async () => {
    const meta = await store.add(projectId, "netlist.net", Buffer.from("(net R1 1)"))
    expect(meta).toMatchObject({ kind: "text", mediaType: "text/plain" })
    expect(await store.text(projectId, meta.id)).toBe("(net R1 1)")
  })

  it("never serves ids that are not attachment ids", async () => {
    await expect(store.get(projectId, "../project")).rejects.toBeInstanceOf(NotFoundError)
    await expect(store.get(projectId, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError)
    await expect(store.get("nope", "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("removes unsent uploads but keeps attachments of sent messages", async () => {
    const sent = await store.add(projectId, "a.png", TINY_PNG)
    const unsent = await store.add(projectId, "b.png", TINY_PNG)
    await projects.changeMessages(projectId, () => [{ id: "m1", projectId, role: "user", content: "lihat", createdAt: 1, attachments: [sent] }])
    await expect(store.remove(projectId, sent.id)).rejects.toBeInstanceOf(ValidationError)
    await store.remove(projectId, unsent.id)
    await expect(store.get(projectId, unsent.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await store.get(projectId, sent.id)).meta.name).toBe("a.png")
  })

  it("purges old uploads that never reached a message", async () => {
    const sent = await store.add(projectId, "a.png", TINY_PNG)
    const fresh = await store.add(projectId, "b.png", TINY_PNG)
    await projects.changeMessages(projectId, () => [{ id: "m1", projectId, role: "user", content: "x", createdAt: 1, attachments: [sent] }])
    expect(await store.purgeOrphans(projectId)).toBe(0)
    expect(await store.purgeOrphans(projectId, Date.now() + 25 * 60 * 60 * 1000)).toBe(1)
    await expect(store.get(projectId, fresh.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await store.get(projectId, sent.id)).meta.id).toBe(sent.id)
  })

  it("clears every attachment with the chat", async () => {
    await store.add(projectId, "a.png", TINY_PNG)
    await store.clear(projectId)
    await expect(readdir(await attachmentsDir())).rejects.toThrow()
  })

  it("refuses an attachments folder that is not a real folder", async () => {
    await writeFile(await attachmentsDir(), "x")
    await expect(store.add(projectId, "a.png", TINY_PNG)).rejects.toThrow(/bukan folder/)
  })

  it("refuses a .cds folder that is a symlink to somewhere else", async () => {
    const projectDir = await projects.pathOf(projectId)
    const elsewhere = path.join(dataDir, "elsewhere")
    await rename(path.join(projectDir, ".cds"), elsewhere)
    await symlink(elsewhere, path.join(projectDir, ".cds"))
    await expect(store.add(projectId, "a.png", TINY_PNG)).rejects.toThrow()
    await expect(store.clear(projectId)).rejects.toThrow()
    await expect(readdir(path.join(elsewhere, "attachments"))).rejects.toThrow()
  })

  it("stops accepting files when the project is full", async () => {
    const dir = await attachmentsDir()
    await mkdir(dir)
    for (let index = 0; index < MAX_PROJECT_ATTACHMENTS; index += 1) await writeFile(path.join(dir, `${crypto.randomUUID()}.bin`), "x")
    await expect(store.add(projectId, "a.png", TINY_PNG)).rejects.toThrow(/sudah penuh/)
  })

  it("describes message attachments from what is stored, dropping unknown ids", async () => {
    const meta = await store.add(projectId, "a.png", TINY_PNG)
    const refs = await store.refsFor(projectId, [meta.id, meta.id, "00000000-0000-0000-0000-000000000000"])
    expect(refs).toEqual([{ id: meta.id, name: "a.png", kind: "image", mediaType: "image/png", size: TINY_PNG.length }])
  })

  it("cleans up leftovers of uploads that failed half-way", async () => {
    const dir = await attachmentsDir()
    await mkdir(dir)
    const leftover = path.join(dir, `${crypto.randomUUID()}.bin`)
    await writeFile(leftover, "x")
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(leftover, old, old)
    expect(await store.purgeOrphans(projectId)).toBe(1)
    expect(await readdir(dir)).toEqual([])
  })
})
