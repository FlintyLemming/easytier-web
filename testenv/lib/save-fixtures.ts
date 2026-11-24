import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redact } from './redact.ts'

// Writes every fixture in one go, only after all responses were fetched: first into a temp dir
// next to outDir, then each file is renamed into place, so a failed run never leaves a mix of
// old and new fixtures. Every fixture goes through redact(): no real public IPs (STUN /
// public_ipv4) or ACL group secrets get committed.
export function saveAll(outDir: string, files: [string, unknown][], log: (m: string) => void = console.log) {
  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(dirname(outDir), '.capture-'))
  try {
    for (const [name, data] of files) writeFileSync(join(tmp, name), `${JSON.stringify(redact(data), null, 2)}\n`)
    for (const [name] of files) {
      renameSync(join(tmp, name), join(outDir, name))
      log(`wrote ${name}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
