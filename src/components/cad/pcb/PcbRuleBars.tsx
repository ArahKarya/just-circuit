import { Plus } from "lucide-react"
import type { CopperPourEntry } from "../../../lib/tsx-rules"
import { Button } from "../../ui"
import { LAYER_COLOR, POUR_FALLBACK_COLOR, type CopperLayer } from "./constants"
import type { DiffPairForm, ZoneManager } from "./usePcbRules"

const BAR_CLASS = "flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 text-xs"
const INPUT_CLASS = "h-7 rounded border border-line bg-panel px-2 font-mono text-xs text-ink"

interface PcbZoneBarProps {
  zones: ZoneManager
  pours: readonly CopperPourEntry[]
}

/** Collapsible copper pour / zone manager. */
export function PcbZoneBar({ zones, pours }: PcbZoneBarProps) {
  return (
    <div className={BAR_CLASS}>
      <span className="font-semibold text-ink">Copper Pour / Zone Manager:</span>
      <input
        aria-label="Net zone"
        value={zones.net}
        onChange={(e) => zones.setNet(e.target.value)}
        placeholder="GND"
        title="Nama net (ditulis sebagai net.GND) atau selector"
        className={`${INPUT_CLASS} w-24`}
      />
      <select
        aria-label="Layer zone"
        value={zones.layer}
        onChange={(e) => zones.setLayer(e.target.value as CopperLayer)}
        className="h-7 rounded border border-line bg-panel px-2 text-xs text-ink"
      >
        <option value="bottom">Bottom (B.Cu)</option>
        <option value="top">Top (F.Cu)</option>
      </select>
      <Button size="sm" variant="primary" onClick={zones.addZone}>
        <Plus size={12} /> Tambah Pour
      </Button>
      {pours.map((p, idx) => (
        <span key={idx} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-0.5 font-mono text-[11px]">
          <span className="size-2 rounded-full" style={{ background: LAYER_COLOR[p.layer] ?? POUR_FALLBACK_COLOR }} />
          {p.net} ({p.layer})
          <button type="button" className="text-muted hover:text-danger" onClick={() => zones.removeZone(p)}>
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

/** Collapsible differential pair constraint form. */
export function PcbDiffPairBar({ form }: { form: DiffPairForm }) {
  return (
    <div className={BAR_CLASS}>
      <span className="font-semibold text-ink">Differential Pair:</span>
      <input aria-label="Nama diff-pair" value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder="Nama (USB)" className={`${INPUT_CLASS} w-24`} />
      <input
        aria-label="Trace positif"
        value={form.positive}
        onChange={(e) => form.setPositive(e.target.value)}
        placeholder="Trace + (USB_DP)"
        title="Nama <trace> atau selector pin, mis. .J1 > .DP"
        className={`${INPUT_CLASS} w-28`}
      />
      <input
        aria-label="Trace negatif"
        value={form.negative}
        onChange={(e) => form.setNegative(e.target.value)}
        placeholder="Trace - (USB_DM)"
        title="Nama <trace> atau selector pin, mis. .J1 > .DM"
        className={`${INPUT_CLASS} w-28`}
      />
      <label className="flex items-center gap-1 text-muted">
        Skew maks
        <input
          type="number"
          step="0.01"
          value={form.skew}
          onChange={(e) => form.setSkew(e.target.value)}
          className="h-7 w-16 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink"
        />
        mm
      </label>
      <Button size="sm" variant="primary" onClick={form.addDiffPair}>
        Tambah &lt;differentialpair&gt;
      </Button>
    </div>
  )
}
