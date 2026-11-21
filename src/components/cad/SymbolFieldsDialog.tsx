import { Code2, ListOrdered, Save, Search } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { autoAnnotateProject, listComponents, patchComponentProps, type PropPatchValue } from "../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, Modal } from "../ui"

interface SymbolFieldsDialogProps {
  project: Project
  onCommitFiles: (nextFiles: ProjectFiles) => void
  onRevealComponent: (name: string) => void
  onClose: () => void
}

const VALUE_PROP: Record<string, string> = {
  resistor: "resistance",
  capacitor: "capacitance",
  inductor: "inductance",
  led: "color",
  crystal: "frequency",
}

interface RowDraft {
  value: string
  footprint: string
  mpn: string
  layer: string
}

export function SymbolFieldsDialog({ project, onCommitFiles, onRevealComponent, onClose }: SymbolFieldsDialogProps) {
  const components = useMemo(() => listComponents(project.files), [project.files])
  const [query, setQuery] = useState("")
  const [bulkFootprint, setBulkFootprint] = useState("")
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})

  const getDraft = (name: string): RowDraft => {
    const existing = drafts[name]
    if (existing) return existing
    const comp = components.find((c) => c.name === name)
    return {
      value: comp?.value ?? "",
      footprint: comp?.footprint ?? "",
      mpn: comp?.manufacturerPartNumber ?? "",
      layer: comp?.layer ?? "top",
    }
  }

  const updateRow = (name: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({ ...prev, [name]: { ...getDraft(name), ...patch } }))
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    return components.filter((c) =>
      `${c.name} ${c.tagName} ${c.value ?? ""} ${c.footprint ?? ""} ${c.manufacturerPartNumber ?? ""}`.toLowerCase().includes(q),
    )
  }, [components, query])

  const dirtyCount = Object.keys(drafts).length

  const applyBulkFootprint = () => {
    const fp = bulkFootprint.trim()
    if (!fp || visible.length === 0) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const comp of visible) {
        next[comp.name] = { ...(prev[comp.name] ?? getDraft(comp.name)), footprint: fp }
      }
      return next
    })
    toast.success(`Footprint "${fp}" disiapkan untuk ${visible.length} komponen (klik Simpan)`)
  }

  const saveAll = () => {
    let files: ProjectFiles = project.files
    let changed = 0
    const skipped: string[] = []
    for (const [name, row] of Object.entries(drafts)) {
      const comp = components.find((c) => c.name === name)
      if (!comp) continue
      const patch: Record<string, PropPatchValue> = {}
      const valProp = VALUE_PROP[comp.tagName]
      if (valProp && row.value.trim() !== (comp.value ?? "")) patch[valProp] = row.value.trim() || undefined
      if (row.footprint.trim() !== (comp.footprint ?? "")) patch.footprint = row.footprint.trim() || undefined
      if (row.mpn.trim() !== (comp.manufacturerPartNumber ?? "")) patch.manufacturerPartNumber = row.mpn.trim() || undefined
      if (row.layer !== (comp.layer ?? "top")) patch.layer = row.layer === "top" ? undefined : row.layer
      if (Object.keys(patch).length === 0) continue
      const res = patchComponentProps(files, name, patch)
      if (res.status === "updated") {
        files = res.files
        changed += 1
      } else if (res.status === "unsupported") {
        skipped.push(`${name}.${res.prop}`)
      }
    }
    if (changed > 0) {
      onCommitFiles(files)
      setDrafts({})
      toast.success(`${changed} komponen diperbarui ke kode TSX${skipped.length ? ` (${skipped.length} ekspresi dilewati)` : ""}`)
    } else if (skipped.length > 0) {
      toast.error(`Tidak bisa mengubah prop dinamis: ${skipped.join(", ")}`)
    } else {
      toast("Tidak ada perubahan untuk disimpan")
    }
  }

  const runAutoAnnotate = () => {
    const res = autoAnnotateProject(project.files)
    if (res.renamed.length === 0) {
      toast("Semua designator sudah berurutan (R1..Rn, C1..Cn, …)")
      return
    }
    onCommitFiles(res.files)
    setDrafts({})
    const preview = res.renamed.slice(0, 4).map((r) => `${r.from}→${r.to}`).join(", ")
    toast.success(`${res.renamed.length} designator dirapikan (${preview}${res.renamed.length > 4 ? ", …" : ""})`)
  }

  return (
    <Modal
      title="Tabel Properti Komponen (Bulk Edit)"
      subtitle="Edit massal nilai, footprint, MPN, dan layer seperti KiCad Symbol Fields Table"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={runAutoAnnotate} title="Urutkan ulang R1..Rn, C1..Cn, U1..Un berdasarkan posisi">
            <ListOrdered size={14} /> Auto-Annotate
          </Button>
          <Button onClick={onClose}>Tutup</Button>
          <Button variant="primary" disabled={dirtyCount === 0} onClick={saveAll}>
            <Save size={14} /> Simpan ({dirtyCount})
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Saring komponen"
              placeholder="Saring nama, tipe, nilai, footprint, MPN…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-muted/55 focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <input
              aria-label="Footprint massal"
              placeholder="Ubah footprint terfilter (mis. 0603)"
              value={bulkFootprint}
              onChange={(e) => setBulkFootprint(e.target.value)}
              className="h-9 w-52 rounded-lg border border-line bg-surface px-2.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            />
            <Button size="sm" disabled={!bulkFootprint.trim() || visible.length === 0} onClick={applyBulkFootprint}>
              Terapkan ke {visible.length}
            </Button>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-line bg-surface/40">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-line bg-panel text-[11px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Ref</th>
                <th className="px-3 py-2 font-medium">Tipe</th>
                <th className="px-3 py-2 font-medium">Nilai</th>
                <th className="px-3 py-2 font-medium">Footprint</th>
                <th className="px-3 py-2 font-medium">MPN</th>
                <th className="px-3 py-2 font-medium">Layer</th>
                <th className="px-2 py-2 font-medium text-right">Kode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((comp) => {
                const row = getDraft(comp.name)
                const isDirty = drafts[comp.name] !== undefined
                return (
                  <tr key={`${comp.path}:${comp.name}`} className={isDirty ? "bg-accent/6" : "hover:bg-raised/35"}>
                    <td className="px-3 py-1.5 font-mono font-semibold text-ink">{comp.name}</td>
                    <td className="px-3 py-1.5 font-mono text-muted">{comp.tagName}</td>
                    <td className="px-2 py-1.5">
                      {VALUE_PROP[comp.tagName] ? (
                        <input
                          value={row.value}
                          onChange={(e) => updateRow(comp.name, { value: e.target.value })}
                          className="h-7 w-24 rounded border border-line bg-surface px-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      ) : (
                        <span className="px-1.5 text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.footprint}
                        onChange={(e) => updateRow(comp.name, { footprint: e.target.value })}
                        className="h-7 w-28 rounded border border-line bg-surface px-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.mpn}
                        onChange={(e) => updateRow(comp.name, { mpn: e.target.value })}
                        placeholder="—"
                        className="h-7 w-36 rounded border border-line bg-surface px-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.layer}
                        onChange={(e) => updateRow(comp.name, { layer: e.target.value })}
                        className="h-7 rounded border border-line bg-surface px-1.5 text-xs text-ink"
                      >
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        title={`Loncat ke ${comp.name} di kode`}
                        onClick={() => {
                          onRevealComponent(comp.name)
                          onClose()
                        }}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-accent"
                      >
                        <Code2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Tidak ada komponen ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}
