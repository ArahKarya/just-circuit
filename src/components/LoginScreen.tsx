import { CircuitBoard, Loader2 } from "lucide-react"
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
    <div className="flex h-full items-center justify-center bg-surface p-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-panel p-6">
        <div className="flex items-center gap-2">
          <CircuitBoard size={22} className="text-accent" />
          <h1 className="text-base font-semibold">Just Circuit</h1>
        </div>
        <Field label="Password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !password} className="w-full justify-center">
          {busy && <Loader2 size={14} className="animate-spin" />}Masuk
        </Button>
      </form>
    </div>
  )
}
