import { useEffect, useState } from "react"
import type { BuildScope } from "../../shared/build-scope"

/** After this long, a build that still includes the schematic gets a hint to switch it off. */
export const SLOW_BUILD_MS = 45_000

interface BuildScopeControlsProps {
  scope: BuildScope
  isRunning: boolean
  onToggle: (key: keyof BuildScope) => void
}

interface ToggleProps {
  label: string
  on: boolean
  title: string
  onClick: () => void
}

function Toggle({ label, on, title, onClick }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition ${
        on
          ? "text-muted hover:bg-raised hover:text-ink"
          : "bg-warn/15 text-warn line-through decoration-1 hover:bg-warn/25"
      }`}
    >
      <span className={`size-1.5 rounded-full ${on ? "bg-accent/80" : "bg-warn"}`} />
      {label}
    </button>
  )
}

/** Header switches for the slow parts of a build; big boards stay workable with them off. */
export function BuildScopeControls({ scope, isRunning, onToggle }: BuildScopeControlsProps) {
  const [runningSince, setRunningSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning) {
      setRunningSince(null)
      return
    }
    setRunningSince(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [isRunning])

  const slow = runningSince !== null && now - runningSince >= SLOW_BUILD_MS && !scope.schematicDisabled
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Bagian build">
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface/70 p-0.5">
        <Toggle
          label="Skematik"
          on={!scope.schematicDisabled}
          title={
            scope.schematicDisabled
              ? "Skematik dimatikan: build lebih cepat, tab Schematic kosong. Klik untuk menyalakan."
              : "Matikan selama mengerjakan PCB di board besar: kabel skematik adalah bagian build paling lama."
          }
          onClick={() => onToggle("schematicDisabled")}
        />
        <Toggle
          label="Routing"
          on={!scope.routingDisabled}
          title={
            scope.routingDisabled
              ? "Routing PCB dimatikan: hanya cek penempatan dan netlist. Klik untuk menyalakan."
              : "Matikan untuk cek penempatan dan netlist saja (beberapa detik)."
          }
          onClick={() => onToggle("routingDisabled")}
        />
      </div>
      {slow && (
        <button
          type="button"
          onClick={() => onToggle("schematicDisabled")}
          className="rounded-lg border border-warn/30 bg-warn/12 px-2 py-1 text-xs font-medium text-warn transition hover:bg-warn/20"
        >
          Lama? Matikan skematik
        </button>
      )}
    </div>
  )
}
