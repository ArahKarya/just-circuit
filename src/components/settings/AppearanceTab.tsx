import type { Dispatch, SetStateAction } from "react"
import type { Preferences, PreviewTab, ThemeSetting } from "../../lib/types"
import { Field, SelectField } from "../ui"

interface AppearanceTabProps {
  draft: Preferences
  setDraft: Dispatch<SetStateAction<Preferences>>
}

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "dark", label: "Gelap" },
  { value: "light", label: "Terang" },
  { value: "system", label: "Ikuti sistem" },
]

const PREVIEW_TABS: { value: PreviewTab; label: string }[] = [
  { value: "pcb", label: "PCB" },
  { value: "schematic", label: "Skematik" },
  { value: "cad", label: "3D" },
  { value: "bom", label: "BOM" },
]

function clampInt(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-emerald-500" />
      {label}
    </label>
  )
}

export function AppearanceTab({ draft, setDraft }: AppearanceTabProps) {
  const setEditor = (patch: Partial<Preferences["editor"]>) => setDraft((d) => ({ ...d, editor: { ...d.editor, ...patch } }))
  const setPreview = (patch: Partial<Preferences["preview"]>) => setDraft((d) => ({ ...d, preview: { ...d.preview, ...patch } }))

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Tema" options={THEMES} value={draft.theme} onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as ThemeSetting }))} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Editor kode</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ukuran font" type="number" min={10} max={24} value={draft.editor.fontSize} onChange={(e) => setEditor({ fontSize: clampInt(e.target.valueAsNumber, 10, 24, 13) })} />
          <SelectField
            label="Lebar tab"
            options={[{ value: "2", label: "2 spasi" }, { value: "4", label: "4 spasi" }]}
            value={String(draft.editor.tabSize)}
            onChange={(e) => setEditor({ tabSize: e.target.value === "4" ? 4 : 2 })}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Toggle label="Bungkus baris panjang" checked={draft.editor.wordWrap} onChange={(wordWrap) => setEditor({ wordWrap })} />
          <Toggle label="Nomor baris" checked={draft.editor.lineNumbers} onChange={(lineNumbers) => setEditor({ lineNumbers })} />
          <Toggle label="Minimap" checked={draft.editor.minimap} onChange={(minimap) => setEditor({ minimap })} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Preview</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Jeda sebelum build ulang (ms)"
            type="number"
            min={200}
            max={5000}
            step={100}
            hint="Naikkan untuk desain besar supaya tidak build di tiap ketikan."
            value={draft.preview.debounceMs}
            onChange={(e) => setPreview({ debounceMs: clampInt(e.target.valueAsNumber, 200, 5000, 700) })}
          />
          <SelectField label="Tab awal preview" options={PREVIEW_TABS} value={draft.preview.defaultTab} onChange={(e) => setPreview({ defaultTab: e.target.value as PreviewTab })} />
        </div>
      </section>
    </div>
  )
}
