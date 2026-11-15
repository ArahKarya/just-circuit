import JSZip from "jszip"
import type { Project } from "./types"

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "proyek"
}

/** Files that let the ZIP be opened directly with the `tsci` CLI. */
function cliScaffold(project: Project): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: slug(project.name),
        private: true,
        main: project.entrypoint,
        scripts: { dev: "tsci dev", build: "tsci build" },
        devDependencies: { tscircuit: "latest", "@types/react": "^19", typescript: "^5" },
      },
      null,
      2,
    ),
    "tscircuit.config.json": JSON.stringify({ $schema: "https://cdn.jsdelivr.net/npm/@tscircuit/cli/types/tscircuit.config.schema.json" }, null, 2),
  }
}

export async function downloadProjectZip(project: Project): Promise<void> {
  const zip = new JSZip()
  const folder = zip.folder(slug(project.name)) ?? zip
  Object.entries({ ...cliScaffold(project), ...project.files }).forEach(([path, content]) => folder.file(path, content))
  const blob = await zip.generateAsync({ type: "blob" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${slug(project.name)}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
