import { traceMaxCurrent } from "./constants"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbToolSettings } from "./usePcbSettings"

const SELECT_HINT = "Seret part · Alt+Klik multi-pilih · R putar · F balik layer · X trace 45° · H hole · D ukur · Shift+Seret geser kanvas"

function hintFor(settings: PcbToolSettings, drawing: PcbDrawing): string {
  const { tool, activeLayer, traceWidth, silkText } = settings
  switch (tool) {
    case "route":
      return `Trace 45° (${activeLayer}, ${traceWidth}mm, maks ${traceMaxCurrent(traceWidth)}A) · Tekan / balik postur · V tambah Via · Enter selesai`
    case "dimension":
      return drawing.dimStart ? "Klik titik akhir dimensi PCB (<pcbnotedimension>)" : "Klik titik awal dimensi PCB"
    case "cutout":
      return "Klik untuk menempatkan slot/cutout board"
    case "fiducial":
      return "Klik untuk menempatkan Fiducial marker SMT"
    case "testpoint":
      return "Klik untuk menempatkan Testpoint"
    case "silktext":
      return `Klik untuk menempatkan teks silkscreen "${silkText}"`
    default:
      return SELECT_HINT
  }
}

/** Bottom-left hint describing what a click does with the active tool. */
export function PcbStatusHint({ settings, drawing }: { settings: PcbToolSettings; drawing: PcbDrawing }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-3 rounded-lg border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur-xs">
      {hintFor(settings, drawing)}
    </div>
  )
}
