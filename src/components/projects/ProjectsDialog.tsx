import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import type { ProjectsState } from "../../hooks/useProjects"
import { useLiveData } from "../../lib/live-data"
import { TOPICS, workspacesRepo } from "../../lib/repo"
import type { ProjectSummary } from "../../lib/types"
import { Modal, SELECT_CLASS } from "../ui"
import { NewProjectForm } from "./NewProjectForm"
import { ProjectRow } from "./ProjectRow"
import { TrashList } from "./TrashList"
import { WorkspaceSidebar } from "./WorkspaceSidebar"

interface ProjectsDialogProps {
  projects: ProjectsState
  onClose: () => void
}

type Tab = "projects" | "trash"
type Sort = "recent" | "name"

const SORTERS: Record<Sort, (a: ProjectSummary, b: ProjectSummary) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  name: (a, b) => a.name.localeCompare(b.name, "id"),
}

export function ProjectsDialog({ projects, onClose }: ProjectsDialogProps) {
  const workspaces = useLiveData(workspacesRepo.list, [TOPICS.workspaces]).data ?? []
  const activeWorkspace = projects.projects?.find((p) => p.id === projects.activeId)?.workspaceId ?? "default"
  const [tab, setTab] = useState<Tab>("projects")
  const [workspaceId, setWorkspaceId] = useState(activeWorkspace)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("recent")

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (projects.projects ?? [])
      .filter((p) => p.workspaceId === workspaceId && (!needle || p.name.toLowerCase().includes(needle)))
      .sort(SORTERS[sort])
  }, [projects.projects, workspaceId, query, sort])
  const total = projects.projects?.length ?? 0

  const open = (id: string) => {
    projects.select(id)
    onClose()
  }

  const openRestored = (id: string) => {
    projects.selectNew(id)
    onClose()
  }

  return (
    <Modal title="Proyek" wide onClose={onClose}>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {([["projects", "Proyek"], ["trash", "Tempat sampah"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "trash" ? (
        <TrashList workspaces={workspaces} onRestored={openRestored} />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <WorkspaceSidebar workspaces={workspaces} selectedId={workspaceId} onSelect={setWorkspaceId} />
          <div className="min-w-0 flex-1 space-y-3">
            <NewProjectForm projects={projects} workspaceId={workspaceId} onDone={onClose} />
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  aria-label="Cari proyek"
                  placeholder="Cari proyek…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm focus:border-accent focus:outline-none"
                />
              </label>
              <select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${SELECT_CLASS} w-36`}>
                <option value="recent">Terbaru</option>
                <option value="name">Nama A–Z</option>
              </select>
            </div>
            {visible.length === 0 ? (
              <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
                {query ? "Tidak ada proyek yang cocok." : "Belum ada proyek di workspace ini."}
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {visible.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    projects={projects}
                    workspaces={workspaces}
                    isActive={project.id === projects.activeId}
                    canDelete={total > 1}
                    onOpen={() => open(project.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
