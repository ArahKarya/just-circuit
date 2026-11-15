import { useLiveQuery } from "dexie-react-hooks"
import { useCallback, useEffect, useRef, useState } from "react"
import { db } from "../lib/db"
import { createProject } from "../lib/project-ops"
import type { Project } from "../lib/types"

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
  projects: Project[] | undefined
  active: Project | undefined
  select: (id: string) => void
  create: (name: string) => Promise<Project>
  /** Updates an existing project; ignored if it was deleted. */
  save: (project: Project) => Promise<void>
  /** Adds a new project (e.g. a duplicate) and opens it. */
  insert: (project: Project) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useProjects(): ProjectsState {
  const projects = useLiveQuery(() => db.projects.orderBy("updatedAt").reverse().toArray(), [])
  const [activeId, setActiveId] = useState<string | null>(readActiveId)
  const isSeeding = useRef(false)

  const select = useCallback((id: string) => {
    setActiveId(id)
    storeActiveId(id)
  }, [])

  const create = useCallback(
    async (name: string) => {
      const project = createProject(name)
      await db.projects.add(project)
      select(project.id)
      return project
    },
    [select],
  )

  // Never recreate a project that was deleted while an edit was still pending.
  const save = useCallback(async (project: Project) => {
    await db.transaction("rw", db.projects, async () => {
      if (await db.projects.get(project.id)) await db.projects.put(project)
    })
  }, [])

  const insert = useCallback(
    async (project: Project) => {
      await db.projects.add(project)
      select(project.id)
    },
    [select],
  )

  const remove = useCallback(async (id: string) => {
    await db.transaction("rw", db.projects, db.messages, async () => {
      await db.messages.where("projectId").equals(id).delete()
      await db.projects.delete(id)
    })
  }, [])

  useEffect(() => {
    if (!projects) return
    if (projects.length === 0) {
      if (!isSeeding.current) {
        isSeeding.current = true
        void create("Proyek pertama").finally(() => {
          isSeeding.current = false
        })
      }
      return
    }
    if (!projects.some((p) => p.id === activeId)) select(projects[0].id)
  }, [projects, activeId, create, select])

  return { projects, active: projects?.find((p) => p.id === activeId), select, create, save, insert, remove }
}
