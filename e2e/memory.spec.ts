import { expect, test } from "./fixtures"

test("the AI saves notes to project and global memory, which are sent with later requests", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()

  await page.getByLabel("Pesan untuk AI").fill("REMEMBER keputusan LDO")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("AI mencatat 2 hal ke memori")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("[memori diperbarui]").first()).toBeVisible()

  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByRole("tab", { name: "Memori" }).click()
  await expect(page.getByLabel(/^Memori proyek/)).toHaveValue("- LDO 3V3 terpisah (AP2112K)\n")
  await expect(page.getByLabel("Memori global (semua proyek)")).toHaveValue("- Pakai part JLCPCB basic\n")
  await page.getByRole("button", { name: "Batal" }).click()

  await page.getByLabel("Pesan untuk AI").fill("ECHO-MEMORY")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Memori proyek: ada, memori global: ada")).toBeVisible({ timeout: 30_000 })
})
