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
      className={`rounded px-1.5 py-0.5 text-xs ${on ? "text-muted hover:bg-raised hover:text-ink" : "bg-warn/15 text-warn line-through decoration-1 hover:bg-warn/25"}`}
    >
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
    <div className="flex items-center gap-0.5" role="group" aria-label="Bagian build">
      <Toggle
        label="Skematik"
        on={!scope.schematicDisabled}
        title={scope.schematicDisabled ? "Skematik dimatikan: build lebih cepat, tab Schematic kosong. Klik untuk menyalakan." : "Matikan selama mengerjakan PCB di board besar: kabel skematik adalah bagian build paling lama."}
        onClick={() => onToggle("schematicDisabled")}
      />
      <Toggle
        label="Routing"
        on={!scope.routingDisabled}
        title={scope.routingDisabled ? "Routing PCB dimatikan: hanya cek penempatan dan netlist. Klik untuk menyalakan." : "Matikan untuk cek penempatan dan netlist saja (beberapa detik)."}
        onClick={() => onToggle("routingDisabled")}
      />
      {slow && (
        <button type="button" onClick={() => onToggle("schematicDisabled")} className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 text-xs text-warn hover:bg-warn/25">
          Lama? Matikan skematik
        </button>
      )}
    </div>
  )
}
