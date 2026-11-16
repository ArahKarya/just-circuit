import type { ProjectMeta } from "./projects.js"

/** Files that make a project folder runnable with `tsci dev` / `tsci build`. */
export function scaffoldFiles(meta: Pick<ProjectMeta, "id" | "entrypoint">): Record<string, unknown> {
  return {
    "package.json": {
      name: meta.id,
      private: true,
      main: meta.entrypoint,
      scripts: { dev: "tsci dev", build: "tsci build" },
      devDependencies: { tscircuit: "latest", "@types/react": "^19", typescript: "^5" },
    },
    "tscircuit.config.json": {
      $schema: "https://cdn.jsdelivr.net/npm/@tscircuit/cli/types/tscircuit.config.schema.json",
      mainEntrypoint: meta.entrypoint,
    },
  }
}
