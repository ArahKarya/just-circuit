import { Cpu, Grid2x2, PackagePlus, TriangleAlert, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import {
  buildFootprintTsx,
  FAMILY_DEFAULTS,
  footprintWarnings,
  generatePads,
  pin1Marker,
  safeComponentName,
  silkscreenRoutes,
  type FootprintParams,
  type PackageFamily,
  type PadSpec,
} from "../../lib/footprint-wizard"
import { assertKicadSymbolFile, importKicadSymbol, KICAD_SYMBOL_EXTENSION } from "../../lib/kicad-import"
import { buildPanelTsx, PANEL_FILE, type PanelSeparation } from "../../lib/panel-wizard"
import type { Project, ProjectFiles } from "../../lib/types"
import { planFileWrite, type PlannedWrite } from "../../lib/wizard-write"
import { Button, Field, Modal, SelectField } from "../ui"

type WizardTab = "footprint" | "symbol" | "panel"

interface FootprintWizardDialogProps {
  project: Project
  /** Undo-recording commit of the whole file map; `openFile` is shown in the code tab afterwards. */
  onCommitFiles: (files: ProjectFiles, openFile?: string) => void
  onClose: () => void
}

interface PendingWrite extends PlannedWrite {
  successMessage: string
}

const FAMILY_OPTIONS: { value: PackageFamily; label: string }[] = [
  { value: "soic", label: "Dual-Row SMD (SOIC / TSSOP / MSOP)" },
  { value: "qfn", label: "4-Sided SMD (QFN / QFP)" },
  { value: "pinrow", label: "Pin Header / Terminal Block (THT)" },
  { value: "bga", label: "BGA Matrix (Ball Grid Array)" },
]

const SEPARATION_OPTIONS: { value: PanelSeparation; label: string }[] = [
  { value: "mouse-bites", label: "Tab + Mouse-bites" },
  { value: "v-score", label: "Tab + V-Score" },
  { value: "outline", label: "Outline routing (tanpa tab)" },
]

const RAIL_WIDTH_MM = 5

const numberOr = (fallback: number) => (raw: string) => {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function FootprintWizardDialog({ project, onCommitFiles, onClose }: FootprintWizardDialogProps) {
  const [tab, setTab] = useState<WizardTab>("footprint")
  const [pending, setPending] = useState<PendingWrite | null>(null)

  const commit = (plan: PlannedWrite, message: string) => {
    onCommitFiles(plan.files, plan.path)
    toast.success(message)
    onClose()
  }

  /** Writes at once, or asks first when an existing file would be replaced. */
  const requestWrite = (plan: PlannedWrite, successMessage: string) => {
    if (plan.overwrites.length > 0) setPending({ ...plan, successMessage })
    else commit(plan, successMessage)
  }

  return (
    <Modal
      title="Footprint Wizard, Impor .kicad_sym & Panelisasi"
      subtitle="Buat komponen kustom dengan footprint + 3D model, impor simbol KiCad, atau buat panel produksi"
      wide
      onClose={onClose}
    >
      <div className="space-y-4">
        <TabBar tab={tab} onChange={setTab} />
        {pending && (
          <OverwriteConfirm
            paths={pending.overwrites}
            onCancel={() => setPending(null)}
            onConfirm={() => commit(pending, pending.successMessage)}
          />
        )}
        {tab === "footprint" && <FootprintTab project={project} onWrite={requestWrite} />}
        {tab === "symbol" && <SymbolTab project={project} onWrite={requestWrite} />}
        {tab === "panel" && <PanelTab project={project} onWrite={requestWrite} />}
      </div>
    </Modal>
  )
}

type WriteRequest = (plan: PlannedWrite, successMessage: string) => void

function TabBar({ tab, onChange }: { tab: WizardTab; onChange: (tab: WizardTab) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/70 p-1" role="tablist">
      {([
        ["footprint", "Footprint Wizard", Cpu],
        ["symbol", "Impor .kicad_sym", Upload],
        ["panel", "Panelisasi (<panel>)", Grid2x2],
      ] as const).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            tab === id ? "bg-raised text-ink shadow-xs" : "text-muted hover:text-ink"
          }`}
        >
          <Icon size={13} className={tab === id ? "text-accent" : ""} />
          {label}
        </button>
      ))}
    </div>
  )
}

function OverwriteConfirm({ paths, onCancel, onConfirm }: { paths: readonly string[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div role="alertdialog" aria-label="Konfirmasi timpa file" className="space-y-2.5 rounded-xl border border-warn/40 bg-warn/10 p-3.5 text-xs text-ink">
      <p className="flex items-start gap-2">
        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
        <span>
          File berikut sudah ada dan akan ditimpa: <code className="font-mono">{paths.join(", ")}</code>. Perubahan bisa dibatalkan dengan Undo CAD.
        </span>
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button size="sm" variant="danger" onClick={onConfirm}>
          Timpa File
        </Button>
      </div>
    </div>
  )
}

function InsertImportToggle({ checked, entrypoint, onChange }: { checked: boolean; entrypoint: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-emerald-500" />
      Tambahkan import komponen ke <code className="font-mono">{entrypoint}</code>
    </label>
  )
}

function FootprintTab({ project, onWrite }: { project: Project; onWrite: WriteRequest }) {
  const [compName, setCompName] = useState("CustomIC")
  const [params, setParams] = useState<FootprintParams>({ family: "soic", ...FAMILY_DEFAULTS.soic })
  const [pinNamesCsv, setPinNamesCsv] = useState("VCC, IN1, IN2, GND, OUT1, OUT2, EN, NC")
  const [cadModelUrl, setCadModelUrl] = useState("")
  const [insertImport, setInsertImport] = useState(false)

  const pads = useMemo(() => generatePads(params), [params])
  const warnings = useMemo(() => footprintWarnings(params, pads), [params, pads])
  const set = <K extends keyof FootprintParams>(key: K, value: FootprintParams[K]) => setParams((prev) => ({ ...prev, [key]: value }))
  const changeFamily = (family: PackageFamily) => setParams({ family, ...FAMILY_DEFAULTS[family] })
  const isRowFamily = params.family === "soic" || params.family === "qfn"

  const create = () => {
    const name = safeComponentName(compName)
    const pinNames = pinNamesCsv.split(",").map((s) => s.trim()).filter(Boolean)
    const tsx = buildFootprintTsx({ name, params, pinNames, cadModelUrl })
    const path = `lib/parts/${name}.tsx`
    onWrite(planFileWrite(project, path, tsx, insertImport), `${name} dibuat di ${path} (${pads.length} pad). Cocokkan dengan datasheet sebelum produksi.`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Nama Komponen (TSX)" value={compName} onChange={(e) => setCompName(e.target.value)} />
          <SelectField label="Tipe Paket" options={FAMILY_OPTIONS} value={params.family} onChange={(e) => changeFamily(e.target.value as PackageFamily)} />
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Field label="Jumlah Pin" type="number" min={2} max={128} value={params.pinCount} onChange={(e) => set("pinCount", numberOr(8)(e.target.value))} />
          <Field label="Pitch e (mm)" type="number" step="0.05" value={params.pitch} onChange={(e) => set("pitch", numberOr(1.27)(e.target.value))} />
          <Field
            label={params.family === "qfn" ? "Ukuran Body (mm)" : "Lead Span E (mm)"}
            type="number"
            step="0.05"
            disabled={!isRowFamily}
            value={params.leadSpan}
            onChange={(e) => set("leadSpan", numberOr(6)(e.target.value))}
          />
          <Field label="Lebar Body (mm)" type="number" step="0.1" value={params.bodyWidth} onChange={(e) => set("bodyWidth", numberOr(4)(e.target.value))} />
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Field
            label={isRowFamily ? "Panjang Pad (mm)" : "Diameter Pad (mm)"}
            type="number"
            step="0.05"
            value={params.padLength}
            onChange={(e) => set("padLength", numberOr(1.5)(e.target.value))}
          />
          {isRowFamily && (
            <Field label="Lebar Pad (mm)" type="number" step="0.05" value={params.padWidth} onChange={(e) => set("padWidth", numberOr(0.6)(e.target.value))} />
          )}
          {params.family === "qfn" && (
            <Field
              label="Exposed Pad (mm, 0 = tanpa)"
              type="number"
              step="0.05"
              value={params.exposedPad}
              onChange={(e) => set("exposedPad", numberOr(0)(e.target.value))}
            />
          )}
        </div>
        <Field label="URL Model 3D STEP (opsional)" placeholder="https://…/part.step" value={cadModelUrl} onChange={(e) => setCadModelUrl(e.target.value)} />
        <Field
          label="Nama Pin (pisahkan koma)"
          hint="Nama kosong, ganda atau berkarakter tidak valid otomatis disesuaikan (mis. GND, GND_2)."
          value={pinNamesCsv}
          onChange={(e) => setPinNamesCsv(e.target.value)}
        />
        <InsertImportToggle checked={insertImport} entrypoint={project.entrypoint} onChange={setInsertImport} />
        <p className="text-[11px] leading-relaxed text-muted">
          Hasil wizard adalah titik awal (land pattern kira-kira IPC-7351). Selalu cocokkan ukuran pad dengan land pattern yang disarankan di datasheet.
        </p>
        <Button variant="primary" onClick={create}>
          <PackagePlus size={14} /> Buat Komponen di lib/parts/
        </Button>
      </div>
      <FootprintPreview params={params} pads={pads} warnings={warnings} />
    </div>
  )
}

function FootprintPreview({ params, pads, warnings }: { params: FootprintParams; pads: readonly PadSpec[]; warnings: readonly string[] }) {
  const marker = pin1Marker(pads)
  const silk = silkscreenRoutes(params, pads)
  const extent = Math.max(8, ...pads.map((p) => Math.max(Math.abs(p.x) + p.w, Math.abs(p.y) + p.h) * 2 + 2), ...silk.flat().map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) * 2 + 2))
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-[#090c10]">
      <div className="border-b border-line bg-panel px-3 py-1.5 text-[11px] text-muted">
        Preview Footprint ({pads.length} pad · pitch {params.pitch}mm)
      </div>
      <svg viewBox={`${-extent / 2} ${-extent / 2} ${extent} ${extent}`} className="h-72 w-full" role="img" aria-label="Preview footprint">
        {silk.map((route, i) => (
          <polyline key={i} points={route.map((p) => `${p.x},${-p.y}`).join(" ")} fill="none" stroke="#cbd5e1" strokeWidth={0.12} />
        ))}
        <circle cx={marker.x} cy={-marker.y} r={0.2} fill="#34d399" />
        {pads.map((p) =>
          p.shape === "circle" ? (
            <g key={p.num}>
              <circle cx={p.x} cy={-p.y} r={p.w / 2} fill={p.plated ? "#eab308" : "#ef4444"} />
              {p.plated && <circle cx={p.x} cy={-p.y} r={p.w * 0.27} fill="#090c10" />}
            </g>
          ) : (
            <rect key={p.num} x={p.x - p.w / 2} y={-p.y - p.h / 2} width={p.w} height={p.h} rx={0.05} fill="#ef4444" />
          ),
        )}
      </svg>
      {warnings.length > 0 && (
        <ul className="space-y-1 border-t border-line bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SymbolTab({ project, onWrite }: { project: Project; onWrite: WriteRequest }) {
  const [customName, setCustomName] = useState("")
  const [footprint, setFootprint] = useState("")
  const [insertImport, setInsertImport] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    try {
      assertKicadSymbolFile(file)
      const sym = importKicadSymbol(file.name, await file.text(), { customName, footprint })
      const renamed = sym.renamedPins > 0 ? `, ${sym.renamedPins} nama pin disesuaikan` : ""
      const noFootprint = footprint.trim() ? "" : ". Footprint belum dipilih: isi di file sesuai datasheet"
      onWrite(planFileWrite(project, sym.filePath, sym.tsx, insertImport), `Simbol ${sym.componentName} (${sym.pinCount} pin${renamed}) ditambahkan ke ${sym.filePath}${noFootprint}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor .kicad_sym")
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-5">
      <p className="text-xs leading-relaxed text-muted">
        Unggah file library simbol KiCad (<code>.kicad_sym</code>) dari situs pabrikan, SnapEDA, atau Ultra Librarian. Daftar pin diambil dari simbol; footprint
        tidak ada di file simbol, jadi isi sesuai paket di datasheet (atau biarkan kosong dan tambahkan nanti).
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Nama Komponen (opsional)" placeholder="mis. STM32F103C8" value={customName} onChange={(e) => setCustomName(e.target.value)} />
        <Field
          label="Footprint (opsional)"
          placeholder="mis. lqfp48, soic8, qfn32"
          hint="String footprint tscircuit. Kosong = chip tanpa footprint PCB."
          value={footprint}
          onChange={(e) => setFootprint(e.target.value)}
        />
      </div>
      <InsertImportToggle checked={insertImport} entrypoint={project.entrypoint} onChange={setInsertImport} />
      <Button variant="primary" onClick={() => inputRef.current?.click()}>
        <Upload size={14} /> Unggah .kicad_sym
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={KICAD_SYMBOL_EXTENSION}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) void upload(file)
        }}
      />
    </div>
  )
}

function PanelTab({ project, onWrite }: { project: Project; onWrite: WriteRequest }) {
  const [cols, setCols] = useState(2)
  const [rows, setRows] = useState(2)
  const [boardGap, setBoardGap] = useState(2.5)
  const [separation, setSeparation] = useState<PanelSeparation>("mouse-bites")
  const [rails, setRails] = useState(true)

  const create = () => {
    const tsx = buildPanelTsx({ cols, rows, boardGap, separation, railWidth: rails ? RAIL_WIDTH_MM : 0 }, project.entrypoint)
    onWrite(planFileWrite(project, PANEL_FILE, tsx), `${PANEL_FILE} (${cols}×${rows}) berhasil dibuat`)
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface/40 p-5">
      <p className="text-xs leading-relaxed text-muted">
        Buat file <code>{PANEL_FILE}</code> yang menggandakan board aktif menjadi panel produksi memakai primitif <code>&lt;panel&gt;</code> tscircuit (tab dengan
        mouse-bites atau V-score, atau outline routing). Cek aturan panel pabrik PCB Anda.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Kolom" type="number" min={1} max={10} value={cols} onChange={(e) => setCols(numberOr(2)(e.target.value))} />
        <Field label="Baris" type="number" min={1} max={10} value={rows} onChange={(e) => setRows(numberOr(2)(e.target.value))} />
        <Field label="Jarak antar board (mm)" type="number" step="0.5" value={boardGap} onChange={(e) => setBoardGap(numberOr(2.5)(e.target.value))} />
        <SelectField label="Metode Pemisahan" options={SEPARATION_OPTIONS} value={separation} onChange={(e) => setSeparation(e.target.value as PanelSeparation)} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
        <input type="checkbox" checked={rails} onChange={(e) => setRails(e.target.checked)} className="size-4 accent-emerald-500" />
        Tambahkan tooling rail {RAIL_WIDTH_MM}mm di atas &amp; bawah (untuk mesin SMT pick-and-place)
      </label>
      <Button variant="primary" onClick={create}>
        <Grid2x2 size={14} /> Buat {PANEL_FILE} ({cols * rows} board)
      </Button>
    </div>
  )
}
