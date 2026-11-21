import { jsxStringValue } from "./tsx-ast"

export type PanelSeparation = "mouse-bites" | "v-score" | "outline"

export interface PanelOptions {
  cols: number
  rows: number
  /** Gap between boards, mm. */
  boardGap: number
  separation: PanelSeparation
  /** Tooling rail width on the top and bottom edge, mm; 0 = no rails. */
  railWidth: number
}

export const PANEL_FILE = "panel.circuit.tsx"
const MAX_PANEL_GRID = 10

type PanelPropValue = string | number | boolean

/** `<panel>` props, using only fields that exist in @tscircuit/props PanelProps. */
export function buildPanelProps(options: PanelOptions): Record<string, PanelPropValue> {
  const separation: Record<string, PanelPropValue> =
    options.separation === "outline"
      ? { panelizationMethod: "outline_routing" }
      : options.separation === "v-score"
        ? { panelizationMethod: "tab-routing", vScore: true }
        : { panelizationMethod: "tab-routing", mouseBites: true }
  const rails: Record<string, PanelPropValue> =
    options.railWidth > 0 ? { edgePaddingTop: `${options.railWidth}mm`, edgePaddingBottom: `${options.railWidth}mm` } : {}
  return {
    layoutMode: "grid",
    row: clampGrid(options.rows),
    col: clampGrid(options.cols),
    boardGap: `${Math.max(0, options.boardGap)}mm`,
    ...separation,
    ...rails,
  }
}

/** `<toolingrail>` props for the top and bottom edges, or none. */
export function buildToolingRails(options: PanelOptions): Record<string, PanelPropValue>[] {
  if (options.railWidth <= 0) return []
  return (["top", "bottom"] as const).map((panelSide) => ({ panelSide, width: `${options.railWidth}mm` }))
}

function clampGrid(value: number): number {
  return Math.max(1, Math.min(MAX_PANEL_GRID, Math.round(value) || 1))
}

function propLiteral(name: string, value: PanelPropValue): string {
  if (value === true) return name
  if (typeof value === "string") return `${name}=${jsxStringValue(value)}`
  return `${name}={${value}}`
}

function attrs(props: Record<string, PanelPropValue>): string {
  return Object.entries(props)
    .map(([name, value]) => propLiteral(name, value))
    .join(" ")
}

/** Import path from panel.circuit.tsx (project root) to the entry file, without extension. */
function entryImport(entrypoint: string): string {
  return `./${entrypoint.replace(/^\.\//, "").replace(/\.tsx?$/, "")}`
}

const SEPARATION_LABEL: Record<PanelSeparation, string> = {
  "mouse-bites": "tab + mouse-bites",
  "v-score": "tab + V-score",
  outline: "outline routing",
}

/** Source of panel.circuit.tsx: the entry board repeated in a cols x rows grid. */
export function buildPanelTsx(options: PanelOptions, entrypoint: string): string {
  const props = buildPanelProps(options)
  const count = Number(props.row) * Number(props.col)
  const boards = Array.from({ length: count }, (_, i) => `    <MainBoard key="b${i}" />`)
  const rails = buildToolingRails(options).map((rail) => `    <toolingrail ${attrs(rail)} />`)
  return `import MainBoard from ${JSON.stringify(entryImport(entrypoint))}

/** Panel produksi ${props.col}×${props.row} (${SEPARATION_LABEL[options.separation]}). Cek aturan panel pabrik PCB Anda. */
export default () => (
  <panel ${attrs(props)}>
${[...boards, ...rails].join("\n")}
  </panel>
)
`
}
