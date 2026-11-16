import JSZip from "jszip"
import { expect, test, type Page } from "./fixtures"

async function openProjects(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Proyek pertama|PLC|Relay|Amplifier/ }).first().click()
  await expect(page.getByRole("dialog", { name: "Proyek" })).toBeVisible()
}

test("creates a workspace and a project from the Pico template, moves it, trashes and restores it", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await openProjects(page)

  await page.getByRole("button", { name: "Workspace baru" }).click()
  await page.getByLabel("Nama workspace baru").fill("PLC")
  await page.getByRole("button", { name: "Simpan workspace" }).click()
  await expect(page.getByRole("button", { name: /^PLC\s*0$/ })).toHaveAttribute("aria-current", "true")

  await page.getByLabel("Proyek baru").fill("PLC Pico")
  await page.getByLabel("Template").selectOption("pico")
  await page.getByRole("button", { name: "Buat", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("button", { name: "PLC Pico" })).toBeVisible()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 90_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("SC0915").first()).toBeVisible()

  // Move it back to the default workspace.
  await page.getByRole("button", { name: "PLC Pico" }).click()
  await page.getByRole("button", { name: "Pindah workspace" }).click()
  await page.getByLabel("Pindah ke workspace").selectOption({ label: "Umum" })
  await page.getByRole("button", { name: "Pindah", exact: true }).click()
  await expect(page.getByText("Belum ada proyek di workspace ini.")).toBeVisible()
  await page.getByRole("button", { name: /^Umum\s*2$/ }).click()

  // Trash and restore.
  const row = page.getByRole("listitem").filter({ hasText: "PLC Pico" })
  await row.getByRole("button", { name: "Hapus" }).click()
  await row.getByRole("button", { name: "Hapus" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "PLC Pico" })).toHaveCount(0)
  await page.getByRole("tab", { name: "Tempat sampah" }).click()
  await page.getByRole("listitem").filter({ hasText: "PLC Pico" }).getByRole("button", { name: "Pulihkan" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("button", { name: "PLC Pico" })).toBeVisible()
})

test("imports a tsci project from a ZIP file", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  const zip = new JSZip()
  zip.file("amp/package.json", JSON.stringify({ name: "Amplifier", main: "index.circuit.tsx" }))
  zip.file("amp/index.circuit.tsx", 'import { Bias } from "./lib/bias"\nexport default () => (\n  <board width="20mm" height="15mm">\n    <Bias />\n  </board>\n)\n')
  zip.file("amp/lib/bias.tsx", 'export const Bias = () => <resistor name="R7" resistance="47k" footprint="0603" />\n')
  zip.file("amp/node_modules/evil/index.js", "process.exit(1)")
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }))

  await openProjects(page)
  await page.getByLabel("File ZIP proyek").setInputFiles({ name: "amp.zip", mimeType: "application/zip", buffer })
  await expect(page.getByText(/Amplifier diimpor, 2 file \(1 file dilewati/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "Amplifier" })).toBeVisible()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("47kΩ", { exact: true })).toBeVisible()
})
