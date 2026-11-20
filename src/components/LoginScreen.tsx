import { CircuitBoard, Loader2, Lock } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Button, Field } from "./ui"

interface LoginScreenProps {
  onLogin: (password: string) => Promise<void>
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal login")
      setPassword("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-surface p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-accent)_12%,transparent),transparent_60%)]" />
      <form
        onSubmit={(e) => void submit(e)}
        className="relative w-full max-w-sm space-y-5 rounded-2xl border border-line bg-panel p-7 shadow-2xl shadow-black/30"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/12 text-accent">
            <CircuitBoard size={22} />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-ink">Just Circuit</h1>
            <p className="text-xs text-muted">Masuk untuk membuka studio desain PCB</p>
          </div>
        </div>
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={busy || !password} className="w-full justify-center">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
          Masuk
        </Button>
      </form>
    </div>
  )
}
