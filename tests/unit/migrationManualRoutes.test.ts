import { describe, expect, it } from 'vitest'
import { manualRoutesOf, readManualRoutes, restoreManualRoutes } from '../../src/domain/migration/manualRoutes'

const ID = '11111111-2222-4333-8444-555555555555'
const toml = (routes: string, id = ID) => `hostname = "h"\ninstance_id = "${id}"\n${routes}\n\n[network_identity]\nnetwork_name = "n"\n\n[flags]\n`

describe('manual routes (a 2.6.4 core reports routes = [] without the manual-mode flag)', () => {
  it('reads the top-level routes of the instance TOML: absent, empty, a list, multi-line, single quotes, no spaces, CRLF', () => {
    expect(readManualRoutes(toml(''), ID)).toEqual({ known: true, routes: null })
    expect(readManualRoutes(toml('routes = []'), ID)).toEqual({ known: true, routes: [] })
    expect(readManualRoutes(toml('routes=[]'), ID)).toEqual({ known: true, routes: [] })
    expect(readManualRoutes(toml('routes = ["10.0.0.0/24", \'10.1.0.0/16\']  # two'), ID)).toEqual({ known: true, routes: ['10.0.0.0/24', '10.1.0.0/16'] })
    expect(readManualRoutes(toml('routes = [\n    "10.0.0.0/24",\n    "10.1.0.0/16",\n]'), ID)).toEqual({ known: true, routes: ['10.0.0.0/24', '10.1.0.0/16'] })
    expect(readManualRoutes(toml('routes = []').replace(/\n/g, '\r\n'), ID)).toEqual({ known: true, routes: [] })
    // A `routes` key inside a table is not the instance's routes.
    expect(readManualRoutes(`instance_id = "${ID}"\n\n[flags]\nroutes = []\n`, ID)).toEqual({ known: true, routes: null })
  })

  it('an empty answer, a TOML without instance_id, or another instance\'s TOML is unknown', () => {
    expect(readManualRoutes('', ID)).toEqual({ known: false })
    expect(readManualRoutes('routes = []\n', ID)).toEqual({ known: false })
    expect(readManualRoutes(toml('routes = []', '99999999-2222-4333-8444-555555555555'), ID)).toEqual({ known: false })
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
