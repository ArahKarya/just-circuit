import { Cpu, Grid2x2, PackagePlus, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import { importKicadSymbol } from "../../lib/kicad-import"
import { addComponentFile, withFiles } from "../../lib/project-ops"
import { jsxStringValue, roundMm } from "../../lib/tsx-ast"
import type { Project } from "../../lib/types"
import { Button, Field, Modal, SelectField } from "../ui"

type WizardTab = "footprint" | "symbol" | "panel"
type PackageFamily = "soic" | "qfn" | "bga" | "pinrow"

interface FootprintWizardDialogProps {
  project: Project
  onApplyProject: (next: Project, commitMessage: string, openFile?: string) => Promise<void>
  onClose: () => void
}

const FAMILY_OPTIONS: { value: PackageFamily; label: string }[] = [
  { value: "soic", label: "Dual-Row SMD (SOIC / TSSOP / MSOP)" },
  { value: "qfn", label: "4-Sided SMD (QFN / QFP)" },
  { value: "pinrow", label: "Pin Header / Terminal Block (THT)" },
  { value: "bga", label: "BGA Matrix (Ball Grid Array)" },
]

interface PadPreview {
  num: number
  x: number
  y: number
  w: number
  h: number
  circle?: boolean
}

function generatePads(family: PackageFamily, pinCount: number, pitch: number, bodyW: number, padW: number, padH: number): PadPreview[] {
  const pads: PadPreview[] = []
  const n = Math.max(2, Math.min(128, pinCount))
  if (family === "pinrow") {
    const startX = -((n - 1) * pitch) / 2
    for (let i = 0; i < n; i += 1) {
      pads.push({ num: i + 1, x: roundMm(startX + i * pitch), y: 0, w: padW, h: padW, circle: true })
    }
  } else if (family === "soic") {
    const perSide = Math.ceil(n / 2)
    const startY = ((perSide - 1) * pitch) / 2
    const xOff = bodyW / 2 + padW / 2
    for (let i = 0; i < perSide; i += 1) {
      pads.push({ num: i + 1, x: roundMm(-xOff), y: roundMm(startY - i * pitch), w: padW, h: padH })
    }
    for (let i = 0; i < n - perSide; i += 1) {
      pads.push({ num: perSide + i + 1, x: roundMm(xOff), y: roundMm(-startY + i * pitch), w: padW, h: padH })
    }
  } else if (family === "qfn") {
    const perSide = Math.max(1, Math.floor(n / 4))
    const span = ((perSide - 1) * pitch) / 2
    const off = bodyW / 2
    let p = 1
    // Left (top->bottom)
    for (let i = 0; i < perSide; i += 1) pads.push({ num: p++, x: roundMm(-off), y: roundMm(span - i * pitch), w: padW, h: padH })
    // Bottom (left->right)
    for (let i = 0; i < perSide; i += 1) pads.push({ num: p++, x: roundMm(-span + i * pitch), y: roundMm(-off), w: padH, h: padW })
    // Right (bottom->top)
    for (let i = 0; i < perSide; i += 1) pads.push({ num: p++, x: roundMm(off), y: roundMm(-span + i * pitch), w: padW, h: padH })
    // Top (right->left)
    for (let i = 0; i < perSide; i += 1) pads.push({ num: p++, x: roundMm(span - i * pitch), y: roundMm(off), w: padH, h: padW })
  } else {
    const side = Math.ceil(Math.sqrt(n))
    const half = ((side - 1) * pitch) / 2
    let p = 1
    for (let r = 0; r < side && p <= n; r += 1) {
      for (let c = 0; c < side && p <= n; c += 1) {
        pads.push({ num: p++, x: roundMm(-half + c * pitch), y: roundMm(half - r * pitch), w: padW, h: padW, circle: true })
      }
    }
  }
  return pads
}

export function FootprintWizardDialog({ project, onApplyProject, onClose }: FootprintWizardDialogProps) {
  const [tab, setTab] = useState<WizardTab>("footprint")

  // Footprint wizard state
  const [compName, setCompName] = useState("CustomIC")
  const [family, setFamily] = useState<PackageFamily>("soic")
  const [pinCount, setPinCount] = useState(8)
  const [pitch, setPitch] = useState(1.27)
  const [bodyW, setBodyW] = useState(4.0)
  const [padW, setPadW] = useState(1.5)
  const [padH, setPadH] = useState(0.6)
  const [pinNamesCsv, setPinNamesCsv] = useState("VCC, IN1, IN2, GND, OUT1, OUT2, EN, NC")
  const [cadModelUrl, setCadModelUrl] = useState("")

  // KiCad symbol state
  const [symCustomName, setSymCustomName] = useState("")
  const symInputRef = useRef<HTMLInputElement>(null)

  // Panelization state
  const [panelCols, setPanelCols] = useState(2)
  const [panelRows, setPanelRows] = useState(2)
  const [panelSpacing, setPanelSpacing] = useState(2.5)
  const [panelMethod, setPanelMethod] = useState<"tab-routing" | "v-score">("tab-routing")
  const [panelRail, setPanelRail] = useState(true)

  const pads = useMemo(() => generatePads(family, pinCount, pitch, bodyW, padW, padH), [family, pinCount, pitch, bodyW, padW, padH])

  const createFootprintComponent = async () => {
    const safeName = compName.replace(/[^A-Za-z0-9]/g, "") || "CustomPart"
    const labels = pinNamesCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const pinMap = pads.map((p, i) => `  pin${p.num}: ${JSON.stringify(labels[i] ?? `P${p.num}`)},`).join("\n")
    const padJsx = pads
      .map((p) =>
        p.circle && family === "pinrow"
          ? `        <platedhole portHints={[${JSON.stringify(`pin${p.num}`)}]} shape="circle" outerDiameter="${p.w}mm" holeDiameter="${roundMm(p.w * 0.55)}mm" pcbX={${p.x}} pcbY={${p.y}} />`
          : p.circle
            ? `        <smtpad portHints={[${JSON.stringify(`pin${p.num}`)}]} shape="circle" radius="${roundMm(p.w / 2)}mm" pcbX={${p.x}} pcbY={${p.y}} />`
            : `        <smtpad portHints={[${JSON.stringify(`pin${p.num}`)}]} shape="rect" width="${p.w}mm" height="${p.h}mm" pcbX={${p.x}} pcbY={${p.y}} />`,
      )
      .join("\n")
    const cadProp = cadModelUrl.trim() ? `\n    cadModel={{ stepUrl: ${jsxStringValue(cadModelUrl.trim())} }}` : ""

    const tsx = `import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
${pinMap}
} as const

export const ${safeName} = (props: ChipProps<typeof pinLabels>) => (
  <chip
    manufacturerPartNumber=${jsxStringValue(safeName)}
    pinLabels={pinLabels}${cadProp}
    footprint={
      <footprint>
${padJsx}
        <silkscreenpath route={[{ x: ${roundMm(-bodyW / 2)}, y: ${roundMm(bodyW / 2)} }, { x: ${roundMm(bodyW / 2)}, y: ${roundMm(bodyW / 2)} }, { x: ${roundMm(bodyW / 2)}, y: ${roundMm(-bodyW / 2)} }, { x: ${roundMm(-bodyW / 2)}, y: ${roundMm(-bodyW / 2)} }, { x: ${roundMm(-bodyW / 2)}, y: ${roundMm(bodyW / 2)} }]} />
      </footprint>
    }
    {...props}
  />
)
`
    const filePath = `lib/parts/${safeName}.tsx`
    const added = addComponentFile(project, filePath, tsx)
    await onApplyProject(added.project, `Buat footprint ${safeName}`, filePath)
    toast.success(`${safeName} dibuat di ${filePath} (${pads.length} pad)`)
    onClose()
  }

  const handleSymbolUpload = async (file: File) => {
    try {
      const sym = importKicadSymbol(file.name, await file.text(), symCustomName)
      const added = addComponentFile(project, sym.filePath, sym.tsx)
      await onApplyProject(added.project, `Impor simbol KiCad ${sym.componentName}`, sym.filePath)
      toast.success(`Simbol ${sym.componentName} (${sym.pinCount} pin) ditambahkan ke ${sym.filePath}`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor .kicad_sym")
    }
  }

  const createPanelFile = async () => {
    const entryImport = `./${project.entrypoint.replace(/\.tsx?$/, "")}`
    const boards: string[] = []
    for (let r = 0; r < panelRows; r += 1) {
      for (let c = 0; c < panelCols; c += 1) {
        boards.push(`      <MainBoard key="b_${r}_${c}" />`)
      }
    }
    const tsx = `import MainBoard from ${jsxStringValue(entryImport)}

/** Panel produksi ${panelCols}×${panelRows} (${panelMethod}) */
export default () => (
  <panel
    layoutMode="grid"
    boardGap="${roundMm(panelSpacing)}mm"
    panelizationMethod=${jsxStringValue(panelMethod)}
    ${panelRail ? 'edgeRails={{ top: "5mm", bottom: "5mm" }}' : ""}
  >
${boards.join("\n")}
  </panel>
)
`
    const next = withFiles(project, { "panel.circuit.tsx": tsx })
    await onApplyProject(next, `Buat panel produksi ${panelCols}×${panelRows}`, "panel.circuit.tsx")
    toast.success(`panel.circuit.tsx (${panelCols}×${panelRows}) berhasil dibuat`)
    onClose()
  }

  const extent = Math.max(8, bodyW + padW * 2 + 4, ...pads.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) * 2 + 4))

  return (
    <Modal
      title="Footprint Wizard, Impor .kicad_sym & Panelisasi"
      subtitle="Buat komponen kustom dengan footprint + 3D model, impor simbol KiCad, atau buat panel produksi"
      wide
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl border border-line bg-surface/70 p-1" role="tablist">
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
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === id ? "bg-raised text-ink shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={13} className={tab === id ? "text-accent" : ""} />
              {label}
            </button>
          ))}
        </div>

        {tab === "footprint" && (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Nama Komponen (TSX)" value={compName} onChange={(e) => setCompName(e.target.value)} />
                <SelectField label="Tipe Paket" options={FAMILY_OPTIONS} value={family} onChange={(e) => setFamily(e.target.value as PackageFamily)} />
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Field label="Jumlah Pin" type="number" min={2} max={128} value={pinCount} onChange={(e) => setPinCount(Number(e.target.value) || 8)} />
                <Field label="Pitch (mm)" type="number" step="0.05" value={pitch} onChange={(e) => setPitch(Number(e.target.value) || 1.27)} />
                <Field label="Lebar Body (mm)" type="number" step="0.2" value={bodyW} onChange={(e) => setBodyW(Number(e.target.value) || 4)} />
                <Field label="Lebar Pad (mm)" type="number" step="0.1" value={padW} onChange={(e) => setPadW(Number(e.target.value) || 1.2)} />
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Tinggi Pad (mm)" type="number" step="0.05" value={padH} onChange={(e) => setPadH(Number(e.target.value) || 0.6)} />
                <Field label="URL Model 3D STEP/GLB (opsional)" placeholder="https://…/part.step" value={cadModelUrl} onChange={(e) => setCadModelUrl(e.target.value)} />
              </div>
              <Field label="Nama Pin (pisahkan koma)" value={pinNamesCsv} onChange={(e) => setPinNamesCsv(e.target.value)} />
              <Button variant="primary" onClick={() => void createFootprintComponent()}>
                <PackagePlus size={14} /> Buat Komponen di lib/parts/
              </Button>
            </div>

            <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-[#090c10]">
              <div className="border-b border-line bg-panel px-3 py-1.5 text-[11px] text-muted">
                Preview Footprint ({pads.length} pad · pitch {pitch}mm)
              </div>
              <svg viewBox={`${-extent / 2} ${-extent / 2} ${extent} ${extent}`} className="h-72 w-full">
                <rect x={-bodyW / 2} y={-bodyW / 2} width={bodyW} height={bodyW} fill="none" stroke="#cbd5e1" strokeWidth={0.12} />
                <circle cx={-bodyW / 2 + 0.5} cy={-bodyW / 2 + 0.5} r={0.25} fill="#34d399" />
                {pads.map((p) =>
                  p.circle ? (
                    <g key={p.num}>
                      <circle cx={p.x} cy={-p.y} r={p.w / 2} fill={family === "pinrow" ? "#eab308" : "#ef4444"} />
                      {family === "pinrow" && <circle cx={p.x} cy={-p.y} r={p.w * 0.27} fill="#090c10" />}
                    </g>
                  ) : (
                    <rect key={p.num} x={p.x - p.w / 2} y={-p.y - p.h / 2} width={p.w} height={p.h} rx={0.08} fill="#ef4444" />
                  ),
                )}
              </svg>
            </div>
          </div>
        )}

        {tab === "symbol" && (
          <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-5">
            <p className="text-xs leading-relaxed text-muted">
              Unggah file library simbol KiCad (<code>.kicad_sym</code>) dari situs pabrikan, SnapEDA, atau Ultra Librarian. Just Circuit akan mengekstrak daftar pinnya menggunakan <code>KicadSymbolToCircuitJsonConverter</code> dan membuat komponen siap pakai di <code>lib/parts/</code>.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <Field label="Nama Komponen (opsional)" placeholder="mis. STM32F103C8" value={symCustomName} onChange={(e) => setSymCustomName(e.target.value)} />
              </div>
              <Button variant="primary" onClick={() => symInputRef.current?.click()}>
                <Upload size={14} /> Unggah .kicad_sym
              </Button>
              <input
                ref={symInputRef}
                type="file"
                accept=".kicad_sym"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void handleSymbolUpload(file)
                }}
              />
            </div>
          </div>
        )}

        {tab === "panel" && (
          <div className="space-y-4 rounded-xl border border-line bg-surface/40 p-5">
            <p className="text-xs leading-relaxed text-muted">
              Buat file <code>panel.circuit.tsx</code> yang menggandakan board aktif menjadi panel produksi siap pabrik (V-Score atau Tab-Routing / Mouse-Bites) menggunakan primitif <code>&lt;panel&gt;</code> tscircuit.
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Kolom" type="number" min={1} max={10} value={panelCols} onChange={(e) => setPanelCols(Number(e.target.value) || 2)} />
              <Field label="Baris" type="number" min={1} max={10} value={panelRows} onChange={(e) => setPanelRows(Number(e.target.value) || 2)} />
              <Field label="Jarak antar board (mm)" type="number" step="0.5" value={panelSpacing} onChange={(e) => setPanelSpacing(Number(e.target.value) || 2.5)} />
              <SelectField
                label="Metode Pemisahan"
                options={[
                  { value: "tab-routing", label: "Tab-Routing (Mouse-bites)" },
                  { value: "v-score", label: "V-Score" },
                ]}
                value={panelMethod}
                onChange={(e) => setPanelMethod(e.target.value as "tab-routing" | "v-score")}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={panelRail} onChange={(e) => setPanelRail(e.target.checked)} className="size-4 accent-emerald-500" />
              Tambahkan Tooling Rail (5mm atas &amp; bawah untuk mesin SMT pick-and-place)
            </label>
            <Button variant="primary" onClick={() => void createPanelFile()}>
              <Grid2x2 size={14} /> Buat panel.circuit.tsx ({panelCols * panelRows} board)
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
