import { makePdf, TINY_PNG } from "../server/test-fixtures/make-pdf"
import { expect, test, type Page } from "./fixtures"

async function addMockConnection(page: Page) {
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()
}

const draftList = (page: Page) => page.getByRole("list", { name: "Lampiran" })

test("attached images, PDFs and text files reach the AI and stay in the chat history", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await addMockConnection(page)

  await page.getByTestId("chat-file-input").setInputFiles([
    { name: "skema.png", mimeType: "image/png", buffer: TINY_PNG },
    { name: "catatan.txt", mimeType: "text/plain", buffer: Buffer.from("R1 = 4k7 pull-up") },
    { name: "ne555.pdf", mimeType: "application/pdf", buffer: makePdf(["NE555 pinout 1 GND 8 VCC"]) },
  ])
  await expect(draftList(page).getByRole("listitem")).toHaveCount(3)
  await expect(page.getByLabel("Mengunggah")).toHaveCount(0)

  await page.getByLabel("Pesan untuk AI").fill("ECHO-ATTACH")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Gambar: 1.")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Terbaca: R1 = 4k7, NE555 pinout/)).toBeVisible()
  await expect(page.getByText(/\[Lampiran: ne555\.pdf, 1 halaman, teks hasil ekstraksi\]/)).toBeVisible()
  await expect(draftList(page)).toBeHidden()

  // The message shows its attachments, served from the project.
  const thumbnail = page.getByRole("img", { name: "skema.png" })
  await expect(thumbnail).toBeVisible()
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await expect(page.getByRole("link", { name: /catatan\.txt/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /ne555\.pdf.*1 hlm/ })).toBeVisible()

  // Later questions still carry earlier attachments, also after a reload.
  await page.reload()
  await expect(page.getByRole("img", { name: "skema.png" })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel("Pesan untuk AI").fill("ECHO-ATTACH lagi")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Gambar: 1.")).toHaveCount(2, { timeout: 30_000 })

  // Clearing the chat deletes the files too.
  const imageUrl = await page.getByRole("img", { name: "skema.png" }).getAttribute("src")
  await page.getByRole("button", { name: "Hapus riwayat chat" }).click()
  await expect(page.getByRole("img", { name: "skema.png" })).toHaveCount(0)
  expect((await page.request.get(imageUrl ?? "")).status()).toBe(404)
})

test("files can be pasted, dropped, removed, and unsupported ones are refused", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByTestId("chat-file-input").setInputFiles([{ name: "program.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }])
  await expect(page.getByText(/"program\.exe" tidak didukung/)).toBeVisible()

  // A screenshot pasted into the message box.
  const png = TINY_PNG.toString("base64")
  await page.getByLabel("Pesan untuk AI").evaluate((box, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }))
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, png)
  await expect(draftList(page).getByText(/^tempel-\d{6}\.png$/)).toBeVisible()

  // A file dropped on the chat panel.
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(["(net GND)"], "board.net", { type: "text/plain" }))
    return data
  })
  const box = page.getByLabel("Pesan untuk AI")
  await box.dispatchEvent("dragenter", { dataTransfer: transfer })
  await expect(page.getByText("Lepas untuk melampirkan")).toBeVisible()
  await box.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.getByText("Lepas untuk melampirkan")).toBeHidden()
  await expect(draftList(page).getByRole("listitem")).toHaveCount(2)
  await expect(page.getByLabel("Mengunggah")).toHaveCount(0)

  await page.getByRole("button", { name: "Hapus lampiran board.net" }).click()
  await expect(draftList(page).getByRole("listitem")).toHaveCount(1)
})
