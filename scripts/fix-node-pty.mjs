// node-pty's macOS prebuilds ship spawn-helper without the execute bit when installed by pnpm,
// which makes every terminal fail with "posix_spawnp failed". Restore it after install.
import { chmodSync, existsSync, readdirSync, realpathSync } from "node:fs"
import path from "node:path"

const root = path.join(process.cwd(), "node_modules", "node-pty")
if (existsSync(root)) {
  const prebuilds = path.join(realpathSync(root), "prebuilds")
  for (const platform of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
    const helper = path.join(prebuilds, platform, "spawn-helper")
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
