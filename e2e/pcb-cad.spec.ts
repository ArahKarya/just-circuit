import { expect, test, type Page } from "./fixtures"

// Characterization tests for the SVG-based PCB CAD editor (starter LED project: J1, R1, D1 on a 20x15mm board).

const code = (page: Page) => page.locator(".monaco-editor")
const editor = (page: Page) => page.getByLabel("Editor PCB CAD")
const canvas = (page: Page) => page.getByLabel("Kanvas PCB CAD")

/** Reads the entrypoint source from the Monaco model; the rendered DOM wraps and reorders long lines. */
function source(page: Page) {
  return expect.poll(() =>
    page.evaluate(() => {
      const monaco = (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco
      return monaco.editor.getModels()[0].getValue()
    }),
  )
}

async function openPcbCad(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(code(page)).toBeVisible()
  await page.getByRole("button", { name: "PCB CAD" }).click()
  await expect(canvas(page)).toBeVisible()
  // Labels appear once the scene has been extracted from the circuit JSON.
  await expect(canvas(page).locator("text", { hasText: "R1" })).toBeVisible()
}

/** Clicks a canvas point given as a fraction of the canvas box (0.5, 0.5 is the board centre after fit). */
async function clickCanvas(page: Page, fx: number, fy: number) {
  const box = await canvas(page).boundingBox()
  if (!box) throw new Error("PCB CAD canvas not found")
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
}

async function clickComponent(page: Page, name: string, modifiers?: ("Alt" | "Shift")[]) {
  await canvas(page).locator("text", { hasText: name }).click({ modifiers })
}

async function pickTool(page: Page, title: string) {
  await editor(page).getByRole("group", { name: "Alat PCB" }).getByTitle(title, { exact: true }).click()
}

async function finishAndCheckBuild(page: Page) {
  await editor(page).getByRole("button", { name: "Selesai" }).click()
  await expect(canvas(page)).toHaveCount(0)
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
}

test("selecting a part opens the inspector, R rotates it and undo reverts the code", async ({ page }) => {
  await openPcbCad(page)
  await clickComponent(page, "R1")
  const inspector = page.getByLabel("Inspektor properti")
  await expect(inspector.getByText("R1", { exact: true })).toBeVisible()

  await page.keyboard.press("r")
  await source(page).toMatch(/name="R1"[^>]*pcbRotation=\{90\}/)

  await editor(page).getByRole("button", { name: "Undo (Ctrl+Z)" }).click()
  await source(page).not.toContain("pcbRotation")

  await inspector.getByRole("button", { name: "Tutup inspektor" }).click()
  await expect(inspector.getByText("R1", { exact: true })).toHaveCount(0)
  await finishAndCheckBuild(page)
})

test("routing a 45° copper trace, adding a via and a testpoint writes them into the board", async ({ page }) => {
  await openPcbCad(page)

  await page.keyboard.press("x")
  await expect(editor(page).getByTitle("Copper Trace 45° (X)", { exact: true })).toHaveAttribute("aria-pressed", "true")
  await clickCanvas(page, 0.4, 0.7)
  await clickCanvas(page, 0.6, 0.7)
  await expect(editor(page).getByRole("button", { name: /Simpan \(\d+(\.\d)?mm\)/ })).toBeVisible()
  await page.keyboard.press("Enter")
  await source(page).toMatch(/<pcbtrace\s/)
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await pickTool(page, "Via")
  await clickCanvas(page, 0.3, 0.3)
  await source(page).toMatch(/<via\s/)
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await pickTool(page, "Testpoint")
  await clickCanvas(page, 0.7, 0.3)
  await source(page).toMatch(/<testpoint\s+name="TP1"/)

  await page.keyboard.press("Escape")
  await expect(editor(page).getByTitle("Pilih (V)", { exact: true })).toHaveAttribute("aria-pressed", "true")
  await finishAndCheckBuild(page)
})

test("a manual trace can be selected and deleted", async ({ page }) => {
  await openPcbCad(page)
  await page.keyboard.press("x")
  await clickCanvas(page, 0.35, 0.75)
  await clickCanvas(page, 0.65, 0.75)
  await page.keyboard.press("Enter")
  await source(page).toMatch(/<pcbtrace\s/)
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.keyboard.press("Escape")
  // The new trace is the only 0.25 mm one; the autorouter uses 0.15 mm.
  await canvas(page).locator("polyline", { has: page.locator("title", { hasText: "0.25mm" }) }).dispatchEvent("pointerdown")
  await editor(page).getByRole("button", { name: "Hapus Trace" }).click()
  await source(page).not.toMatch(/<pcbtrace\s/)
  await finishAndCheckBuild(page)
})

test("copper pour zones can be added and removed from the zone manager", async ({ page }) => {
  await openPcbCad(page)
  await editor(page).getByRole("button", { name: /Zone \(0\)/ }).click()
  await expect(page.getByLabel("Net zone")).toHaveValue("GND")
  await page.getByLabel("Layer zone").selectOption("top")
  await editor(page).getByRole("button", { name: "Tambah Pour" }).click()
  await source(page).toMatch(/<copperpour\s+connectsTo="net\.GND"\s+layer="top"/)
  await expect(editor(page).getByRole("button", { name: /Zone \(1\)/ })).toBeVisible()

  await editor(page).getByText("GND (top)").getByRole("button", { name: "×" }).click()
  await source(page).not.toContain("<copperpour")
  await expect(editor(page).getByRole("button", { name: /Zone \(0\)/ })).toBeVisible()
  await finishAndCheckBuild(page)
})

test("the differential pair bar inserts a skew constraint", async ({ page }) => {
  await openPcbCad(page)
  await editor(page).getByRole("button", { name: "Diff-Pair" }).click()
  await page.getByLabel("Nama diff-pair").fill("CAN")
  await page.getByLabel("Trace positif").fill("CAN_H")
  await page.getByLabel("Trace negatif").fill("CAN_L")
  await editor(page).getByRole("button", { name: "Tambah <differentialpair>" }).click()
  await source(page).toMatch(/<differentialpair\s+name="CAN"\s+positiveConnection="CAN_H"\s+negativeConnection="CAN_L"/)
  await expect(page.getByLabel("Nama diff-pair")).toHaveCount(0)
})

test("multi-select aligns parts and the selection filter blocks part picking", async ({ page }) => {
  await openPcbCad(page)
  await clickComponent(page, "J1")
  await clickComponent(page, "D1", ["Alt"])
  await expect(editor(page).getByText("2 dipilih")).toBeVisible()
  await editor(page).getByRole("button", { name: "Ratakan atas" }).click()
  await source(page).toMatch(/name="J1"[^>]*pcbY=\{/)
  await source(page).toMatch(/name="D1"[^>]*pcbY=\{/)

  // Clicking empty board clears the selection.
  await clickCanvas(page, 0.5, 0.8)
  await expect(editor(page).getByText("2 dipilih")).toHaveCount(0)

  await editor(page).getByRole("checkbox", { name: "Part" }).uncheck()
  await clickComponent(page, "R1")
  await expect(page.getByLabel("Inspektor properti").getByText("R1", { exact: true })).toHaveCount(0)
  await editor(page).getByRole("checkbox", { name: "Part" }).check()
  await clickComponent(page, "R1")
  await expect(page.getByLabel("Inspektor properti").getByText("R1", { exact: true })).toBeVisible()
  await finishAndCheckBuild(page)
})

test("dragging a part on the canvas moves it in the code", async ({ page }) => {
  await openPcbCad(page)
  const label = await canvas(page).locator("text", { hasText: "R1" }).boundingBox()
  if (!label) throw new Error("R1 label not found")
  const start = { x: label.x + label.width / 2, y: label.y + label.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(start.x, start.y + i * 12)
  await page.mouse.up()
  await source(page).toMatch(/name="R1"[^>]*pcbX=\{0\}[^>]*pcbY=\{-\d/)
  await finishAndCheckBuild(page)
})
