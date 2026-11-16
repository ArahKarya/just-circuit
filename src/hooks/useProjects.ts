import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "../lib/api"
import { useLiveData } from "../lib/live-data"
import { DEFAULT_ENTRYPOINT } from "../lib/project-ops"
import { DEFAULT_TEMPLATE_ID, findTemplate } from "../lib/templates"
import { projectsRepo, TOPICS, type ProjectInput } from "../lib/repo"
import type { Project, ProjectSummary } from "../lib/types"

const ACTIVE_KEY = "cds.activeProjectId"

function readActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function storeActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // Remembering the last project is a convenience only.
  }
}

export interface ProjectsState {
  projects: ProjectSummary[] | undefined
  /** The open project with its files (undefined while it loads). */
  active: Project | undefined
  activeId: string | null
  error: Error | null
  select: (id: string) => void
  /** Opens a project that was just added on the server (restored, imported) before the list catches up. */
  selectNew: (id: string) => void
  create: (name: string, options?: { templateId?: string; workspaceId?: string }) => Promise<Project>
  /** Saves the open project (as a version when a message is given); ignored if it was deleted meanwhile. */
  save: (project: Project, commitMessage?: string) => Promise<void>
  /** Adds a new project (e.g. a duplicate) and opens it. */
  insert: (input: ProjectInput) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Projects stored on the server. `ready` is false until browser data has been migrated. */
export function useProjects(ready: boolean): ProjectsState {
  const list = useLiveData(ready ? projectsRepo.list : null, [TOPICS.projects])
  const [activeId, setActiveId] = useState<string | null>(readActiveId)
  const listedActiveId = list.data?.some((p) => p.id === activeId) ? activeId : null
  const active = useLiveData(listedActiveId ? () => projectsRepo.get(listedActiveId) : null, listedActiveId ? [TOPICS.project(listedActiveId)] : [])
  const isSeeding = useRef(false)
  /** A project just created here: the list may not include it yet, so don't fall back to another one. */
  const justCreated = useRef<string | null>(null)

  const select = useCallback((id: string) => {
    setActiveId(id)
    storeActiveId(id)
  }, [])

  const selectNew = useCallback(
    (id: string) => {
      justCreated.current = id
      select(id)
    },
    [select],
  )

  const create = useCallback(
    async (name: string, options: { templateId?: string; workspaceId?: string } = {}) => {
      const template = findTemplate(options.templateId ?? DEFAULT_TEMPLATE_ID)
      const project = await projectsRepo.create({
        name: name.trim() || "Proyek tanpa nama",
        entrypoint: DEFAULT_ENTRYPOINT,
        files: template.files,
        workspaceId: options.workspaceId,
      })
      selectNew(project.id)
      return project
    },
    [selectNew],
  )

  const save = useCallback(async (project: Project, commitMessage?: string) => {
    try {
      await projectsRepo.save(project, commitMessage)
    } catch (error) {
      // The project was deleted while an edit was still pending.
      if (error instanceof ApiError && error.status === 404) return
      throw error
    }
  }, [])

  const insert = useCallback(
    async (input: ProjectInput) => {
      const project = await projectsRepo.create(input)
      selectNew(project.id)
    },
    [selectNew],
  )

  useEffect(() => {
    const projects = list.data
    if (!projects) return
    if (projects.length === 0) {
      // Seed once: the list may still read [] for a moment after the first project is created.
      if (!isSeeding.current) {
        isSeeding.current = true
        void create("Proyek pertama").catch(() => {
          isSeeding.current = false
        })
      }
      return
    }
    if (projects.some((p) => p.id === activeId)) {
      if (justCreated.current === activeId) justCreated.current = null
      return
    }
    if (justCreated.current !== null && justCreated.current === activeId) return
    select(projects[0].id)
  }, [list.data, activeId, create, select])

  return {
    projects: list.data,
    active: active.data?.id === listedActiveId ? active.data : undefined,
    activeId: listedActiveId,
    error: list.error ?? active.error,
    select,
    selectNew,
    create,
    save,
    insert,
    rename: projectsRepo.rename,
    remove: projectsRepo.remove,
  }
}
