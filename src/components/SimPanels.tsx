import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import type { ParsedNumber } from "../lib/numeric-input"
import type { SimMessages } from "../lib/spice-sim"

interface SimNumberInputProps {
  label: string
  unit: string
  value: string
  parsed: ParsedNumber
  onChange: (raw: string) => void
  widthClass?: string
  placeholder?: string
}

/** Free-text numeric input: keeps the raw string and flags invalid values instead of replacing them. */
export function SimNumberInput({ label, unit, value, parsed, onChange, widthClass = "w-20", placeholder }: SimNumberInputProps) {
  const invalid = !parsed.ok
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1">
        <span className="text-muted">{label}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={`h-7 ${widthClass} rounded border bg-panel px-1.5 font-mono text-xs text-ink ${invalid ? "border-danger" : "border-line"}`}
        />
        <span className="text-muted">{unit}</span>
      </span>
      {!parsed.ok && <span className="text-[10px] text-danger">{parsed.error}</span>}
    </label>
  )
}

/** Error (replaces the chart), warnings, notes and ignored parts from a SPICE run. */
export function SimMessagesPanel({ messages }: { messages: SimMessages }) {
  if (messages.error) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-danger/35 bg-danger/8 p-3.5 text-xs text-danger">
        <CircleAlert size={15} className="mt-0.5 shrink-0" />
        <span>{messages.error}</span>
      </p>
    )
  }
  const hasExtras = messages.warnings.length > 0 || messages.notes.length > 0 || messages.ignoredParts.length > 0
  if (!hasExtras) return null
  return (
    <div className="space-y-1.5 text-xs">
      {messages.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/8 px-3 py-2 text-warn">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{w}</span>
        </p>
      ))}
      {messages.ignoredParts.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface/40 px-3 py-2 text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Tidak disimulasikan (hanya R, C, L, LED, dioda yang dimodelkan): <span className="font-mono text-ink">{messages.ignoredParts.join(", ")}</span>
          </span>
        </p>
      )}
      {messages.notes.map((n) => (
        <p key={n} className="flex items-start gap-2 px-1 text-muted">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>{n}</span>
        </p>
      ))}
    </div>
  )
}

export interface ChartSeries {
  name: string
  color: string
  ys: number[]
}

export function WaveformChart({
  title,
  xLabel,
  yLabel,
  xs,
  series,
  logX = false,
}: {
  title: string
  xLabel: string
  yLabel: string
  xs: number[]
  series: ChartSeries[]
  logX?: boolean
}) {
  const W = 560
  const H = 200
  const padL = 48
  const padR = 16
  const padT = 14
  const padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const allY = series.flatMap((s) => s.ys)
  const minY = allY.length > 0 ? Math.min(...allY) : 0
  const maxY = allY.length > 0 ? Math.max(...allY) : 5
  const spanY = Math.max(0.01, maxY - minY)

  const xMin = xs[0] ?? 0
  const xMax = xs[xs.length - 1] ?? 1
  const mapX = (x: number, i: number) => {
    if (xs.length <= 1) return padL
    if (logX && xMin > 0 && xMax > xMin) {
      return padL + ((Math.log10(Math.max(xMin, x)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotW
    }
    return padL + (i / (xs.length - 1)) * plotW
  }
  const mapY = (y: number) => padT + plotH - ((y - minY) / spanY) * plotH

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#090c10]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-ink">{title}</span>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 font-mono text-[10px] text-muted">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full">
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * t
          const val = maxY - spanY * t
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1f2533" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
                {val.toFixed(1)}
              </text>
            </g>
          )
        })}
        {/* Curves */}
        {series.map((s) => {
          if (s.ys.length < 2) return null
          const pts = s.ys.map((y, i) => `${mapX(xs[i] ?? i, i).toFixed(1)},${mapY(y).toFixed(1)}`).join(" ")
          return <polyline key={s.name} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        })}
        {/* Axis labels */}
        <text x={padL} y={H - 6} fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {xMin} {xLabel}
        </text>
        <text x={W - padR} y={H - 6} textAnchor="end" fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {xMax} {xLabel}
        </text>
        <text x={12} y={padT + 8} fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {yLabel}
        </text>
      </svg>
    </div>
  )
}
