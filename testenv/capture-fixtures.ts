// Capture real v2.7.1 central-mode API responses as test fixtures.
// Run on a FRESH v2.7.1 env (web v2.7.1, cores v2.6.4):
//   ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d && node testenv/capture-fixtures.ts
// Rerunnable: an existing `home-central` network is reused.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import { saveAll as save } from './lib/save-fixtures.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tests', 'fixtures', 'v2.7.1')
const composeFile = join(here, 'docker-compose.yml')
const CORE4_ID = '44444444-4444-4444-8444-444444444444'
// The temporary blocked device runs the same core version as core1..3 (docker-compose.yml default).
const CORE_TAG = process.env.ET_CORE_TAG ?? 'v2.6.4'
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

async function main() {
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
        `easytier/easytier:${CORE_TAG}`, '--config-server', 'udp://web:22020/admin', '--machine-id', CORE4_ID])
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

  // runtime ready: members running AND the PATCHed / PUT state above is what the cores run
  log('waiting for members running, routes and the patched member state')
  let readyState = 'nothing yet'
  await waitFor(async () => {
    const r = await api.get<Any>(`/networks/${nid}/members`)
    const ms = r.members ?? []
    const byDev = (id: string) => ms.find((m: Any) => String(m.device_id).toLowerCase() === id)
    const ip1 = byDev(MACHINES.core1)?.runtime_virtual_ipv4
    readyState = `members=${ms.length} running=${ms.filter((m: Any) => m.running).length} core1 ip=${ip1}`
    if (ms.length !== 3 || !ms.every((m: Any) => m.running)) return undefined
    if (typeof ip1 !== 'string' || !ip1.startsWith('10.144.144.1/')) return undefined
    const rt = await api.post<Any>(`/machines/${MACHINES.core1}/proxy-rpc`, {
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'list_route',
      payload: { instance: { id: strToUuid(nid) } },
    })
    const routes = rt.routes ?? []
    const lab = routes.find((x: Any) => x.hostname === 'lab-box')
    readyState += ` routes=[${routes.map((x: Any) => x.hostname).join(',')}] lab-box proxy_cidrs=${JSON.stringify(lab?.proxy_cidrs)}`
    if (routes.length < 2 || !lab || !(lab.proxy_cidrs ?? []).includes('192.168.77.0/24')) return undefined
    const ni = await api.post<Any>(`/machines/${MACHINES.core3}/proxy-rpc`, {
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'show_node_info',
      payload: { instance: { id: strToUuid(nid) } },
    })
    const acl = String(ni?.node_info?.config ?? '').includes('deny-lab-ssh')
    readyState += ` core3 acl=${acl}`
    return acl ? true : undefined
  }, 180_000, 'members running, core1 at 10.144.144.1, core3 route named lab-box with proxy_cidrs, ACL on core3').catch((e) => {
    throw new Error(`${e instanceof Error ? e.message : String(e)}; last state: ${readyState}`)
  })
  // give latency stats a moment
  await new Promise((r) => setTimeout(r, 10_000))

  const rpc = (machine: string, service: string, method: string, payload: unknown) =>
    api.post<Any>(`/machines/${machine}/proxy-rpc`, { service_name: service, method_name: method, payload })
  const inst = { instance: { id: strToUuid(nid) } }
  const PM = 'api.instance.PeerManageRpcService'

  const files: [string, unknown][] = [
    ['console-info.json', await api.get('/console-info')],
    ['summary.json', await api.get('/summary')],
    ['machines.json', await api.get('/machines')],
    ['networks.json', await api.get('/networks')],
    ['network.json', await api.get(`/networks/${nid}`)],
    ['members.json', await api.get(`/networks/${nid}/members`)],
    ['member-config-core3.json', await api.get(`/networks/${nid}/members/${MACHINES.core3}/config`)],
    ['acl-policy.json', await api.get(`/networks/${nid}/acl-policy`)],
    ['gateway-info.json', await api.get('/networks/gateway-info')],
    ['blocked-devices.json', await api.get('/blocked-devices')],
    ['list-route-core1.json', await rpc(MACHINES.core1, PM, 'list_route', inst)],
    ['list-peer-core1.json', await rpc(MACHINES.core1, PM, 'list_peer', inst)],
    ['show-node-info-core3.json', await rpc(MACHINES.core3, PM, 'show_node_info', inst)],
    ['logger-level.json', await rpc(MACHINES.core1, 'api.logger.LoggerRpcService', 'get_logger_config', {})],
    ['index.json', { networkId: nid, machines: { core1: MACHINES.core1, core2: MACHINES.core2, core3: MACHINES.core3 } }],
  ]
  save(outDir, files, log)
}

await main()
