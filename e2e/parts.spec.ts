import { expect, test } from "./fixtures"

test("finds parts across sources, adds a catalog part, saves it to the library and builds one from a datasheet", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })

  // A part from the datasheet catalog becomes lib/parts/W5500.tsx, imported in the main file.
  await page.getByRole("button", { name: "Cari part" }).click()
  const dialog = page.getByRole("dialog", { name: "Cari part" })
  await dialog.getByRole("searchbox", { name: "Cari part" }).fill("W5500")
  await dialog.getByRole("button", { name: "Cari", exact: true }).click()
  await expect(dialog.getByRole("region", { name: "Katalog datasheet" })).toContainText("W5500")
  await expect(dialog.getByRole("region", { name: "DigiKey" })).toContainText("1278-1021-ND")
  await dialog.getByRole("region", { name: "Katalog datasheet" }).getByRole("button", { name: "Simpan ke Library" }).click()
  await expect(page.getByText("W5500 disimpan ke Library")).toBeVisible()
  await dialog.getByRole("region", { name: "DigiKey" }).getByRole("button", { name: "Tambah ke proyek" }).click()
  await expect(page.getByText(/W5500 ditambahkan \(4 pin\)/)).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toBeHidden()

  const projects = (await (await page.request.get("/api/projects")).json()).data as { id: string }[]
  const project = (await (await page.request.get(`/api/projects/${projects[0].id}`)).json()).data as { files: Record<string, string>; entrypoint: string }
  const part = project.files["lib/parts/W5500.tsx"]
  expect(part).toContain('pin3: ["GND_2"]')
  expect(part).toContain('supplierPartNumbers={{"digikey":["1278-1021-ND"]}}')
  expect(project.files[project.entrypoint]).toContain('import { W5500 } from "./lib/parts/W5500"')
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Library" }).click()
  await expect(page.getByRole("list", { name: "Isi library" })).toContainText("W5500")
  await page.keyboard.press("Escape")

  // A part without CAD data: the server downloads its datasheet into the chat box with a request.
  await page.getByRole("button", { name: "Cari part" }).click()
  await dialog.getByRole("searchbox", { name: "Cari part" }).fill("ADS8688")
  await dialog.getByRole("button", { name: "Cari", exact: true }).click()
  await dialog.getByRole("region", { name: "Texas Instruments" }).getByRole("button", { name: "Buat dari datasheet" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(page.getByLabel("Pesan untuk AI")).toHaveValue(/Buat komponen ADS8688IDBT.*lib\/parts\/ADS8688IDBT\.tsx/s)
  await expect(page.getByLabel("Pesan untuk AI")).toHaveValue(/kicad:Package_SO\/TSSOP-38_4\.4x9\.7mm_P0\.5mm/)
  await expect(page.getByRole("list", { name: "Lampiran" })).toContainText("ADS8688IDBT datasheet.pdf")
})
