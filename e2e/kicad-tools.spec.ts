import { expect, test } from "./fixtures"

async function openCadTool(page: import("@playwright/test").Page, item: string) {
  await page.getByRole("button", { name: "Alat CAD" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

const code = (page: import("@playwright/test").Page) => page.locator(".monaco-editor")

test("board setup writes only the changed board props and keeps the build working", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await openCadTool(page, "Setup Board & Stackup")
  await expect(page.getByLabel("Lebar board")).toHaveValue("20mm")
  await page.getByLabel("Jumlah Layer").selectOption("4")
  await page.getByRole("button", { name: /Simpan ke <board>/ }).click()

  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(code(page)).toContainText(/width="20mm"\s+height="15mm"/)
  await expect(code(page)).toContainText("layers={4}")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
})

test("the PCB calculator accepts decimals and rejects impossible LED values", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await openCadTool(page, "Kalkulator PCB (IPC-2221)")
  const current = page.getByLabel("Arus (Ampere)")
  await current.fill("0.5")
  await expect(current).toHaveValue("0.5")
  await expect(page.getByText(/\d+(\.\d+)? mm \(\d+(\.\d+)? mil\)/)).toBeVisible()

  await page.getByRole("tab", { name: "Resistor LED" }).click()
  await page.getByLabel("Tegangan suplai Vs (V)").fill("3.3")
  await page.getByLabel("Tegangan maju LED Vf (V)").fill("3.4")
  await expect(page.getByText("Resistor E24 disarankan")).toHaveCount(0)
})

test("the property table edits a value and the traces stay connected", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await openCadTool(page, "Tabel Properti (Bulk Edit)")
  await page.getByLabel("Nilai R1").fill("1k")
  await page.getByRole("button", { name: /Simpan \(1\)/ }).click()
  await expect(page.getByRole("button", { name: /Simpan \(0\)/ })).toBeDisabled()
  await page.keyboard.press("Escape")

  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(code(page)).toContainText('resistance="1k"')
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  // Every trace still names parts that exist, so the build has no missing-port errors.
  await expect(code(page)).toContainText(/to="\.R1\s+>\s+\.\s*pin1"/)
})
