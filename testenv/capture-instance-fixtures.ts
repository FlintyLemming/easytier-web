// Capture the per-device manual-instance / TOML / VPN Portal API responses as test fixtures.
// Needs the running testenv (web v2.7.1 on :11211 + cores) and the central network already captured
// (tests/fixtures/v2.7.1/index.json). Creates a temporary instance `lab-manual` on core2, captures
// everything, and always deletes the instance again:
//   node testenv/capture-instance-fixtures.ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import { saveAll } from './lib/save-fixtures.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'v2.7.1')
const INST = '5eed0000-0000-4000-8000-000000000001'
const M = MACHINES.core2
const api = new EtApi(base)
const log = (m: string) => console.log(`[capture-instances] ${m}`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const config = {
  instance_id: INST,
  hostname: 'lab-manual',
  network_name: 'lab-manual',
  network_secret: 'fixture-secret',
  networking_method: 'Manual',
  peer_urls: [],
  listener_urls: [],
  dhcp: false,
  virtual_ipv4: '10.88.0.3',
  network_length: 24,
  routes: ['10.99.0.0/16'],
  enable_manual_routes: true,
  exit_nodes: ['10.144.144.1'],
  enable_socks5: true,
  socks5_port: 1081,
  mapped_listeners: ['tcp://203.0.113.10:11010'],
  enable_relay_network_whitelist: true,
  relay_network_whitelist: ['lab-*'],
  port_forwards: [{ bind_ip: '0.0.0.0', bind_port: 18080, dst_ip: '10.88.0.9', dst_port: 80, proto: 'tcp' }],
  acl: {
    acl_v1: {
      chains: [
        {
          name: 'lab-inbound',
          chain_type: 'Inbound',
          description: 'fixture chain',
          enabled: true,
          default_action: 'Allow',
          rules: [
            {
              name: 'deny-ssh',
              description: '',
              priority: 100,
              enabled: true,
              protocol: 'TCP',
              ports: ['22'],
              source_ips: [],
              destination_ips: [],
              source_ports: [],
              action: 'Drop',
              rate_limit: 0,
              burst_limit: 0,
              stateful: false,
              source_groups: [],
              destination_groups: [],
            },
          ],
        },
      ],
    },
  },
  dns: { domain: 'lab.et' },
  // The testenv cores are v2.6.4: they only know the legacy VPN portal fields, and silently drop the
  // v2.7 `vpn_portal_config` (web v2.7.1 rejects both forms at once), so the legacy form is what runs.
  enable_vpn_portal: true,
  vpn_portal_listen_port: 22022,
  vpn_portal_client_network_addr: '10.88.1.0',
  vpn_portal_client_network_len: 24,
}

async function removeInstance() {
  try {
    await api.del(`/machines/${M}/networks/${INST}`)
    log('deleted fixture instance')
  } catch (e) {
    log(`delete failed (ignored if absent): ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await waitForApi(api)
  await api.login('admin', 'admin')
  const { networkId } = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'))

  // The member config must be empty; never touch an existing override.
  const memberConfig = await api.get<Any>(`/networks/${networkId}/members/${M}/config`)
  if (JSON.stringify(memberConfig) !== '{}') {
    throw new Error(`core2 already has a member override ${JSON.stringify(memberConfig)}; refusing to continue`)
  }

  await removeInstance() // leftover of an earlier failed run
  try {
    await api.post(`/machines/${M}/networks`, { config, save: true })
    log('instance started; waiting for running')
    const info = () => api.get<Any>(`/machines/${M}/networks/info/${INST}`)
    await waitFor(async () => {
      const r = await info()
      return r?.info?.map?.[INST]?.running ? true : undefined
    }, 60_000, 'instance running')

    const rpc = (service: string, method: string, payload: unknown) =>
      api.post<Any>(`/machines/${M}/proxy-rpc`, { service_name: service, method_name: method, payload })

    const instances = await api.get<Any>(`/machines/${M}/networks`)
    const metas = await api.post<Any>(`/machines/${M}/networks/metas`, {
      instance_ids: [...instances.running_inst_ids, ...instances.disabled_inst_ids].map(uuidToStr),
    })
    const gotConfig = await api.get<Any>(`/machines/${M}/networks/config/${INST}`)
    const runningInfo = await info()
    const vpn = await rpc('api.instance.VpnPortalRpcService', 'get_vpn_portal_info', { instance: { id: strToUuid(INST) } })

    await api.put(`/machines/${M}/networks/${INST}`, { disabled: true })
    log('instance disabled')
    const disabledInfo = await info()

    // web v2.7.1 refuses the legacy VPN portal fields in generate-config: send the v2.7 form instead.
    const {
      enable_vpn_portal: _a, vpn_portal_listen_port: _b, vpn_portal_client_network_addr: _c, vpn_portal_client_network_len: _d,
      ...rest
    } = gotConfig
    const generated = await api.post<Any>('/generate-config', {
      config: { ...rest, vpn_portal_config: { enabled: true, wireguard_listen: '0.0.0.0:22022', clients: [] } },
    })
    if (generated.error || !generated.toml_config) throw new Error(`generate-config failed: ${JSON.stringify(generated)}`)
    const parsedOk = await api.post<Any>('/parse-config', { toml_config: generated.toml_config })
    const parsedErr = await api.post<Any>('/parse-config', { toml_config: 'network_name = [' })

    saveAll(outDir, [
      ['instances-core2.json', instances],
      ['instance-metas-core2.json', metas],
      ['instance-config-core2.json', gotConfig],
      ['instance-info-core2.json', runningInfo],
      ['instance-info-disabled.json', disabledInfo],
      ['member-config-empty.json', memberConfig],
      ['parse-config-ok.json', parsedOk],
      ['parse-config-error.json', parsedErr],
      ['generate-config-ok.json', generated],
      ['vpn-portal-info-core2.json', vpn],
    ], log)
    const me = runningInfo.info.map[INST].my_node_info
    log(`running info virtual_ipv4 = ${JSON.stringify(me?.virtual_ipv4)}`)
  } finally {
    await removeInstance()
    const after = await api.get<Any>(`/machines/${M}/networks`)
    log(`core2 instances afterwards: running=${after.running_inst_ids.length} disabled=${after.disabled_inst_ids.length}`)
  }
}

await main()
