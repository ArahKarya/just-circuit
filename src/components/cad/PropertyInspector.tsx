import { Code2, Copy, FlipHorizontal2, Lock, RotateCw, Sparkles, Trash2, Unlock, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { ComponentSummary, PropPatchValue } from "../../lib/tsx-ast"
import { Button, IconButton } from "../ui"

interface PropertyInspectorProps {
  component: ComponentSummary | null
  mode: "schematic" | "pcb"
  locked?: boolean
  onToggleLock?: (name: string) => void
  onDuplicate?: (name: string) => void
  onRevealCode?: (name: string) => void
  onPatch: (name: string, patch: Record<string, PropPatchValue>) => void
  onDelete: (name: string) => void
  onAskAi?: (componentName: string) => void
  onClose: () => void
}

const VALUE_PROP_FOR_TAG: Record<string, { prop: string; label: string; placeholder: string }> = {
  resistor: { prop: "resistance", label: "Resistansi", placeholder: "10k" },
  capacitor: { prop: "capacitance", label: "Kapasitansi", placeholder: "100nF" },
  inductor: { prop: "inductance", label: "Induktansi", placeholder: "10uH" },
  led: { prop: "color", label: "Warna", placeholder: "red" },
  crystal: { prop: "frequency", label: "Frekuensi", placeholder: "16MHz" },
}

const INPUT =
  "h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink font-mono focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"

export function PropertyInspector({
  component,
  mode,
  locked = false,
  onToggleLock,
  onDuplicate,
  onRevealCode,
  onPatch,
  onDelete,
  onAskAi,
  onClose,
}: PropertyInspectorProps) {
  const [value, setValue] = useState("")
  const [footprint, setFootprint] = useState("")
  const [mpn, setMpn] = useState("")
  const [posX, setPosX] = useState("")
  const [posY, setPosY] = useState("")
  const [rotation, setRotation] = useState("")

  const formX = component ? (mode === "schematic" ? component.schX : component.pcbX) : undefined
  const formY = component ? (mode === "schematic" ? component.schY : component.pcbY) : undefined
  const formRot = component ? (mode === "schematic" ? component.schRotation : component.pcbRotation) : undefined
  const formKey = component
    ? [component.name, mode, component.value, component.footprint, component.manufacturerPartNumber, formX, formY, formRot].join("|")
    : ""

  useEffect(() => {
    if (!component) return
    setValue(component.value ?? "")
    setFootprint(component.footprint ?? "")
    setMpn(component.manufacturerPartNumber ?? "")
    setPosX(formX !== undefined ? String(formX) : "")
    setPosY(formY !== undefined ? String(formY) : "")
    setRotation(formRot !== undefined ? String(formRot) : "0")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey])

  if (!component) {
    return (
      <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-panel p-4 text-xs text-muted">
        <p className="font-semibold text-ink">Inspektor Properti</p>
        <p className="mt-2 leading-relaxed">
          Klik komponen di kanvas untuk melihat dan mengubah propertinya langsung ke kode TSX.
        </p>
      </aside>
    )
  }

  const valueMeta = VALUE_PROP_FOR_TAG[component.tagName]
  const xProp = mode === "schematic" ? "schX" : "pcbX"
  const yProp = mode === "schematic" ? "schY" : "pcbY"
  const rotProp = mode === "schematic" ? "schRotation" : "pcbRotation"

  const applyForm = () => {
    const patch: Record<string, PropPatchValue> = {}
    if (valueMeta && value.trim() !== (component.value ?? "")) {
      patch[valueMeta.prop] = value.trim() || undefined
    }
    if (footprint.trim() !== (component.footprint ?? "")) {
      patch.footprint = footprint.trim() || undefined
    }
    if (mpn.trim() !== (component.manufacturerPartNumber ?? "")) {
      patch.manufacturerPartNumber = mpn.trim() || undefined
    }
    const changedNumber = (text: string, current: number | undefined, fallback?: number) => {
      const n = Number.parseFloat(text)
      if (text.trim() === "" || !Number.isFinite(n)) return undefined
      return n === (current ?? fallback) ? undefined : n
    }
    const nx = changedNumber(posX, formX)
    if (nx !== undefined) patch[xProp] = nx
    const ny = changedNumber(posY, formY)
    if (ny !== undefined) patch[yProp] = ny
    const nr = changedNumber(rotation, formRot, 0)
    if (nr !== undefined) patch[rotProp] = nr
    if (Object.keys(patch).length > 0) onPatch(component.name, patch)
  }

  const rotate90 = () => {
    const current = (mode === "schematic" ? component.schRotation : component.pcbRotation) ?? 0
    onPatch(component.name, { [rotProp]: (current + 90) % 360 })
  }

  const flipLayer = () => {
    const nextLayer = component.layer === "bottom" ? "top" : "bottom"
    onPatch(component.name, { layer: nextLayer })
  }

  return (
    <aside aria-label="Inspektor properti" className="flex w-64 shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line bg-surface/40 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold text-ink">{component.name}</span>
            <span className="rounded bg-raised px-1.5 py-0.2 font-mono text-[10px] text-muted">&lt;{component.tagName}&gt;</span>
          </div>
          <p className="truncate font-mono text-[10px] text-muted">{component.path}</p>
        </div>
        <IconButton label="Tutup inspektor" className="size-7" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>

      <form
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs"
        onSubmit={(e) => {
          e.preventDefault()
          applyForm()
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={rotate90} title="Putar 90° (R)">
            <RotateCw size={12} /> 90°
          </Button>
          {mode === "pcb" && (
            <Button size="sm" onClick={flipLayer} title="Balik layer Top/Bottom (F)">
              <FlipHorizontal2 size={12} /> {component.layer === "bottom" ? "Bottom" : "Top"}
            </Button>
          )}
          {onToggleLock && (
            <Button
              size="sm"
              variant={locked ? "primary" : "ghost"}
              onClick={() => onToggleLock(component.name)}
              title="Kunci agar AI tidak mengubah komponen ini"
            >
              {locked ? <Lock size={12} /> : <Unlock size={12} />}
              {locked ? "Terkunci" : "Kunci"}
            </Button>
          )}
          {onDuplicate && (
            <Button size="sm" onClick={() => onDuplicate(component.name)} title="Duplikat komponen">
              <Copy size={12} /> Duplikat
            </Button>
          )}
          {onRevealCode && (
            <Button size="sm" onClick={() => onRevealCode(component.name)} title="Loncat ke deklarasi di kode">
              <Code2 size={12} /> Kode
            </Button>
          )}
        </div>

        {valueMeta && (
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted">{valueMeta.label}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={valueMeta.placeholder} className={INPUT} />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted">Footprint</span>
          <input value={footprint} onChange={(e) => setFootprint(e.target.value)} placeholder="mis. 0603, soic8" className={INPUT} />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted">Part Number (MPN)</span>
          <input value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="mis. AMS1117-3.3" className={INPUT} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted">{xProp}</span>
            <input type="number" step="0.5" value={posX} onChange={(e) => setPosX(e.target.value)} className={INPUT} />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted">{yProp}</span>
            <input type="number" step="0.5" value={posY} onChange={(e) => setPosY(e.target.value)} className={INPUT} />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted">Rotasi ({rotProp})</span>
          <input type="number" step="45" value={rotation} onChange={(e) => setRotation(e.target.value)} className={INPUT} />
        </label>

        <Button size="sm" variant="primary" type="submit" className="w-full">
          Terapkan ke kode
        </Button>

        <div className="space-y-1.5 border-t border-line pt-3">
          {onAskAi && (
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onAskAi(component.name)}>
              <Sparkles size={12} className="text-accent" /> Minta AI ubah {component.name}
            </Button>
          )}
          <Button size="sm" variant="danger" className="w-full" onClick={() => onDelete(component.name)}>
            <Trash2 size={12} /> Hapus komponen
          </Button>
        </div>
      </form>
    </aside>
  )
}
