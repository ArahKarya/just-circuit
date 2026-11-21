import { panelProps, toolingrailProps } from "@tscircuit/props"
import { runTscircuitCode } from "@tscircuit/eval/eval"
import { describe, expect, it } from "vitest"
import { buildPanelProps, buildPanelTsx, buildToolingRails, type PanelOptions, type PanelSeparation } from "./panel-wizard"

const options = (separation: PanelSeparation, railWidth = 5): PanelOptions => ({ cols: 2, rows: 2, boardGap: 2.5, separation, railWidth })

describe("buildPanelProps", () => {
  it.each(["mouse-bites", "v-score", "outline"] as const)("%s only uses fields PanelProps knows", (separation) => {
    const props = buildPanelProps(options(separation))
    const parsed = panelProps.parse(props) as Record<string, unknown>
    for (const key of Object.keys(props)) expect(parsed).toHaveProperty(key)
    expect(["tab-routing", "outline_routing", "none"]).toContain(props.panelizationMethod)
    expect(props).not.toHaveProperty("edgeRails")
  })

  it("maps V-score onto tab routing with vScore, never both vScore and mouseBites", () => {
    expect(buildPanelProps(options("v-score"))).toMatchObject({ panelizationMethod: "tab-routing", vScore: true })
    expect(buildPanelProps(options("v-score"))).not.toHaveProperty("mouseBites")
    expect(buildPanelProps(options("mouse-bites"))).toMatchObject({ panelizationMethod: "tab-routing", mouseBites: true })
  })

  it("reserves edge padding for tooling rails and emits valid <toolingrail> props", () => {
    expect(buildPanelProps(options("outline"))).toMatchObject({ edgePaddingTop: "5mm", edgePaddingBottom: "5mm" })
    const rails = buildToolingRails(options("outline"))
    expect(rails.map((r) => r.panelSide)).toEqual(["top", "bottom"])
    for (const rail of rails) expect(() => toolingrailProps.parse(rail)).not.toThrow()
    expect(buildToolingRails(options("outline", 0))).toEqual([])
    expect(buildPanelProps(options("outline", 0))).not.toHaveProperty("edgePaddingTop")
  })

  it("clamps the grid", () => {
    expect(buildPanelProps({ ...options("outline"), cols: 50, rows: 0 })).toMatchObject({ col: 10, row: 1 })
  })
})

describe("buildPanelTsx", () => {
  it("renders the repeated board inside a panel without errors", async () => {
    const tsx = buildPanelTsx(options("v-score"), "index.circuit.tsx")
    expect(tsx).toContain('import MainBoard from "./index.circuit"')
    const json = (await runTscircuitCode(
      {
        "panel.circuit.tsx": tsx,
        "index.circuit.tsx": `export default () => (<board width="20mm" height="20mm"><resistor name="R1" resistance="1k" footprint="0402" /></board>)`,
      },
      { mainComponentPath: "panel.circuit.tsx" },
    )) as unknown as Record<string, unknown>[]
    expect(json.filter((e) => String(e.type).includes("error"))).toEqual([])
    expect(json.filter((e) => e.type === "pcb_panel")).toHaveLength(1)
    expect(json.filter((e) => e.type === "pcb_board")).toHaveLength(4)
  }, 30_000)
})
