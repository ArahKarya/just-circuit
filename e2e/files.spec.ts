import { expect, test } from "./fixtures"

test("creates, renames and deletes files in folders, and searches across files", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: "Kode" }).click()
  const tree = page.getByRole("list", { name: "File proyek" })

  await page.getByRole("button", { name: "File baru" }).click()
  await page.getByLabel("Nama file baru").fill("lib/power-supply.tsx")
  await page.getByLabel("Nama file baru").press("Enter")
  await expect(tree.getByRole("button", { name: "lib", exact: true })).toBeVisible()
  await expect(tree.getByRole("button", { name: "power-supply.tsx", exact: true })).toHaveAttribute("aria-current", "true")
  await expect(page.locator(".monaco-editor")).toContainText("export const PowerSupply")

  // Invalid names are refused with a reason.
  await page.getByRole("button", { name: "File baru" }).click()
  await page.getByLabel("Nama file baru").fill("../keluar.tsx")
  await page.getByLabel("Nama file baru").press("Enter")
  await expect(page.getByText(/Nama file tidak valid/)).toBeVisible()
  await page.getByLabel("Nama file baru").press("Escape")

  // Rename the folder: every file inside moves.
  await tree.getByRole("button", { name: "lib", exact: true }).hover()
  await page.getByRole("button", { name: "Ganti nama lib" }).click()
  await page.getByLabel("Nama baru untuk lib").fill("modules")
  await page.getByLabel("Nama baru untuk lib").press("Enter")
  await expect(tree.getByRole("button", { name: "modules", exact: true })).toBeVisible()
  await expect(tree.getByRole("button", { name: "lib", exact: true })).toHaveCount(0)

  // Search finds text in every file and opens the hit.
  await page.getByRole("button", { name: "Cari di semua file" }).click()
  await page.getByLabel("Teks yang dicari").fill("resistance")
  const hits = page.getByRole("list", { name: "Hasil pencarian" }).getByRole("button")
  await expect(hits).toHaveCount(1)
  await expect(hits.first()).toContainText("index.circuit.tsx:4")
  await hits.first().click()
  await expect(page.locator(".monaco-editor")).toContainText('resistance="330"')

  // Delete the new file; the files survive a reload otherwise.
  await page.getByRole("button", { name: "File", exact: true }).click()
  await tree.getByRole("button", { name: "power-supply.tsx", exact: true }).hover()
  await page.getByRole("button", { name: "Hapus modules/power-supply.tsx" }).click()
  await tree.getByRole("button", { name: "Hapus", exact: true }).click()
  await expect(tree.getByRole("button", { name: "modules", exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.getByRole("list", { name: "File proyek" }).getByRole("button")).toHaveCount(1)
})
