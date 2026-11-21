import { CheckCircle2, Download } from "lucide-react"
import { useMemo, useState } from "react"
import { extractPcbScene } from "../../lib/circuit-extract"
import { toCsv } from "../../lib/csv"
import { safeFileSlug } from "../../lib/file-name"
import { listComponents } from "../../lib/tsx-ast"
import type { Project } from "../../lib/types"
import { Button, Modal } from "../ui"

interface InteractiveBomDialogProps {
  project: Project
  circuitJson: unknown[]
  onRevealComponent: (name: string) => void
  onClose: () => void
}

interface BomGroup {
  key: string
  tagName: string
  value: string
  footprint: string
  mpn: string
  refs: string[]
}

function downloadCsv(filename: string, rows: string[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function InteractiveBomDialog({ project, circuitJson, onRevealComponent, onClose }: InteractiveBomDialogProps) {
  const pcb = useMemo(() => extractPcbScene(circuitJson), [circuitJson])
  const codeComps = useMemo(() => listComponents(project.files), [project.files])
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [placedRefs, setPlacedRefs] = useState<Set<string>>(() => new Set())
  const [sideFilter, setSideFilter] = useState<"all" | "top" | "bottom">("all")

  const groups = useMemo<BomGroup[]>(() => {
    const map = new Map<string, BomGroup>()
    for (const comp of codeComps) {
      const layer = comp.layer ?? "top"
      if (sideFilter !== "all" && layer !== sideFilter) continue
      const val = comp.value ?? ""
      const fp = comp.footprint ?? ""
      const mpn = comp.manufacturerPartNumber ?? ""
      const key = `${comp.tagName}|${val}|${fp}|${mpn}`
      const existing = map.get(key)
      if (existing) existing.refs.push(comp.name)
      else map.set(key, { key, tagName: comp.tagName, value: val, footprint: fp, mpn, refs: [comp.name] })
    }
    return [...map.values()].sort((a, b) => b.refs.length - a.refs.length)
  }, [codeComps, sideFilter])

  const highlightedRefs = useMemo(() => {
    const group = groups.find((g) => g.key === selectedGroupKey)
    return new Set(group?.refs ?? [])
  }, [groups, selectedGroupKey])

  const totalParts = groups.reduce((acc, g) => acc + g.refs.length, 0)
  const placedCount = groups.reduce((acc, g) => acc + g.refs.filter((r) => placedRefs.has(r)).length, 0)

  const toggleGroupPlaced = (group: BomGroup) => {
    const allPlaced = group.refs.every((r) => placedRefs.has(r))
    setPlacedRefs((prev) => {
      const next = new Set(prev)
      for (const r of group.refs) {
        if (allPlaced) next.delete(r)
        else next.add(r)
      }
      return next
    })
  }

  const exportBom = () => {
    const rows = [
      ["Designator", "Qty", "Type", "Value", "Footprint", "MPN"],
      ...groups.map((g) => [g.refs.join(" "), String(g.refs.length), g.tagName, g.value, g.footprint, g.mpn]),
    ]
    downloadCsv(`${safeFileSlug(project.name)}-bom.csv`, rows)
  }

  const exportCpl = () => {
    const rows = [
      ["Designator", "Mid X (mm)", "Mid Y (mm)", "Layer", "Rotation"],
      ...pcb.components.map((c) => [c.name, c.x.toFixed(2), c.y.toFixed(2), c.layer, String(c.rotation)]),
    ]
    downloadCsv(`${safeFileSlug(project.name)}-cpl.csv`, rows)
  }

  // Fit PCB into SVG viewBox
  const bw = Math.max(10, pcb.board.width)
  const bh = Math.max(10, pcb.board.height)
  const pad = Math.max(bw, bh) * 0.12
  const viewBox = `${pcb.board.center.x - bw / 2 - pad} ${-(pcb.board.center.y + bh / 2) - pad} ${bw + pad * 2} ${bh + pad * 2}`

  return (
    <Modal
      title="Interactive BOM & Peta Perakitan"
      subtitle="Klik baris BOM untuk menyorot semua lokasi komponen di PCB dan tandai yang sudah disolder"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={exportBom}>
            <Download size={14} /> Unduh BOM CSV
          </Button>
          <Button onClick={exportCpl}>
            <Download size={14} /> Unduh CPL (Pick &amp; Place)
          </Button>
          <Button variant="primary" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5 text-xs">
            {(["all", "top", "bottom"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setSideFilter(side)}
                className={`rounded-md px-2.5 py-1 font-medium ${sideFilter === side ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
              >
                {side === "all" ? "Semua Sisi" : side === "top" ? "Top (F.Cu)" : "Bottom (B.Cu)"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
            <CheckCircle2 size={14} className="text-accent" />
            <span>
              Tersolder: <strong className="text-ink">{placedCount}</strong> / {totalParts} part
            </span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* BOM table */}
          <div className="max-h-[54vh] overflow-auto rounded-xl border border-line bg-surface/40">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-line bg-panel text-[11px] text-muted">
                <tr>
                  <th className="px-2.5 py-2">✓</th>
                  <th className="px-2.5 py-2">Qty</th>
                  <th className="px-2.5 py-2">Komponen</th>
                  <th className="px-2.5 py-2">Nilai / MPN</th>
                  <th className="px-2.5 py-2">Footprint</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {groups.map((g) => {
                  const active = g.key === selectedGroupKey
                  const done = g.refs.every((r) => placedRefs.has(r))
                  return (
                    <tr
                      key={g.key}
                      onClick={() => setSelectedGroupKey(active ? null : g.key)}
                      className={`cursor-pointer transition ${active ? "bg-accent/15" : done ? "opacity-55 hover:opacity-80" : "hover:bg-raised/40"}`}
                    >
                      <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={done} onChange={() => toggleGroupPlaced(g)} className="size-3.5 accent-emerald-500" />
                      </td>
                      <td className="px-2.5 py-2 font-mono font-semibold text-accent tabular-nums">{g.refs.length}</td>
                      <td className="px-2.5 py-2 font-mono text-ink">{g.refs.join(", ")}</td>
                      <td className="px-2.5 py-2 font-mono text-muted">{g.value || g.mpn || g.tagName}</td>
                      <td className="px-2.5 py-2 font-mono text-muted">{g.footprint || "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Interactive PCB Locator Map */}
          <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-[#090c10]">
            <div className="border-b border-line bg-panel px-3 py-1.5 text-[11px] text-muted">
              Peta Lokasi PCB — klik komponen untuk loncat ke kode
            </div>
            <svg viewBox={viewBox} className="h-[48vh] w-full">
              <rect
                x={pcb.board.center.x - bw / 2}
                y={-(pcb.board.center.y + bh / 2)}
                width={bw}
                height={bh}
                fill="#0f1f17"
                stroke="#eab308"
                strokeWidth={Math.max(0.15, bw * 0.008)}
              />
              {pcb.components.map((comp) => {
                if (sideFilter !== "all" && comp.layer !== sideFilter) return null
                const isHighlighted = highlightedRefs.has(comp.name)
                const isDone = placedRefs.has(comp.name)
                return (
                  <g
                    key={comp.id}
                    className="cursor-pointer"
                    onClick={() => {
                      onRevealComponent(comp.name)
                      onClose()
                    }}
                  >
                    <rect
                      x={comp.x - comp.width / 2}
                      y={-comp.y - comp.height / 2}
                      width={comp.width}
                      height={comp.height}
                      rx={0.2}
                      fill={isHighlighted ? "rgba(16,185,129,0.55)" : isDone ? "rgba(148,163,184,0.2)" : "rgba(239,68,68,0.22)"}
                      stroke={isHighlighted ? "#34d399" : isDone ? "#475569" : "#e2e8f0"}
                      strokeWidth={isHighlighted ? Math.max(0.25, bw * 0.012) : Math.max(0.08, bw * 0.004)}
                    />
                    <text
                      x={comp.x}
                      y={-comp.y + 0.3}
                      textAnchor="middle"
                      fill={isHighlighted ? "#ffffff" : "#cbd5e1"}
                      fontSize={Math.max(0.8, Math.min(2, bw * 0.035))}
                      fontFamily="var(--font-mono)"
                      fontWeight={isHighlighted ? 700 : 500}
                    >
                      {comp.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </Modal>
  )
}
