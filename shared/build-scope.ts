/**
 * Parts of a build a project can switch off to stay fast on big boards. Measured on a 300-part
 * PLC: schematic trace solving took ~190 s, PCB placement + autorouting ~30 s, checks alone ~3 s.
 */
export interface BuildScope {
  /** Skip the schematic (its trace solver is the slowest step on big designs). */
  schematicDisabled?: boolean
  /** Skip PCB autorouting: placement, netlist and schematic checks only. */
  routingDisabled?: boolean
}

/** tscircuit platform options for a scope; undefined builds everything. */
export function platformConfigFor(scope: BuildScope | undefined): { schematicDisabled?: true; routingDisabled?: true } | undefined {
  if (!scope?.schematicDisabled && !scope?.routingDisabled) return undefined
  return { ...(scope.schematicDisabled ? { schematicDisabled: true as const } : {}), ...(scope.routingDisabled ? { routingDisabled: true as const } : {}) }
}

/** Short Indonesian label of what is skipped, e.g. "tanpa skematik & routing"; "" when nothing is. */
export function skippedLabel(scope: BuildScope | undefined): string {
  const parts = [scope?.schematicDisabled ? "skematik" : "", scope?.routingDisabled ? "routing" : ""].filter(Boolean)
  return parts.length > 0 ? `tanpa ${parts.join(" & ")}` : ""
}
