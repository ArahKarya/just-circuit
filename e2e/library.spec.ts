import { expect, test } from "./fixtures"

test("saves a file to the library and inserts it into another project", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: "Kode" }).click()
  const tree = page.getByRole("list", { name: "File proyek" })

  await page.getByRole("button", { name: "File baru" }).click()
  await page.getByLabel("Nama file baru").fill("lib/relay.tsx")
  await page.getByLabel("Nama file baru").press("Enter")
  await expect(tree.getByRole("button", { name: "relay.tsx", exact: true })).toBeVisible()
  await tree.getByRole("button", { name: "relay.tsx", exact: true }).hover()
  await page.getByRole("button", { name: "Simpan lib/relay.tsx ke library" }).click()
  await page.getByLabel("Nama komponen").fill("Relay modul")
  await page.getByLabel("Keterangan").fill("Relay 24V + flyback diode")
  await page.getByRole("button", { name: "Simpan", exact: true }).click()
  await expect(page.getByText("Relay modul disimpan ke library")).toBeVisible()

  // New project, then insert from the library.
  await page.getByRole("button", { name: "Proyek pertama" }).click()
  await page.getByLabel("Proyek baru").fill("Proyek kedua")
  await page.getByRole("button", { name: "Buat", exact: true }).click()
  await expect(page.getByRole("button", { name: "Proyek kedua" })).toBeVisible()
  await page.getByRole("button", { name: "Library", exact: true }).click()
  const list = page.getByRole("list", { name: "Isi library" })
  await expect(list).toContainText("Relay 24V + flyback diode")
  await list.getByRole("button", { name: "Sisipkan" }).click()
  await expect(page.getByText(/Relay modul disisipkan, pakai <Relay \/>/)).toBeVisible()
  await expect(tree.getByRole("button", { name: "relay-modul", exact: true })).toBeVisible()
  await expect(page.locator(".monaco-editor")).toContainText('import { Relay } from "./lib/relay-modul/relay"', { timeout: 20_000 })

  // The AI sees the library catalog.
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
  await page.getByRole("tab", { name: "Chat AI" }).click()
  await page.getByLabel("Pesan untuk AI").fill("ECHO-LIBRARY")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Library terlihat: Relay modul (exports: Relay): Relay 24V + flyback diode")).toBeVisible({ timeout: 30_000 })
})
