import { useCallback } from "react"
import toast from "react-hot-toast"
import { addFile, deletePath, FileOpError, normalizePath, renamePath } from "../lib/file-tree"
import { MANUAL_EDITS_FILE } from "../lib/manual-edits"
import { withFiles } from "../lib/project-ops"
import type { Project } from "../lib/types"
import type { WorkingProject } from "./useWorkingProject"

export interface FileActionHandlers {
  onCreateFile: (path: string) => boolean
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => void
  onSetEntrypoint: (path: string) => void
}

function report(error: unknown): void {
  toast.error(error instanceof FileOpError || error instanceof Error ? error.message : "Gagal mengubah file")
}

/** File explorer operations on the open project (saved right away, not recorded as versions). */
export function useFileActions(project: Project | undefined, working: WorkingProject, activeFile: string | undefined, openFile: (path: string) => void): FileActionHandlers {
  const change = useCallback(
    (make: (current: Project) => Project, after?: () => void): boolean => {
      if (!project) return false
      try {
        const next = make(project)
        void working.apply(next).then(after).catch(report)
        return true
      } catch (error) {
        report(error)
        return false
      }
    },
    [project, working],
  )

  const onCreateFile = useCallback(
    (path: string) => {
      const clean = normalizePath(path)
      return change((p) => addFile(p, clean), () => openFile(clean))
    },
    [change, openFile],
  )

  const onRename = useCallback(
    (from: string, to: string) => {
      if (from === MANUAL_EDITS_FILE) {
        toast.error(`${MANUAL_EDITS_FILE} dipakai oleh file utama dan tidak bisa diganti namanya`)
        return
      }
      const target = normalizePath(to)
      change((p) => renamePath(p, from, target), () => {
        // Keep the renamed file open.
        if (activeFile === from) openFile(target)
        else if (activeFile?.startsWith(`${from}/`)) openFile(`${target}${activeFile.slice(from.length)}`)
        toast(`Ingat perbarui import yang menunjuk ke ${from}`, { icon: "ℹ️" })
      })
    },
    [change, activeFile, openFile],
  )

  const onDelete = useCallback(
    (path: string) => {
      if (path === MANUAL_EDITS_FILE) {
        // The entrypoint imports this file, so reset it instead of deleting it.
        change((p) => withFiles(p, { [path]: "{}\n" }), () => toast.success("Posisi manual direset"))
        return
      }
      change((p) => deletePath(p, path))
    },
    [change],
  )

  const onSetEntrypoint = useCallback(
    (path: string) => {
      change((p) => ({ ...p, entrypoint: path, updatedAt: Date.now() }), () => toast.success(`${path} sekarang file utama`))
    },
    [change],
  )

  return { onCreateFile, onRename, onDelete, onSetEntrypoint }
}
