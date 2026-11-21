import { Flame, GitBranch, Grid3x3, Layers } from "lucide-react"
import { Button } from "../../ui"
import { GRID_OPTIONS } from "./constants"
import type { DiffPairForm, ZoneManager } from "./usePcbRules"
import type { PcbToolSettings, PcbViewOptions } from "./usePcbSettings"

interface PcbLayerControlsProps {
  settings: PcbToolSettings
  view: PcbViewOptions
  zones: ZoneManager
  diffPair: DiffPairForm
  pourCount: number
}

/** Zone / diff-pair / heatmap toggles, grid snap selector and copper layer visibility. */
export function PcbLayerControls({ settings, view, zones, diffPair, pourCount }: PcbLayerControlsProps) {
  return (
    <>
      <Button size="sm" variant={zones.open ? "primary" : "ghost"} onClick={zones.toggle} title="Kelola Copper Pour / Ground Plane">
        <Layers size={12} /> Zone ({pourCount})
      </Button>
      <Button size="sm" variant={diffPair.open ? "primary" : "ghost"} onClick={diffPair.toggle} title="Tambah Differential Pair (USB/CAN/Ethernet)">
        <GitBranch size={12} /> Diff-Pair
      </Button>
      <Button
        size="sm"
        variant={view.showHeatmap ? "primary" : "ghost"}
        onClick={() => view.setShowHeatmap((v) => !v)}
        title="Heatmap kapasitas arus IPC-2221 pada trace PCB"
      >
        <Flame size={12} className={view.showHeatmap ? "" : "text-warn"} /> Heatmap
      </Button>

      <label className="flex items-center gap-1 text-muted" title="Grid snap (mm)">
        <Grid3x3 size={13} />
        <select
          aria-label="Grid PCB"
          value={settings.gridMm}
          onChange={(e) => settings.setGridMm(Number(e.target.value))}
          className="h-7 rounded-md border border-line bg-surface px-1.5 font-mono text-[11px] text-ink"
        >
          {GRID_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {g}mm
            </option>
          ))}
        </select>
      </label>

      <div className="hidden items-center gap-1 xl:flex">
        <button
          type="button"
          aria-pressed={view.showTop}
          onClick={() => view.setShowTop((v) => !v)}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${view.showTop ? "border-red-500/50 bg-red-500/15 text-red-400" : "border-line text-muted line-through"}`}
        >
          F.Cu
        </button>
        <button
          type="button"
          aria-pressed={view.showBottom}
          onClick={() => view.setShowBottom((v) => !v)}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${view.showBottom ? "border-blue-500/50 bg-blue-500/15 text-blue-400" : "border-line text-muted line-through"}`}
        >
          B.Cu
        </button>
        <button
          type="button"
          aria-pressed={view.showRatsnest}
          onClick={() => view.setShowRatsnest((v) => !v)}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${view.showRatsnest ? "border-line bg-raised text-ink" : "border-line text-muted line-through"}`}
        >
          Ratsnest
        </button>
      </div>
    </>
  )
}
