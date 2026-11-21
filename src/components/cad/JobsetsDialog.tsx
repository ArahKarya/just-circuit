import JSZip from "jszip"
import { CheckCircle2, CircleAlert, Download, PackageCheck, Terminal, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { api } from "../../lib/api"
import { extractPcbScene } from "../../lib/circuit-extract"
import { simulateCircuit } from "../../lib/circuit-sim"
import type { DesignIssue } from "../../lib/drc"
import { runExtendedErc } from "../../lib/erc"
import { useLiveData } from "../../lib/live-data"
import { listComponents } from "../../lib/tsx-ast"
import type { Project } from "../../lib/types"
import { Button, Modal } from "../ui"

interface JobsetsDialogProps {
  project: Project
  circuitJson: unknown[]
  drcIssues: readonly DesignIssue[]
  onClose: () => void
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
}

export function JobsetsDialog({ project, circuitJson, drcIssues, onClose }: JobsetsDialogProps) {
  const kicadCli = useLiveData(() => api.get<{ available: boolean; version: string | null }>("/api/kicad-cli/status"), ["kicad-cli-status"])
  const [includeBom, setIncludeBom] = useState(true)
  const [includeCpl, setIncludeCpl] = useState(true)
  const [includeCircuitJson, setIncludeCircuitJson] = useState(true)
  const [includeReport, setIncludeReport] = useState(true)
  const [includeSource, setIncludeSource] = useState(true)
  const [building, setBuilding] = useState(false)

  const pcb = useMemo(() => extractPcbScene(circuitJson), [circuitJson])
  const codeComps = useMemo(() => listComponents(project.files), [project.files])
  const ercIssues = useMemo(() => runExtendedErc(project.files, circuitJson), [project.files, circuitJson])
  const simReport = useMemo(() => simulateCircuit(circuitJson), [circuitJson])

  const drcErrors = drcIssues.filter((i) => i.severity === "error").length
  const ercErrors = ercIssues.filter((i) => i.severity === "error").length
  const simErrors = simReport.findings.filter((f) => f.severity === "error").length
  const allGreen = drcErrors === 0 && ercErrors === 0 && simErrors === 0

  const runJobset = async () => {
    setBuilding(true)
    try {
      const zip = new JSZip()
      const slug = project.name.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase() || "board"

      if (includeBom) {
        const bomRows = [
          ["Designator", "Type", "Value", "Footprint", "MPN", "Layer"],
          ...codeComps.map((c) => [c.name, c.tagName, c.value ?? "", c.footprint ?? "", c.manufacturerPartNumber ?? "", c.layer ?? "top"]),
        ]
        zip.file("manufacturing/bom.csv", toCsv(bomRows))
      }

      if (includeCpl) {
        const cplRows = [
          ["Designator", "Mid X (mm)", "Mid Y (mm)", "Layer", "Rotation"],
          ...pcb.components.map((c) => [c.name, c.x.toFixed(3), c.y.toFixed(3), c.layer, String(c.rotation)]),
        ]
        zip.file("manufacturing/cpl-pick-and-place.csv", toCsv(cplRows))
      }

      if (includeCircuitJson) {
        zip.file("manufacturing/circuit.json", JSON.stringify(circuitJson, null, 2))
      }

      if (includeReport) {
        zip.file(
          "verification/report.json",
          JSON.stringify(
            {
              project: project.name,
              generatedAt: new Date().toISOString(),
              boardMm: { width: pcb.board.width, height: pcb.board.height },
              drcIssues,
              ercIssues,
              electricalSimulation: {
                ok: simReport.ok,
                totalCurrentMa: simReport.totalCurrentMa,
                totalPowerMw: simReport.totalPowerMw,
                findings: simReport.findings,
              },
            },
            null,
            2,
          ),
        )
      }

      if (includeSource) {
        for (const [path, content] of Object.entries(project.files)) {
          zip.file(`source/${path}`, content)
        }
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${slug}-production-jobset.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success("Paket Jobset produksi berhasil diunduh")
    } finally {
      setBuilding(false)
    }
  }

  return (
    <Modal
      title="Output Jobsets & Paket Produksi (KiCad 9)"
      subtitle="Verifikasi DRC + ERC + Simulasi Listrik sekaligus dan ekspor paket produksi dalam 1 ZIP"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Tutup</Button>
          <Button variant="primary" disabled={building} onClick={() => void runJobset()}>
            <Download size={14} /> Jalankan Jobset &amp; Unduh ZIP
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Verification Gates */}
        <div className="grid gap-2.5 sm:grid-cols-3">
          <GateCard label="DRC / Build" errors={drcErrors} total={drcIssues.length} />
          <GateCard label="Extended ERC" errors={ercErrors} total={ercIssues.length} />
          <GateCard label="Simulasi Arus DC" errors={simErrors} total={simReport.findings.length} />
        </div>

        {!allGreen && (
          <p className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-xs text-warn">
            <TriangleAlert size={15} className="shrink-0" />
            Masih terdapat error pada pemeriksaan. Disarankan memperbaiki error sebelum mengirim file ke pabrik PCB.
          </p>
        )}

        {/* Output selections */}
        <section className="space-y-2.5 rounded-xl border border-line bg-surface/40 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <PackageCheck size={15} className="text-accent" /> File dalam Paket Jobset
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <CheckRow label="BOM CSV (Bill of Materials)" checked={includeBom} onChange={setIncludeBom} />
            <CheckRow label="CPL CSV (Pick & Place / Centroid)" checked={includeCpl} onChange={setIncludeCpl} />
            <CheckRow label="Circuit JSON (untuk Gerber/KiCad/STEP)" checked={includeCircuitJson} onChange={setIncludeCircuitJson} />
            <CheckRow label="Laporan Verifikasi (DRC + ERC + Simulasi)" checked={includeReport} onChange={setIncludeReport} />
            <CheckRow label="Source Code TSX + manual-edits.json" checked={includeSource} onChange={setIncludeSource} />
          </div>
          <p className="text-[11px] text-muted">
            Catatan: untuk file Gerber/KiCad/STEP langsung, gunakan juga menu <strong>File → Export</strong> pada panel preview RunFrame.
          </p>
        </section>

        {/* Optional server kicad-cli detection */}
        <section className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/40 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Terminal size={15} className="text-accent" />
            <div>
              <p className="font-semibold text-ink">Integrasi KiCad CLI di Server</p>
              <p className="text-muted">
                {kicadCli.data?.available
                  ? `kicad-cli terdeteksi (${kicadCli.data.version ?? "tersedia"}) — siap dipakai dari Terminal untuk DRC/Gerber native KiCad.`
                  : "kicad-cli tidak terpasang di mesin server (opsional). Pasang KiCad 8/9 di server untuk verifikasi native via terminal."}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium ${
              kicadCli.data?.available ? "bg-accent/15 text-accent" : "bg-raised text-muted"
            }`}
          >
            {kicadCli.data?.available ? "Aktif" : "Opsional"}
          </span>
        </section>
      </div>
    </Modal>
  )
}

function GateCard({ label, errors, total }: { label: string; errors: number; total: number }) {
  const ok = errors === 0
  return (
    <div className={`rounded-xl border p-3 ${ok ? "border-accent/25 bg-accent/8" : "border-danger/35 bg-danger/8"}`}>
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${ok ? "text-accent" : "text-danger"}`}>
        {ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
        {ok ? (total > 0 ? `Lulus (${total} info/warn)` : "Lulus") : `${errors} Error`}
      </p>
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-ink hover:border-accent/40">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-emerald-500" />
      {label}
    </label>
  )
}
