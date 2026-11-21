import type { DesignIssue } from "./drc"
import { listComponents } from "./tsx-ast"
import type { ProjectFiles } from "./types"

type RawEl = Record<string, unknown> & { type?: string }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const GND_RE = /^(gnd|agnd|dgnd|pgnd|vss|0v|ground)$/i
const PWR_RE = /^(vcc|vdd|vbus|vin|vbat|3v3|v3_3|5v|v5|12v|24v)$/i

/**
 * KiCad-style Electrical Rules Check (ERC) combining static TSX checks
 * and circuit-json connectivity analysis.
 */
export function runExtendedErc(files: ProjectFiles, circuitJson: readonly unknown[] | null): DesignIssue[] {
  const issues: DesignIssue[] = []
  const comps = listComponents(files)

  // 1. Duplicate designators
  const byName = new Map<string, string[]>()
  for (const c of comps) {
    if (!byName.has(c.name)) byName.set(c.name, [])
    byName.get(c.name)!.push(c.path)
  }
  for (const [name, paths] of byName.entries()) {
    if (paths.length > 1) {
      issues.push({
        key: `erc:dup:${name}`,
        severity: "error",
        category: "schematic",
        type: "erc_duplicate_designator",
        message: `Designator duplikat "${name}" muncul ${paths.length}× (${[...new Set(paths)].join(", ")})`,
        components: [name],
      })
    }
  }

  // 2. Chips without MPN
  for (const c of comps) {
    if (c.tagName === "chip" && !c.manufacturerPartNumber) {
      issues.push({
        key: `erc:mpn:${c.name}`,
        severity: "warning",
        category: "schematic",
        type: "erc_missing_mpn",
        message: `IC ${c.name} belum memiliki manufacturerPartNumber (penting untuk BOM & skematik).`,
        components: [c.name],
      })
    }
  }

  if (!circuitJson || circuitJson.length === 0) return issues

  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const connectedPorts = new Set<string>()
  const netNames = new Set<string>()
  const sourceNameById = new Map<string, string>()

  for (const el of elements) {
    if (el.type === "source_component" && str(el.source_component_id) && str(el.name)) {
      sourceNameById.set(str(el.source_component_id)!, str(el.name)!)
    } else if (el.type === "source_net" && str(el.name)) {
      netNames.add(str(el.name)!)
    } else if (el.type === "source_trace" && Array.isArray(el.connected_source_port_ids)) {
      for (const pid of el.connected_source_port_ids) {
        if (typeof pid === "string") connectedPorts.add(pid)
      }
    }
  }

  // 3. Unconnected power/critical pins on components
  for (const el of elements) {
    if (el.type !== "source_port") continue
    const pid = str(el.source_port_id)
    const cid = str(el.source_component_id)
    const portName = str(el.name) ?? ""
    if (!pid || !cid || connectedPorts.has(pid)) continue
    if (GND_RE.test(portName) || PWR_RE.test(portName)) {
      const compName = sourceNameById.get(cid) ?? cid
      issues.push({
        key: `erc:unconn:${pid}`,
        severity: "error",
        category: "schematic",
        type: "erc_unconnected_power_pin",
        message: `Pin daya ${compName}.${portName} tidak terhubung ke net mana pun.`,
        components: [compName],
      })
    }
  }

  // 4. Power net present without GND
  const hasPower = [...netNames].some((n) => PWR_RE.test(n))
  const hasGnd = [...netNames].some((n) => GND_RE.test(n))
  if (hasPower && !hasGnd) {
    issues.push({
      key: "erc:missing-gnd",
      severity: "warning",
      category: "schematic",
      type: "erc_missing_gnd",
      message: "Terdapat net daya (VCC/5V/3V3) tetapi tidak ditemukan net GND.",
      components: [],
    })
  }

  return issues
}
