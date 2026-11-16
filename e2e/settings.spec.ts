import { expect, test } from "./fixtures"

async function addMock(page: import("@playwright/test").Page, name: string, model: string): Promise<void> {
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Nama", { exact: true }).fill(name)
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill(model)
}

test("tests a connection, applies editor and theme preferences, and uses project rules", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await addMock(page, "Mock utama", "mock-1")
  await page.getByRole("button", { name: "Tes koneksi" }).click()
  await expect(page.getByRole("status").filter({ hasText: /Tersambung dalam/ })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("tab", { name: "Tampilan & editor" }).click()
  await page.getByLabel("Tema").selectOption("light")
  await page.getByLabel("Ukuran font").fill("18")
  await page.getByRole("tab", { name: "Proyek ini" }).click()
  await page.getByLabel("Aturan tambahan untuk AI").fill("ATURAN-KHUSUS: pakai part JLCPCB basic")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor .view-lines")).toHaveCSS("font-size", "18px")

  // Settings survive a reload (stored on the server).
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByRole("tab", { name: "Proyek ini" }).click()
  await expect(page.getByLabel("Aturan tambahan untuk AI")).toHaveValue("ATURAN-KHUSUS: pakai part JLCPCB basic")
  await page.getByRole("button", { name: "Batal" }).click()

  // The rules reach the model: the mock echoes them back when asked.
  await page.getByRole("tab", { name: "Chat AI" }).click()
  await page.getByLabel("Pesan untuk AI").fill("ECHO-RULES")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Aturan diterima: ATURAN-KHUSUS")).toBeVisible({ timeout: 30_000 })
})

test("uses a separate connection for automatic fixes", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await addMock(page, "Chat", "mock-1")
  await addMock(page, "Fixer", "mock-fixer")
  await page.getByLabel("Pakai Chat").check()
  await page.getByLabel("Model untuk auto-fix").selectOption({ label: "Fixer · mock-fixer" })
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()

  await page.getByLabel("Pesan untuk AI").fill("Buat LED biru")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  // The mock signs its fixed reply with the model that produced it.
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("(model: mock-fixer)")).toBeVisible()
})
