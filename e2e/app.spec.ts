import { expect, test } from "@playwright/test"

test("renders the starter project", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("330Ω", { exact: true })).toBeVisible()
})

test("configures an AI connection, generates a circuit and auto-fixes a failed build", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Pengaturan AI" }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByRole("button", { name: "Ambil model" }).click()
  await expect(page.getByText("2 model ditemukan")).toBeVisible()
  await page.getByLabel("Model").fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()

  await page.getByLabel("Pesan untuk AI").fill("Buat LED biru")
  await page.getByLabel("Pesan untuk AI").press("Enter")

  // First reply builds with an error, the app sends the error back, the second reply fixes it.
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Ini rangkaian LED.")).toBeVisible()
  await expect(page.getByText(/gagal di-build/)).toBeVisible()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("220Ω", { exact: true })).toBeVisible()

  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toContainText('color="blue"')
})
