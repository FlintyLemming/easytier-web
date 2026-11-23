// Capture real v2.7.1 central-mode API responses as test fixtures.
// Run on a FRESH v2.7.1 env (web v2.7.1, cores v2.6.4):
//   ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d && node testenv/capture-fixtures.ts
// Rerunnable: an existing `home-central` network is reused.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import { redact } from './lib/redact.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tests', 'fixtures', 'v2.7.1')
const composeFile = join(here, 'docker-compose.yml')
const CORE4_ID = '44444444-4444-4444-8444-444444444444'
const NET_NAME = 'home-central'

const api = new EtApi(base)
const log = (m: string) => console.log(`[capture] ${m}`)
const sh = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim()

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const mid = (m: Any): string => {
  const i = m?.info?.machine_id
  return (typeof i === 'string' ? i : i ? uuidToStr(i) : '').toLowerCase()
}

function composeNetwork(): string {
  const out = sh(['compose', '-f', composeFile, 'ps', '--format', 'json'])
  for (const line of out.split('\n').filter(Boolean)) {
    const o = JSON.parse(line)
    const nets = String(o.Networks ?? '').split(',').filter(Boolean)
    if (nets.length) return nets[0]!
  }
  throw new Error('cannot determine compose network')
}

// Every fixture goes through redact(): no real public IPs (STUN / public_ipv4) or ACL group secrets get committed.
function save(name: string, data: unknown) {
  writeFileSync(join(outDir, name), `${JSON.stringify(redact(data), null, 2)}\n`)
  log(`wrote ${name}`)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  await waitForApi(api)
  await api.login('admin', 'admin')

  log('waiting for core1..3 online')
  await waitFor(async () => {
    const r = await api.get<Any>('/machines')
    const on = new Set((r.machines ?? []).filter((m: Any) => m.online).map(mid))
    return Object.values(MACHINES).every((id) => on.has(id)) ? true : undefined
  }, 120_000, 'core1..3 online')

  // network (reuse if present)
  const nets = await api.get<Any>('/networks')
  let networkId: string | undefined = (nets.networks ?? []).find((n: Any) => n.network_name === NET_NAME || n.display_name === NET_NAME)?.network_id
  if (networkId) log(`reusing network ${networkId}`)
  else {
    const created = await api.post<Any>('/networks', {
      settings: {
        display_name: NET_NAME,
        network_name: NET_NAME,
        networking_method: 'Manual',
        peer_urls: ['tcp://core1:11010'],
        virtual_cidr: '10.144.144.0/24',
      },
      network_secret: 'home-secret',
    })
    networkId = created.network_id
    log(`created network ${networkId}`)
  }
  const nid = networkId!

  // members
  const cur = await api.get<Any>(`/networks/${nid}/members`)
  const have = new Set((cur.members ?? []).map((m: Any) => String(m.device_id).toLowerCase()))
  const missing = Object.values(MACHINES).filter((id) => !have.has(id))
  if (missing.length) await api.post(`/networks/${nid}/members`, { device_ids: missing })
  // core1 is the Manual-mode peer (tcp://core1:11010) so it must listen there; central instances have no listener by default.
  await api.put(`/networks/${nid}/members/${MACHINES.core1}/config`, {
    config: { listener_urls: ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'] },
  })
  await api.patch(`/networks/${nid}/members/${MACHINES.core1}`, { virtual_ipv4: '10.144.144.1' })
  await api.patch(`/networks/${nid}/members/${MACHINES.core3}`, {
    proxy_cidrs: ['192.168.77.0/24'],
    hostname_override: 'lab-box',
  })

  // ACL
  const members0 = await api.get<Any>(`/networks/${nid}/members`)
  const core3 = (members0.members ?? []).find((m: Any) => String(m.device_id).toLowerCase() === MACHINES.core3)
  const core3MemberId = core3?.member_id ?? core3?.id
  if (!core3MemberId) throw new Error(`core3 member has no member_id: ${JSON.stringify(core3)}`)
  await api.put(`/networks/${nid}/acl-policy`, {
    default_action: 'allow',
    rules: [
      {
        id: 'r1',
        name: 'deny-lab-ssh',
        enabled: true,
        action: 'deny',
        sources: [{ type: 'all' }],
        destinations: [{ type: 'member', member_id: core3MemberId }],
        protocols: [{ protocol: 'tcp', ports: ['22'], stateful: true }],
      },
    ],
  })

  // blocked device
  const blockedHas = async () => {
    const r = await api.get<Any>('/blocked-devices')
    return (r.blocked ?? []).find((b: Any) => JSON.stringify(b).toLowerCase().includes(CORE4_ID))
  }
  const existing = await blockedHas()
  if (existing && Number(existing.attempt_count) >= 1) log('core4 already blocked with attempts, skipping')
  else {
    const net = composeNetwork()
    try {
      sh(['rm', '-f', 'et-core4'])
      sh(['run', '-d', '--name', 'et-core4', '--network', net, '--cap-add', 'NET_ADMIN', '--device', '/dev/net/tun',
        'easytier/easytier:v2.6.4', '--config-server', 'udp://web:22020/admin', '--machine-id', CORE4_ID])
      log('et-core4 started, waiting for registration')
      const m = await waitFor(async () => {
        const r = await api.get<Any>('/machines')
        return (r.machines ?? []).find((x: Any) => mid(x) === CORE4_ID)
      }, 90_000, 'core4 registered')
      await api.del(`/machines/${CORE4_ID}?block=true`)
      log(`blocked core4 (${m.info?.hostname})`)
      await new Promise((r) => setTimeout(r, 3000))
      sh(['restart', 'et-core4'])
      await waitFor(async () => {
        const b = await blockedHas()
        return b && Number(b.attempt_count) >= 1 ? b : undefined
      }, 90_000, 'blocked attempt_count >= 1')
    } finally {
      try { sh(['rm', '-f', 'et-core4']) } catch (e) { console.error('failed to remove et-core4', e) }
    }
  }

  // runtime ready
  log('waiting for members running and routes')
  await waitFor(async () => {
    const r = await api.get<Any>(`/networks/${nid}/members`)
    const ms = r.members ?? []
    if (ms.length !== 3 || !ms.every((m: Any) => m.running)) return undefined
    const rt = await api.post<Any>(`/machines/${MACHINES.core1}/proxy-rpc`, {
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'list_route',
      payload: { instance: { id: strToUuid(nid) } },
    })
    return (rt.routes ?? []).length >= 2 ? true : undefined
  }, 180_000, 'members running + core1 sees 2 other routes')
  // give latency stats a moment
  await new Promise((r) => setTimeout(r, 10_000))

  const rpc = (machine: string, service: string, method: string, payload: unknown) =>
    api.post<Any>(`/machines/${machine}/proxy-rpc`, { service_name: service, method_name: method, payload })
  const inst = { instance: { id: strToUuid(nid) } }
  const PM = 'api.instance.PeerManageRpcService'

  save('console-info.json', await api.get('/console-info'))
  save('summary.json', await api.get('/summary'))
  save('machines.json', await api.get('/machines'))
  save('networks.json', await api.get('/networks'))
  save('network.json', await api.get(`/networks/${nid}`))
  save('members.json', await api.get(`/networks/${nid}/members`))
  save('member-config-core3.json', await api.get(`/networks/${nid}/members/${MACHINES.core3}/config`))
  save('acl-policy.json', await api.get(`/networks/${nid}/acl-policy`))
  save('gateway-info.json', await api.get('/networks/gateway-info'))
  save('blocked-devices.json', await api.get('/blocked-devices'))
  save('list-route-core1.json', await rpc(MACHINES.core1, PM, 'list_route', inst))
  save('list-peer-core1.json', await rpc(MACHINES.core1, PM, 'list_peer', inst))
  save('show-node-info-core3.json', await rpc(MACHINES.core3, PM, 'show_node_info', inst))
  save('logger-level.json', await rpc(MACHINES.core1, 'api.logger.LoggerRpcService', 'get_logger_config', {}))
  save('index.json', { networkId: nid, machines: { core1: MACHINES.core1, core2: MACHINES.core2, core3: MACHINES.core3 } })
}

await main()
