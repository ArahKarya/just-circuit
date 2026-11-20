import { BookmarkPlus, Copy, ExternalLink, FileText, LoaderCircle, PackagePlus, Search, Upload } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import toast from "react-hot-toast"
import { formatBytes } from "../../../shared/attachments"
import { PART_QUERY, PART_SOURCE_LABELS, PART_SOURCES, type CatalogPart, type KicadModPart, type PartHit, type PartSearchResult, type PartSource } from "../../../shared/parts"
import { attempt } from "../../lib/notify"
import { catalogMatch, datasheetRequest, kicadQueryFor, partsRepo, supplierKeyFor } from "../../lib/parts"
import { libraryRepo } from "../../lib/repo"
import type { AttachmentRef } from "../../lib/types"
import { Button, Modal } from "../ui"

interface PartSearchDialogProps {
  projectId: string
  onClose: () => void
  /** Adds a ready component file to the project (and imports it in the entry file). */
  onAddPart: (part: CatalogPart) => Promise<void>
  /** Puts a request (and the downloaded datasheet) in the chat box for the user to send. */
  onAskAi: (text: string, attachments: AttachmentRef[]) => void
  /** The JLCPCB/EasyEDA importer (symbol, footprint and 3D model in one go). */
  onOpenJlcImport: () => void
  /** Adds a component made from an uploaded .kicad_mod; partName is what the user called it. */
  onAddKicadMod: (part: KicadModPart, partName: string) => Promise<void>
}

const MAX_KICAD_MOD_BYTES = 512 * 1024

/** Links come from outside services: only ever http(s) (the server already filters, this is a second net). */
const safeLink = (url: string | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined)

const formatPrice = (price: number | undefined) => (price === undefined ? null : `$${price.toFixed(price < 1 ? 3 : 2)}`)
const formatStock = (stock: number | undefined) => (stock === undefined ? null : `stok ${stock.toLocaleString("id-ID")}`)

async function copy(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast(text, { icon: "📋" })
  }
}

interface HitRowProps {
  hit: PartHit
  catalogChip: string | null
  busy: boolean
  onAddFromCatalog: (chip: string, hit: PartHit) => void
  onSaveToLibrary: (chip: string, hit: PartHit) => void
  onFromDatasheet: (hit: PartHit) => void
  onOpenJlcImport: (hit: PartHit) => void
}

function HitRow({ hit, catalogChip, busy, onAddFromCatalog, onSaveToLibrary, onFromDatasheet, onOpenJlcImport }: HitRowProps) {
  const datasheetUrl = safeLink(hit.datasheetUrl)
  const productUrl = safeLink(hit.productUrl)
  const facts = [
    hit.manufacturer,
    hit.package,
    formatStock(hit.stock),
    formatPrice(hit.price),
    hit.supplierPartNumber && hit.supplierPartNumber !== hit.title ? hit.supplierPartNumber : null,
  ].filter(Boolean)
  return (
    <li className="space-y-2 px-3.5 py-3 transition hover:bg-raised/40">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="break-all font-mono text-sm font-semibold text-ink">{hit.title}</span>
        {facts.length > 0 && <span className="text-xs text-muted">{facts.join(" · ")}</span>}
      </div>
      {hit.description && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{hit.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {catalogChip && (
          <>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onAddFromCatalog(catalogChip, hit)}>
              <PackagePlus size={13} /> Tambah ke proyek
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onSaveToLibrary(catalogChip, hit)}>
              <BookmarkPlus size={13} /> Simpan ke Library
            </Button>
          </>
        )}
        {hit.source === "jlcpcb" && (
          <Button size="sm" disabled={busy} onClick={() => onOpenJlcImport(hit)}>
            <PackagePlus size={13} /> Impor lengkap (JLCPCB)
          </Button>
        )}
        {!catalogChip && datasheetUrl && (
          <Button size="sm" variant={hit.source === "jlcpcb" ? "ghost" : "primary"} disabled={busy} onClick={() => onFromDatasheet(hit)}>
            <FileText size={13} /> Buat dari datasheet
          </Button>
        )}
        {hit.footprint && (
          <Button size="sm" onClick={() => void copy(hit.footprint ?? "", "Footprint disalin")}>
            <Copy size={13} /> Salin footprint
          </Button>
        )}
        {datasheetUrl && (
          <a
            href={datasheetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs text-muted transition hover:bg-raised hover:text-ink"
          >
            Datasheet <ExternalLink size={11} />
          </a>
        )}
        {productUrl && (
          <a
            href={productUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs text-muted transition hover:bg-raised hover:text-ink"
          >
            Halaman produk <ExternalLink size={11} />
          </a>
        )}
      </div>
    </li>
  )
}

/** One search over parts catalogs, suppliers and footprint libraries, with a way in for each kind of hit. */
export function PartSearchDialog({ projectId, onClose, onAddPart, onAskAi, onOpenJlcImport, onAddKicadMod }: PartSearchDialogProps) {
  const kicadInput = useRef<HTMLInputElement>(null)
  const [kicadPartName, setKicadPartName] = useState("")
  const [query, setQuery] = useState("")
  const [sources, setSources] = useState<ReadonlySet<PartSource>>(new Set(PART_SOURCES))
  const [result, setResult] = useState<PartSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)

  const valid = PART_QUERY.test(query.trim())
  const search = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!valid || sources.size === 0) return
    setSearching(true)
    await attempt(async () => setResult(await partsRepo.search(query.trim(), [...sources])))
    setSearching(false)
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    await attempt(task)
    setBusy(false)
  }

  const catalogPart = (chip: string, hit: PartHit) => {
    const supplier = supplierKeyFor(hit.source)
    return partsRepo.catalog(chip, supplier, supplier ? hit.supplierPartNumber : undefined)
  }

  const addFromCatalog = (chip: string, hit: PartHit) =>
    void run(async () => {
      await onAddPart(await catalogPart(chip, hit))
      onClose()
    })

  const saveToLibrary = (chip: string, hit: PartHit) =>
    void run(async () => {
      const part = await catalogPart(chip, hit)
      await libraryRepo.create({
        name: part.componentName,
        description: `${part.mpn}${part.description ? `: ${part.description}` : ""}`.slice(0, 500),
        entry: `${part.componentName}.tsx`,
        files: { [`${part.componentName}.tsx`]: part.tsx },
      })
      toast.success(`${part.componentName} disimpan ke Library`)
    })

  const fromDatasheet = (hit: PartHit) =>
    void run(async () => {
      if (!hit.datasheetUrl) return
      const kicadQuery = kicadQueryFor(hit.package)
      const [attachment, footprints] = await Promise.all([
        partsRepo.fetchDatasheet(projectId, hit.datasheetUrl, hit.title),
        kicadQuery ? partsRepo.footprints(kicadQuery).catch(() => []) : Promise.resolve([]),
      ])
      toast.success(`Datasheet ${hit.title} (${formatBytes(attachment.size)}${attachment.pages ? `, ${attachment.pages} hlm` : ""}) dilampirkan`)
      onAskAi(datasheetRequest(hit, footprints), [attachment])
      onClose()
    })

  const uploadKicadMod = (file: File) =>
    void run(async () => {
      if (file.size > MAX_KICAD_MOD_BYTES) throw new Error(`${file.name} terlalu besar (maksimal 512 KB)`)
      const part = await partsRepo.convertKicadMod(file.name, await file.text(), kicadPartName.trim())
      await onAddKicadMod(part, kicadPartName.trim())
      onClose()
    })

  const openJlc = (hit: PartHit) => {
    if (hit.supplierPartNumber) void copy(hit.supplierPartNumber, `${hit.supplierPartNumber} disalin: tempel di kotak pencarian impor`)
    onOpenJlcImport()
  }

  const catalogChips = result?.hits.filter((hit) => hit.source === "datasheets").map((hit) => hit.title) ?? []
  const groups = PART_SOURCES.map((source) => ({ source, hits: result?.hits.filter((hit) => hit.source === source) ?? [] })).filter((group) => group.hits.length > 0)

  return (
    <Modal title="Cari part" wide onClose={onClose}>
      <div className="space-y-4">
        <form onSubmit={search} className="flex gap-2">
          <label className="relative block flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              type="search"
              aria-label="Cari part"
              placeholder="Nomor part, nama chip atau package (mis. ADS8688, W5500, TSSOP-38)"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!valid || searching || sources.size === 0}>
            {searching ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />} Cari
          </Button>
        </form>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sumber">
          {PART_SOURCES.map((source) => {
            const on = sources.has(source)
            return (
              <button
                key={source}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setSources((current) => {
                    const next = new Set(current)
                    if (on) next.delete(source)
                    else next.add(source)
                    return next
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                  on ? "border-accent/40 bg-accent/10 text-ink" : "border-line bg-surface/40 text-muted line-through opacity-75 hover:opacity-100"
                }`}
              >
                <span className={`size-1.5 rounded-full ${on ? "bg-accent" : "bg-muted/50"}`} />
                {PART_SOURCE_LABELS[source]}
              </button>
            )
          })}
        </div>

        {result && result.errors.length > 0 && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            Tidak bisa dihubungi: {result.errors.map((error) => `${PART_SOURCE_LABELS[error.source]} (${error.message})`).join(", ")}
          </p>
        )}
        {result && groups.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-surface/40 p-6 text-center text-sm text-muted">
            Tidak ada hasil untuk "{result.query}". Coba nomor part tanpa akhiran kemasan (mis. ADS8688 bukan ADS8688IDBTR), atau unduh datasheet PDF-nya lalu lampirkan di chat.
          </p>
        )}
        {!result && (
          <p className="rounded-xl border border-line bg-surface/40 p-3.5 text-xs leading-relaxed text-muted">
            Tidak terikat pada satu pabrik PCB: hasil dari katalog datasheet tscircuit, JLCPCB/LCSC, Texas Instruments, DigiKey, Mouser, footprint resmi KiCad dan registry tscircuit.
            Part tanpa file CAD dibuat dari datasheet-nya: server mengunduh PDF resmi lalu AI menyusun peta pin dan memilih footprint.
          </p>
        )}

        <div className="max-h-[52vh] space-y-4 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.source} aria-label={PART_SOURCE_LABELS[group.source]}>
              <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span>{PART_SOURCE_LABELS[group.source]}</span>
                <span className="rounded-full bg-raised px-1.5 py-0.2 font-normal tabular-nums">{group.hits.length}</span>
              </h3>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface/40">
                {group.hits.map((hit) => (
                  <HitRow
                    key={hit.key}
                    hit={hit}
                    catalogChip={hit.source === "datasheets" ? hit.title : hit.source === "kicad" || hit.source === "tscircuit" ? null : catalogMatch(hit, catalogChips)}
                    busy={busy}
                    onAddFromCatalog={addFromCatalog}
                    onSaveToLibrary={saveToLibrary}
                    onFromDatasheet={fromDatasheet}
                    onOpenJlcImport={openJlc}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section aria-label="Footprint KiCad sendiri" className="space-y-2.5 rounded-xl border border-dashed border-line bg-surface/40 p-3.5">
          <p className="text-xs leading-relaxed text-muted">
            Punya file footprint KiCad (.kicad_mod) dari situs pabrikan, SnapEDA atau Ultra Librarian? Unggah di sini; nama pin bisa diisi AI dari datasheet.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Nomor part untuk footprint"
              placeholder="Nomor part (mis. ADS8688IDBT)"
              value={kicadPartName}
              maxLength={80}
              onChange={(event) => setKicadPartName(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <Button disabled={busy} onClick={() => kicadInput.current?.click()}>
              <Upload size={14} /> Unggah .kicad_mod
            </Button>
            <input
              ref={kicadInput}
              type="file"
              accept=".kicad_mod"
              hidden
              data-testid="kicad-mod-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) uploadKicadMod(file)
              }}
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <p>
            Sudah punya nomor LCSC (C…)?{" "}
            <button type="button" className="font-medium text-accent underline underline-offset-2 hover:brightness-110" onClick={onOpenJlcImport}>
              Impor dari JLCPCB
            </button>{" "}
            membawa simbol, footprint dan model 3D sekaligus.
          </p>
          {busy && (
            <p className="flex items-center gap-1.5 font-medium text-accent" aria-live="polite">
              <LoaderCircle size={12} className="animate-spin" /> Memproses…
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
