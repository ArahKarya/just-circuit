import { Circle, CircleDot, Crosshair, Layers, MousePointer2, Plus, Ruler, Scissors, Spline, SquareDashed, Type } from "lucide-react"
import { Button } from "../../ui"
import { LAYER_COLOR, WIDTH_OPTIONS, type PcbTool } from "./constants"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbToolSettings } from "./usePcbSettings"

const TOOLS = [
  ["select", "Pilih (V)", MousePointer2],
  ["route", "Copper Trace 45° (X)", Spline],
  ["via", "Via", CircleDot],
  ["hole", "Hole (H)", Circle],
  ["cutout", "Cutout", Scissors],
  ["fiducial", "Fiducial", Crosshair],
  ["testpoint", "Testpoint", Plus],
  ["silktext", "Silkscreen", Type],
  ["dimension", "Dimensi", SquareDashed],
  ["measure", "Ukur (D)", Ruler],
] as const

interface PcbToolPaletteProps {
  settings: PcbToolSettings
  drawing: PcbDrawing
}

/** Tool buttons followed by the contextual route/via and silkscreen inputs. */
export function PcbToolPalette({ settings, drawing }: PcbToolPaletteProps) {
  const { tool, setTool } = settings
  const pickTool = (id: PcbTool) => {
    setTool(id)
    drawing.resetDrawing()
  }
  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Alat PCB">
        {TOOLS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            title={label}
            onClick={() => pickTool(id)}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition ${
              tool === id ? "bg-accent text-accent-ink" : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            <Icon size={13} />
            <span className="hidden 2xl:inline">{label.split(" (")[0]}</span>
          </button>
        ))}
      </div>

      {(tool === "route" || tool === "via") && <RouteOptions settings={settings} drawing={drawing} />}

      {tool === "silktext" && (
        <input
          aria-label="Teks silkscreen"
          value={settings.silkText}
          onChange={(e) => settings.setSilkText(e.target.value)}
          placeholder="Teks silkscreen"
          className="h-7 w-28 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink"
        />
      )}
    </>
  )
}

function RouteOptions({ settings, drawing }: PcbToolPaletteProps) {
  const { tool, activeLayer, setActiveLayer, traceWidth, setTraceWidth, miter45, setMiter45, traceNet, setTraceNet } = settings
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2 py-0.5">
      <button
        type="button"
        onClick={() => setActiveLayer((l) => (l === "top" ? "bottom" : "top"))}
        className="flex items-center gap-1 font-mono text-[11px] font-semibold"
        style={{ color: LAYER_COLOR[activeLayer] }}
        title="Ganti layer tembaga (Top / Bottom)"
      >
        <Layers size={12} /> {activeLayer === "top" ? "F.Cu" : "B.Cu"}
      </button>
      {tool === "route" && (
        <>
          <select
            aria-label="Lebar trace"
            value={traceWidth}
            onChange={(e) => setTraceWidth(Number(e.target.value))}
            className="h-6 rounded border border-line bg-panel px-1 font-mono text-[11px] text-ink"
          >
            {WIDTH_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}mm
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMiter45((v) => !v)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${miter45 ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted"}`}
            title="Sudut 45° otomatis (tekan / saat routing untuk balik postur)"
          >
            45°
          </button>
        </>
      )}
      <input
        aria-label="Nama net trace"
        value={traceNet}
        onChange={(e) => setTraceNet(e.target.value)}
        placeholder="Net"
        className="h-6 w-20 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-ink"
      />
      {tool === "route" && drawing.routePts.length >= 2 && (
        <Button size="sm" variant="primary" className="min-h-6 px-2 py-0 text-[11px]" onClick={drawing.commitCurrentRoute}>
          Simpan ({drawing.activeRouteLenMm.toFixed(1)}mm)
        </Button>
      )}
    </div>
  )
}
