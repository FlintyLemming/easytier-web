import { describe, expect, it } from 'vitest'
import type { CentralNetworkSummary } from '../../src/api/types'
import type { DeviceView } from '../../src/domain/devices'
import { overviewStats } from '../../src/domain/overview'

const dev = (o: Partial<DeviceView>) => ({ online: true, outdated: false, version: '2.7.1-0d9c52b1', ...o }) as DeviceView
const net = (o: Partial<CentralNetworkSummary>) =>
  ({ network_id: 'n', display_name: 'home', virtual_cidr: '10.0.0.0/24', ...o }) as CentralNetworkSummary

describe('overviewStats', () => {
  it('counts devices, networks and outdated; strips the hash from the latest version', () => {
    const devices = [
      dev({}),
      dev({ online: false, outdated: true, version: '2.6.4-8428a89d' }),
      dev({ outdated: true, version: '2.5.0' }),
    ]
    const n = net({})
    expect(overviewStats(devices, [n, net({ network_id: 'm' })], n)).toEqual({
      total: 3, online: 2, offline: 1, networks: 2, primary: { name: 'home', cidr: '10.0.0.0/24' }, outdated: 2, latest: '2.7.1',
    })
  })
  it('primary cidr is null when the network has none; no primary and no parsable version', () => {
    const n = net({ virtual_cidr: null })
    expect(overviewStats([], [n], n).primary).toEqual({ name: 'home', cidr: null })
    const s = overviewStats([dev({ version: '' })], [], null)
    expect(s.primary).toBeNull()
    expect(s.latest).toBeNull()
    expect(s.networks).toBe(0)
  })
})
