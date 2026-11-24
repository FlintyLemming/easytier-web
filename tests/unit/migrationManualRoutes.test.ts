import { describe, expect, it } from 'vitest'
import { manualRoutesFromToml, manualRoutesOf, restoreManualRoutes } from '../../src/domain/migration/manualRoutes'

const toml = (routes: string) => `hostname = "h"\ninstance_id = "x"\n${routes}\n\n[network_identity]\nnetwork_name = "n"\n\n[flags]\n`

describe('manual routes (a 2.6.4 core reports routes = [] without the manual-mode flag)', () => {
  it('reads the top-level routes line of a TOML: absent, empty, a list, a multi-line list', () => {
    expect(manualRoutesFromToml(toml(''))).toBeNull()
    expect(manualRoutesFromToml(toml('routes = []'))).toEqual([])
    expect(manualRoutesFromToml(toml('routes = ["10.0.0.0/24", "10.1.0.0/16"]'))).toEqual(['10.0.0.0/24', '10.1.0.0/16'])
    expect(manualRoutesFromToml(toml('routes = [\n    "10.0.0.0/24",\n    "10.1.0.0/16",\n]'))).toEqual(['10.0.0.0/24', '10.1.0.0/16'])
    // A `routes` key inside a table is not the instance's routes.
    expect(manualRoutesFromToml('instance_id = "x"\n\n[flags]\nroutes = []\n')).toBeNull()
  })

  it('manualRoutesOf: the routes of a config in manual mode, else null', () => {
    expect(manualRoutesOf({ enable_manual_routes: true, routes: [] })).toEqual([])
    expect(manualRoutesOf({ enable_manual_routes: true, routes: ['10.0.0.0/24'] })).toEqual(['10.0.0.0/24'])
    expect(manualRoutesOf({ routes: [] })).toBeNull()
  })

  it('restoreManualRoutes puts the mode back; automatic or already set leaves the config as it is', () => {
    const lossy = { network_name: 'n', routes: [] }
    expect(restoreManualRoutes(lossy, [])).toEqual({ network_name: 'n', routes: [], enable_manual_routes: true })
    expect(restoreManualRoutes(lossy, null)).toBe(lossy)
    const set = { enable_manual_routes: true, routes: ['10.0.0.0/24'] }
    expect(restoreManualRoutes(set, [])).toBe(set)
  })
})
