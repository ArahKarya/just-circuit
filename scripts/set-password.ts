// Prints a JUST_CIRCUIT_PASSWORD_HASH line for .env. Usage: pnpm set-password
import { createInterface } from "node:readline/promises"
import { hashPassword } from "../server/security/password.js"

const MIN_LENGTH = 10

async function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Hide what is typed: write the prompt once, then swallow echoed characters.
  const output = rl as unknown as { _writeToOutput: (text: string) => void }
  process.stdout.write(prompt)
  output._writeToOutput = () => undefined
  const answer = await rl.question("")
  rl.close()
  process.stdout.write("\n")
  return answer
}

const password = await readHidden("Password baru: ")
if (password.length < MIN_LENGTH) {
  console.error(`Password minimal ${MIN_LENGTH} karakter.`)
  process.exit(1)
}
if ((await readHidden("Ulangi password: ")) !== password) {
  console.error("Password tidak sama.")
  process.exit(1)
}
console.log("\nTambahkan baris ini ke .env lalu restart server:\n")
console.log(`JUST_CIRCUIT_PASSWORD_HASH='${await hashPassword(password)}'`)
