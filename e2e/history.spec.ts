import { expect, test } from "./fixtures"

test("records AI changes as versions, shows their diff and restores an earlier version", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()

  await page.getByLabel("Pesan untuk AI").fill("Buat LED biru")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Riwayat", exact: true }).click()
  const list = page.getByRole("list", { name: "Daftar versi" })
  await expect(list.getByRole("button")).toHaveCount(3)
  await expect(list.getByRole("button").nth(0)).toContainText("AI: perbaiki error")
  await expect(list.getByRole("button").nth(1)).toContainText("AI: Buat LED biru")
  await expect(list.getByRole("button").nth(2)).toContainText("Riwayat dimulai")
  // The newest version's diff shows the fixed code replacing the broken one.
  await expect(page.getByText('+    <led name="D1" color="blue" footprint="0603" pcbX={3} />')).toBeVisible()

  await list.getByRole("button").nth(2).click()
  await page.getByRole("button", { name: "Kembalikan ke versi ini" }).click()
  await page.getByRole("button", { name: "Kembalikan", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("330Ω", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Riwayat", exact: true }).click()
  await expect(list.getByRole("button").nth(0)).toContainText(/Kembali ke versi [0-9a-f]+: Riwayat dimulai/)
})

test("saves a named version of hand edits", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: "Kode" }).click()
  await page.locator(".monaco-editor").click()
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type("\n// catatan manual\n")
  await page.getByRole("button", { name: "Riwayat", exact: true }).click()
  await page.getByLabel("Keterangan versi").fill("Tambah catatan")
  await page.getByRole("button", { name: "Simpan versi" }).click()
  await expect(page.getByText("Versi disimpan")).toBeVisible()
  const first = page.getByRole("list", { name: "Daftar versi" }).getByRole("button").first()
  await expect(first).toContainText("Tambah catatan")
  await expect(page.getByText("+// catatan manual")).toBeVisible()
})
