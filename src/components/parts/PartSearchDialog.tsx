import { BookmarkPlus, Copy, ExternalLink, FileText, LoaderCircle, PackagePlus, Search } from "lucide-react"
import { useState, type FormEvent } from "react"
import toast from "react-hot-toast"
import { formatBytes } from "../../../shared/attachments"
import { PART_QUERY, PART_SOURCE_LABELS, PART_SOURCES, type CatalogPart, type PartHit, type PartSearchResult, type PartSource } from "../../../shared/parts"
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
}

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
  const facts = [hit.manufacturer, hit.package, formatStock(hit.stock), formatPrice(hit.price), hit.supplierPartNumber && hit.supplierPartNumber !== hit.title ? hit.supplierPartNumber : null].filter(Boolean)
  return (
    <li className="space-y-1.5 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="break-all font-mono text-sm font-medium">{hit.title}</span>
        {facts.length > 0 && <span className="text-xs text-muted">{facts.join(" · ")}</span>}
      </div>
      {hit.description && <p className="line-clamp-2 text-xs text-muted">{hit.description}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {catalogChip && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => onAddFromCatalog(catalogChip, hit)}><PackagePlus size={14} /> Tambah ke proyek</Button>
            <Button disabled={busy} onClick={() => onSaveToLibrary(catalogChip, hit)}><BookmarkPlus size={14} /> Simpan ke Library</Button>
          </>
        )}
        {hit.source === "jlcpcb" && <Button disabled={busy} onClick={() => onOpenJlcImport(hit)}><PackagePlus size={14} /> Impor lengkap (JLCPCB)</Button>}
        {!catalogChip && datasheetUrl && (
          <Button variant={hit.source === "jlcpcb" ? "ghost" : "primary"} disabled={busy} onClick={() => onFromDatasheet(hit)}>
            <FileText size={14} /> Buat dari datasheet
          </Button>
        )}
        {hit.footprint && <Button onClick={() => void copy(hit.footprint ?? "", "Footprint disalin")}><Copy size={14} /> Salin footprint</Button>}
        {datasheetUrl && (
          <a href={datasheetUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-ink">
            Datasheet <ExternalLink size={12} />
          </a>
        )}
        {productUrl && (
          <a href={productUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-ink">
            Halaman produk <ExternalLink size={12} />
          </a>
        )}
      </div>
    </li>
  )
}

/** One search over parts catalogs, suppliers and footprint libraries, with a way in for each kind of hit. */
export function PartSearchDialog({ projectId, onClose, onAddPart, onAskAi, onOpenJlcImport }: PartSearchDialogProps) {
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
      await libraryRepo.create({ name: part.componentName, description: `${part.mpn}${part.description ? `: ${part.description}` : ""}`.slice(0, 500), entry: `${part.componentName}.tsx`, files: { [`${part.componentName}.tsx`]: part.tsx } })
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

  const openJlc = (hit: PartHit) => {
    if (hit.supplierPartNumber) void copy(hit.supplierPartNumber, `${hit.supplierPartNumber} disalin: tempel di kotak pencarian impor`)
    onOpenJlcImport()
  }

  const catalogChips = result?.hits.filter((hit) => hit.source === "datasheets").map((hit) => hit.title) ?? []
  const groups = PART_SOURCES.map((source) => ({ source, hits: result?.hits.filter((hit) => hit.source === source) ?? [] })).filter((group) => group.hits.length > 0)

  return (
    <Modal title="Cari part" wide onClose={onClose}>
      <div className="space-y-3">
        <form onSubmit={search} className="flex gap-2">
          <label className="relative block flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              type="search"
              aria-label="Cari part"
              placeholder="Nomor part, nama chip atau package (mis. ADS8688, W5500, TSSOP-38)"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!valid || searching || sources.size === 0}>
            {searching ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />} Cari
          </Button>
        </form>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sumber">
          {PART_SOURCES.map((source) => {
            const on = sources.has(source)
            return (
              <button
                key={source}
                type="button"
                aria-pressed={on}
                onClick={() => setSources((current) => {
                  const next = new Set(current)
                  if (on) next.delete(source)
                  else next.add(source)
                  return next
                })}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted line-through"}`}
              >
                {PART_SOURCE_LABELS[source]}
              </button>
            )
          })}
        </div>

        {result && result.errors.length > 0 && (
          <p className="text-xs text-warn">Tidak bisa dihubungi: {result.errors.map((error) => `${PART_SOURCE_LABELS[error.source]} (${error.message})`).join(", ")}</p>
        )}
        {result && groups.length === 0 && (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
            Tidak ada hasil untuk "{result.query}". Coba nomor part tanpa akhiran kemasan (mis. ADS8688 bukan ADS8688IDBTR), atau unduh datasheet PDF-nya lalu lampirkan di chat.
          </p>
        )}
        {!result && (
          <p className="text-xs text-muted">
            Tidak terikat pada satu pabrik PCB: hasil dari katalog datasheet tscircuit, JLCPCB/LCSC, Texas Instruments, DigiKey, Mouser, footprint resmi KiCad dan registry tscircuit.
            Part tanpa file CAD dibuat dari datasheet-nya: server mengunduh PDF resmi lalu AI menyusun peta pin dan memilih footprint.
          </p>
        )}

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.source} aria-label={PART_SOURCE_LABELS[group.source]}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {PART_SOURCE_LABELS[group.source]} <span className="font-normal">({group.hits.length})</span>
              </h3>
              <ul className="divide-y divide-line rounded-md border border-line">
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
        <p className="text-xs text-muted">
          Sudah punya nomor LCSC (C…)?{" "}
          <button type="button" className="underline hover:text-ink" onClick={onOpenJlcImport}>Impor dari JLCPCB</button>{" "}
          membawa simbol, footprint dan model 3D sekaligus.
        </p>
        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            <LoaderCircle size={12} className="animate-spin" /> Memproses…
          </p>
        )}
      </div>
    </Modal>
  )
}
