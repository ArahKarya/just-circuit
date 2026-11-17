// Reads the text of a PDF in a worker thread, so a heavy or hostile PDF can't stall the server:
// the parent gives it a memory cap and kills it after a timeout.
import { parentPort, workerData } from "node:worker_threads"
import { getDocumentProxy } from "unpdf"

const { bytes, maxPages, maxChars } = workerData

async function pageText(pdf, number) {
  const page = await pdf.getPage(number)
  try {
    const content = await page.getTextContent()
    return content.items
      .filter((item) => item.str != null)
      .map((item) => item.str + (item.hasEOL ? "\n" : ""))
      .join("")
  } finally {
    page.cleanup()
  }
}

async function main() {
  let pdf
  try {
    pdf = await getDocumentProxy(bytes, { verbosity: 0 })
  } catch (error) {
    const locked = error?.name === "PasswordException" || /password/i.test(String(error?.message))
    return { error: locked ? "password" : "broken" }
  }
  try {
    const pages = pdf.numPages
    const readPages = Math.min(pages, maxPages)
    let text = ""
    try {
      for (let number = 1; number <= readPages && text.length < maxChars; number += 1) {
        const body = (await pageText(pdf, number)).trim()
        if (body) text += `--- Halaman ${number} ---\n${body}\n\n`
      }
    } catch {
      // Odd encodings: keep what was read; models that read PDFs natively still get the file.
    }
    return { pages, readPages, text: text.slice(0, maxChars).trim() }
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined)
  }
}

parentPort.postMessage(await main())
