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

const KICAD_MOD = `(footprint "Test_SOT-3"
  (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS"))
  (pad "1" smd rect (at -1 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at 0 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "3" smd rect (at 1 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
)
`

test("an uploaded KiCad footprint becomes a component the preview can build", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Cari part" }).click()
  await page.getByLabel("Nomor part untuk footprint").fill("TPS3823-33DBVR")
  await page.getByTestId("kicad-mod-input").setInputFiles({ name: "Test_SOT-3.kicad_mod", mimeType: "text/plain", buffer: Buffer.from(KICAD_MOD) })
  await expect(page.getByText(/TPS382333DBVR ditambahkan \(3 pad\)/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel("Pesan untuk AI")).toHaveValue(/Ganti pinLabels dengan nama pin dari datasheet TPS3823-33DBVR/)

  const projects = (await (await page.request.get("/api/projects")).json()).data as { id: string }[]
  const id = projects[0].id
  const project = (await (await page.request.get(`/api/projects/${id}`)).json()).data as { files: Record<string, string>; entrypoint: string }
  expect(Object.keys(project.files)).toEqual(expect.arrayContaining(["lib/parts/TPS382333DBVR.tsx", "lib/parts/TPS382333DBVR.footprint.json"]))

  // Use it on the board: the browser evaluator imports the JSON footprint and connects its pads.
  const board = `import { TPS382333DBVR } from "./lib/parts/TPS382333DBVR"
export default () => (
  <board width="20mm" height="12mm">
    <TPS382333DBVR name="U9" pcbX={-4} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={4} />
    <trace from=".U9 > .P1" to=".R1 > .pin1" />
    <trace from=".U9 > .pin3" to=".R1 > .pin2" />
  </board>
)
`
  await page.request.put(`/api/projects/${id}`, { headers: { "X-Just-Circuit-Request": "1" }, data: { entrypoint: project.entrypoint, files: { ...project.files, [project.entrypoint]: board } } })
  await page.reload()
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
})
