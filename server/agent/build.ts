import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { homedir, platform, tmpdir } from "node:os"
import path from "node:path"
import { platformConfigFor, skippedLabel, type BuildScope } from "../../shared/build-scope.js"
import { isEditablePath } from "../../shared/project-paths.js"
import { logger } from "../logger.js"
import { shellEnv } from "../terminal/terminal-server.js"
import { FOOTPRINTS_FILE, RUNNER_FILE, RUNNER_SOURCE } from "./build-runner.js"
import { kicadFootprintsIn, prepareKicadFootprints } from "./kicad-footprints.js"

export interface BuildReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** Set when the build itself could not run (disabled, no sandbox, timeout…). */
  problem?: string
  /** What this build skipped (e.g. "tanpa skematik & routing"), so missing traces aren't read as errors. */
  skipped?: string
}

export interface BuildOptions extends BuildScope {
  /** Folder holding node_modules with tscircuit + react, prepared once outside the sandbox. */
  runtimeDir: string
  /** Folders a sandboxed build must never read (data dir, home). */
  secretDirs: string[]
  /** Where KiCad footprints fetched for builds are kept (outside the sandbox). */
  footprintCacheDir?: string
  keepAlive: () => void
  signal?: AbortSignal
}

const BUILD_TIMEOUT_MS = 180_000
const INSTALL_TIMEOUT_MS = 300_000
const MAX_MESSAGES = 20
const MAX_OUTPUT_CHARS = 2000
/** Checks that report a concern but don't fail the build (same as the preview's warnings). */
const WARNING_MESSAGE = /but supplier part .+ matching diode polarity/i

/**
 * Model-written TSX runs with bun during the build. It is treated as hostile: the build runs on a
 * copy of the project in a temp folder, inside an OS sandbox with no network, no writes outside that
 * folder and no reads of the home folder (macOS sandbox-exec, Linux bubblewrap). Without a sandbox
 * the build refuses to run.
 */
function sandboxCommand(workDir: string, runtimeDir: string, secretDirs: string[], args: string[]): { command: string; args: string[] } | null {
  if (platform() === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    const home = homedir()
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny network*)",
      "(allow network* (local unix))",
      "(deny file-write*)",
      `(allow file-write* (subpath "${workDir}") (literal "/dev/null") (literal "/dev/tty"))`,
      `(deny file-read* (subpath "${home}") ${secretDirs.map((dir) => `(subpath "${dir}")`).join(" ")})`,
      `(allow file-read* (subpath "${runtimeDir}") (literal "${home}"))`,
    ].join("\n")
    return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, ...args] }
  }
  const bwrap = ["/usr/bin/bwrap", "/bin/bwrap"].find((candidate) => existsSync(candidate))
  if (platform() === "linux" && bwrap) {
    const hidden = ["/home", "/root", ...secretDirs.filter((dir) => !dir.startsWith("/home/") && !dir.startsWith("/root/"))]
    return {
      command: bwrap,
      args: [
        "--unshare-all",
        "--die-with-parent",
        "--ro-bind", "/", "/",
        ...hidden.flatMap((dir) => ["--tmpfs", dir]),
        "--ro-bind", runtimeDir, runtimeDir,
        "--bind", workDir, workDir,
        "--dev", "/dev",
        "--proc", "/proc",
        "--chdir", workDir,
        ...args,
      ],
    }
  }
  return null
}

/** PATH without entries under the home folder (they are unreadable inside the sandbox). */
function sandboxPath(): string {
  const home = homedir()
  return (process.env.PATH ?? "/usr/bin:/bin").split(path.delimiter).filter((dir) => dir && !dir.startsWith(home)).join(path.delimiter)
}

interface RunResult {
  output: string
  timedOut: boolean
  missing: boolean
}

/** Runs a command in its own process group so a timeout or abort kills bun's children too. */
function run(command: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = ""
    let timedOut = false
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    signal?.addEventListener("abort", kill, { once: true })
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-64 * 1024)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolve({ output: error.message, timedOut, missing: error.code === "ENOENT" })
    })
    child.on("close", () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", kill)
      resolve({ output, timedOut, missing: false })
    })
  })
}

let runtimeReady: Promise<void> | null = null

/** Installs tscircuit + react once into the runtime folder (outside the sandbox, with network). */
function ensureRuntime(runtimeDir: string): Promise<void> {
  runtimeReady ??= (async () => {
    if (existsSync(path.join(runtimeDir, "node_modules", "@tscircuit", "core")) && existsSync(path.join(runtimeDir, "node_modules", "react"))) return
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, "package.json"), `${JSON.stringify({ name: "just-circuit-build-runtime", private: true }, null, 2)}\n`)
    logger.info("installing build runtime", { runtimeDir })
    const result = await run("bun", ["add", "tscircuit", "react"], runtimeDir, shellEnv(process.env), INSTALL_TIMEOUT_MS)
    if (result.missing) throw new Error("bun tidak terpasang di server")
    if (!existsSync(path.join(runtimeDir, "node_modules", "@tscircuit", "core"))) throw new Error(`Gagal menyiapkan runtime build: ${result.output.slice(-300)}`)
  })().catch((error: unknown) => {
    runtimeReady = null
    throw error
  })
  return runtimeReady
}

async function findCircuitJson(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await findCircuitJson(full)))
    else if (entry.name === "circuit.json") found.push(full)
  }
  return found
}

/** Never sends local paths (home folder, temp dirs) back to the model and its provider. */
function scrub(text: string, workDir: string): string {
  return text.split(workDir).join(".").split(homedir()).join("~").slice(-MAX_OUTPUT_CHARS)
}

let queue: Promise<unknown> = Promise.resolve()

/** One server build at a time: each one is a bun process that can use a whole CPU core. */
export function buildProject(files: Record<string, string>, entrypoint: string, options: BuildOptions): Promise<BuildReport> {
  const next = queue.then(() => buildOnce(files, entrypoint, options))
  queue = next.catch(() => undefined)
  return next
}

async function buildOnce(files: Record<string, string>, entrypoint: string, options: BuildOptions): Promise<BuildReport> {
  const fail = (problem: string): BuildReport => ({ ok: false, errors: [], warnings: [], problem })
  if (!isEditablePath(entrypoint)) return fail("File utama tidak valid")
  try {
    await ensureRuntime(options.runtimeDir)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Runtime build tidak siap")
  }
  const workDir = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "just-circuit-build-")))
  const ticker = setInterval(options.keepAlive, 5_000)
  try {
    // Only the project's editable files: no .just-circuit data, no stale node_modules, no configs.
    for (const [file, content] of Object.entries(files)) {
      if (!isEditablePath(file)) continue
      await mkdir(path.dirname(path.join(workDir, file)), { recursive: true })
      await writeFile(path.join(workDir, file), content)
    }
    await writeFile(path.join(workDir, "package.json"), "{}\n")
    await writeFile(path.join(workDir, RUNNER_FILE), RUNNER_SOURCE)
    // kicad: footprints are fetched here, with network, and handed to the offline runner.
    const kicadNames = kicadFootprintsIn(files)
    if (kicadNames.length > 0 && options.footprintCacheDir) {
      const { footprints } = await prepareKicadFootprints(kicadNames, options.footprintCacheDir)
      await writeFile(path.join(workDir, FOOTPRINTS_FILE), JSON.stringify(footprints))
    }
    await symlink(path.join(await realpath(options.runtimeDir), "node_modules"), path.join(workDir, "node_modules"))
    await mkdir(path.join(workDir, ".home"))
    await mkdir(path.join(workDir, ".tmp"))

    const runtimeDir = await realpath(options.runtimeDir)
    // bun from PATH (entries under the home folder are dropped), tscircuit from the runtime folder.
    const platform = JSON.stringify(platformConfigFor(options) ?? {})
    const sandbox = sandboxCommand(workDir, runtimeDir, options.secretDirs, ["bun", "run", RUNNER_FILE, entrypoint, platform])
    if (!sandbox) return fail("Build di server butuh sandbox (macOS: sandbox-exec, Linux: bubblewrap/bwrap). Pasang bwrap atau pakai preview browser.")
    const env = { ...shellEnv(process.env), PATH: sandboxPath(), HOME: path.join(workDir, ".home"), TMPDIR: path.join(workDir, ".tmp") }
    const result = await run(sandbox.command, sandbox.args, workDir, env, BUILD_TIMEOUT_MS, options.signal)
    if (result.missing) return fail("bun atau sandbox tidak terpasang di server")
    if (result.timedOut) {
      const hint = options.schematicDisabled
        ? ""
        : " Di board besar yang paling lama adalah skematik: minta pengguna mematikan \"Skematik\" (tombol di header) selama mengerjakan PCB; routing PCB tanpa skematik jauh lebih cepat."
      return fail(`Build melebihi ${BUILD_TIMEOUT_MS / 1000} detik.${hint}`)
    }
    const skipped = skippedLabel(options) || undefined

    const errors: string[] = []
    const warnings: string[] = []
    const circuits = await findCircuitJson(path.join(workDir, "dist"))
    for (const file of circuits) {
      const elements = JSON.parse(await readFile(file, "utf8")) as { type?: string; message?: string }[]
      for (const element of elements) {
        if (!element.type?.endsWith("_error") || !element.message) continue
        if (WARNING_MESSAGE.test(element.message)) warnings.push(element.message)
        else errors.push(`${element.type}: ${element.message}`)
      }
    }
    if (circuits.length === 0) {
      // No circuit at all: the code itself failed (syntax error, bad import…).
      const tail = result.output.trim().split("\n").filter((line) => !/^\s+at /.test(line)).slice(-15).join("\n")
      return { ok: false, errors: [scrub(tail || "Build gagal tanpa keterangan", workDir)], warnings, skipped }
    }
    return { ok: errors.length === 0, errors: errors.slice(0, MAX_MESSAGES).map((e) => scrub(e, workDir)), warnings: warnings.slice(0, MAX_MESSAGES), skipped }
  } finally {
    clearInterval(ticker)
    await rm(workDir, { recursive: true, force: true })
  }
}
