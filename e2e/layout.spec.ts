import { expect, test } from "./fixtures"

// The PCB viewer needs WebGPU; SwiftShader provides a software adapter in headless Chromium.
test.use({ launchOptions: { args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader"] } })

test("dragging a component in the layout editor moves it in the code", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Atur posisi" }).click()
  await expect(page.getByText(/Mode atur posisi/)).toBeVisible()
  await page.waitForTimeout(1500)

  // R1 sits at the centre of the starter board; drag it down.
  const viewer = page.locator(".absolute.inset-0.z-20 canvas").first()
  const box = await viewer.boundingBox()
  if (!box) throw new Error("PCB canvas not found")
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(start.x, start.y + i * 15)
  await page.mouse.up()

  await expect(page.getByText(/1 perpindahan tersimpan/)).toBeVisible()
  await page.getByRole("button", { name: "Selesai" }).click()

  // R1 already had pcbX in code, so the code is updated instead of manual-edits.json.
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toContainText(/pcbX=\{0\}\s+pcbY=\{-\d/)
  await expect(page.getByRole("tab", { name: /manual-edits\.json/ })).toHaveCount(0)
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await expect(page.getByText("Manual Edit Conflict")).toHaveCount(0)
  await page.screenshot({ path: "test-results/layout-final.png" })

  // Survives a reload (stored in IndexedDB).
  await page.reload()
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toContainText(/pcbY=\{-\d/)
})

test("components without pcbX/pcbY are saved to manual-edits.json", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toBeVisible()
  await page.evaluate(() => {
    const monaco = (window as unknown as { monaco: { editor: { getModels: () => { setValue: (v: string) => void }[] } } }).monaco
    monaco.editor.getModels()[0].setValue('export default () => (\n  <board width="20mm" height="15mm">\n    <resistor name="R1" resistance="1k" footprint="0805" />\n  </board>\n)\n')
  })
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)

  await page.getByRole("button", { name: "Atur posisi" }).click()
  await page.waitForTimeout(1500)
  const box = await page.locator(".absolute.inset-0.z-20 canvas").first().boundingBox()
  if (!box) throw new Error("PCB canvas not found")
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + i * 15, start.y)
  await page.mouse.up()
  await expect(page.getByText(/1 perpindahan tersimpan/)).toBeVisible()
  await page.getByRole("button", { name: "Selesai" }).click()

  await expect(page.locator(".monaco-editor")).toContainText("manualEdits={manualEdits}")
  await page.getByRole("tab", { name: /manual-edits\.json/ }).click()
  await expect(page.locator(".monaco-editor")).toContainText("pcb_placements")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await expect(page.getByText("Manual Edit Conflict")).toHaveCount(0)
  await page.screenshot({ path: "test-results/layout-manual.png" })
})
