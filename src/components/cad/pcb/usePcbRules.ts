import { useCallback, useState } from "react"
import toast from "react-hot-toast"
import { deleteElementSpan } from "../../../lib/tsx-ast"
import { addCopperPour, addDifferentialPair, type CopperPourEntry } from "../../../lib/tsx-rules"
import type { Project, ProjectFiles } from "../../../lib/types"
import type { CopperLayer } from "./constants"

const DEFAULT_SKEW_MM = 0.05

interface UsePcbRulesOptions {
  project: Project
  onCommitFiles: (nextFiles: ProjectFiles) => void
}

/** Copper pour (zone) manager form; values survive closing and reopening the bar. */
export function useZoneManager({ project, onCommitFiles }: UsePcbRulesOptions) {
  const [open, setOpen] = useState(false)
  const [net, setNet] = useState("GND")
  const [layer, setLayer] = useState<CopperLayer>("bottom")

  const addZone = useCallback(() => {
    if (!net.trim()) return
    const res = addCopperPour(project.files, project.entrypoint, { net: net.trim(), layer, useThermalReliefs: true })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success(`Copper pour ${net.trim()} (${layer}) ditambahkan`)
    }
  }, [net, layer, project.files, project.entrypoint, onCommitFiles])

  const removeZone = useCallback(
    (pour: CopperPourEntry) => {
      const res = deleteElementSpan(project.files, pour.path, pour.start, pour.end)
      if (res.status === "updated") onCommitFiles(res.files)
    },
    [project.files, onCommitFiles],
  )

  return { open, toggle: () => setOpen((v) => !v), net, setNet, layer, setLayer, addZone, removeZone }
}

export type ZoneManager = ReturnType<typeof useZoneManager>

/** Differential pair form; the bar closes after a successful insert. */
export function useDiffPairForm({ project, onCommitFiles }: UsePcbRulesOptions) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("USB")
  const [positive, setPositive] = useState("USB_DP")
  const [negative, setNegative] = useState("USB_DM")
  const [skew, setSkewValue] = useState(DEFAULT_SKEW_MM)

  const setSkew = useCallback((raw: string) => setSkewValue(Number(raw) || DEFAULT_SKEW_MM), [])

  const addDiffPair = useCallback(() => {
    if (!name.trim() || !positive.trim() || !negative.trim()) return
    const res = addDifferentialPair(project.files, project.entrypoint, {
      name: name.trim(),
      positiveConnection: positive.trim(),
      negativeConnection: negative.trim(),
      maxLengthSkew: skew,
    })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      setOpen(false)
      toast.success(`Differential pair ${name.trim()} ditambahkan`)
    }
  }, [name, positive, negative, skew, project.files, project.entrypoint, onCommitFiles])

  return { open, toggle: () => setOpen((v) => !v), name, setName, positive, setPositive, negative, setNegative, skew, setSkew, addDiffPair }
}

export type DiffPairForm = ReturnType<typeof useDiffPairForm>
