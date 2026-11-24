// Capture the central-network API responses the networks page needs (secure-mode network,
// credentials, a temporary member, the empty ACL policy) as test fixtures.
// Needs the running testenv (web v2.7.1 on :11211 + cores). Creates a temporary secure network
// `fixture-secure`, adds core3 to it as a temporary member, captures everything, and always deletes
// the network again (core3 drops its instance within ~30 s):
//   node testenv/capture-network-fixtures.ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, MACHINES, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import { saveAll } from './lib/save-fixtures.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'v2.7.1')
const NAME = 'fixture-secure'
const M = MACHINES.core3
const api = new EtApi(base)
const log = (m: string) => console.log(`[capture-networks] ${m}`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Fixed time the first captured expiry maps to (2030-01-01); the others keep their offsets. */
const EXPIRY_BASE = 1893456000

/**
 * Credential secrets and expiry times are random / clock-dependent: replace them with deterministic
 * values (same id → same placeholder, in order of first appearance) so the fixtures are stable.
 */
function makeStable(files: [string, unknown][]): [string, unknown][] {
  const secrets = new Map<string, string>()
  const expiries: number[] = []
  const walk = (v: Any, visit: (o: Any) => void) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, visit))
    else if (v && typeof v === 'object') {
      visit(v)
      Object.values(v).forEach((x) => walk(x, visit))
    }
  }
  for (const [, data] of files) {
    walk(data, (o) => {
      if (typeof o.expiry_unix === 'number') expiries.push(o.expiry_unix)
      if (typeof o.credential_expiry_unix === 'number') expiries.push(o.credential_expiry_unix)
    })
  }
  const min = expiries.length ? Math.min(...expiries) : 0
  const stableExpiry = (e: number) => EXPIRY_BASE + (e - min)
  return files.map(([name, data]) => {
    const copy = structuredClone(data)
    walk(copy, (o) => {
      if (typeof o.credential_secret === 'string') {
        const id = String(o.credential_id)
        if (!secrets.has(id)) secrets.set(id, Buffer.from(`fixture-cred-${secrets.size + 1}`).toString('base64'))
        o.credential_secret = secrets.get(id)
      }
      if (typeof o.expiry_unix === 'number') o.expiry_unix = stableExpiry(o.expiry_unix)
      if (typeof o.credential_expiry_unix === 'number') o.credential_expiry_unix = stableExpiry(o.credential_expiry_unix)
    })
    return [name, copy]
  })
}

async function existingId(): Promise<string | undefined> {
  const list = await api.get<Any>('/networks')
  return list.networks.find((n: Any) => n.network_name === NAME)?.network_id
}

async function removeNetwork(id: string | undefined) {
  if (!id) return
  try {
    await api.del(`/networks/${id}`)
    log('deleted fixture network')
  } catch (e) {
    log(`delete failed (ignored if absent): ${e instanceof Error ? e.message : e}`)
  }
  try {
    await waitFor(async () => {
      const r = await api.get<Any>(`/machines/${M}/networks`)
      return r.running_inst_ids.map(uuidToStr).includes(id) ? undefined : true
    }, 90_000, 'core3 drops the fixture network')
    log('core3 no longer runs the fixture network')
  } catch (e) {
    log(`warning: ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await waitForApi(api)
  await api.login('admin', 'admin')
  await removeNetwork(await existingId()) // leftover of an earlier failed run

  let id: string | undefined
  try {
    const created = await api.post<Any>('/networks', {
      settings: {
        display_name: NAME,
        network_name: NAME,
        networking_method: 'Standalone',
        public_server_url: null,
        peer_urls: [],
        virtual_cidr: '10.201.0.0/24',
        secure_mode: true,
      },
      network_secret: 'fixture-secure-secret',
    })
    id = created.network_id as string
    log(`created ${id}`)

    const networks = await api.get<Any>('/networks')
    const network = await api.get<Any>(`/networks/${id}`)
    const aclEmpty = await api.get<Any>(`/networks/${id}/acl-policy`)

    const credCreated = await api.post<Any>(`/networks/${id}/credentials`, { ttl_seconds: 86400, credential_id: 'fixture-cred' })
    await api.post<Any>(`/networks/${id}/credentials`, { ttl_seconds: 3600, reusable: false })

    await api.post(`/networks/${id}/members`, { device_ids: [M], temporary: true, ttl_seconds: 3600 })
    log('core3 added as a temporary member; waiting for running')
    const members = await waitFor(async () => {
      const r = await api.get<Any>(`/networks/${id}/members`)
      return r.members.some((m: Any) => m.device_id === M && m.running === true) ? r : undefined
    }, 60_000, 'temporary member running')
    const credentials = await api.get<Any>(`/networks/${id}/credentials`)

    saveAll(outDir, makeStable([
      ['network-created.json', created],
      ['networks-two.json', networks],
      ['network-secure.json', network],
      ['acl-policy-empty.json', aclEmpty],
      ['credential-created.json', credCreated],
      ['members-secure.json', members],
      ['credentials.json', credentials],
    ]), log)
  } finally {
    await removeNetwork(id)
  }
}

await main()
