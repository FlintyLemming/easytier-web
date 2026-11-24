// Builds src/generated/geo/* from Natural Earth v5.1.2 and world-atlas. Run: npm run geo
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { geoBounds, geoContains } from 'd3-geo'
import { feature } from 'topojson-client'
import { nameKeys } from '../src/domain/geo/normalize.ts'

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
const FILES = [
  'ne_10m_populated_places.geojson',
  'ne_10m_admin_1_states_provinces.geojson',
  'ne_50m_admin_0_countries.geojson',
]
const ROOT = new URL('..', import.meta.url)
const CACHE = new URL('.cache/natural-earth/', ROOT)
const OUT = new URL('src/generated/geo/', ROOT)
const MAX_GZIP = 150 * 1024

const COUNTRY_ALIASES: Record<string, string[]> = {
  CN: ['中国', '中国大陆'],
  TW: ['台湾', '中国台湾', '台湾省'],
  HK: ['中国香港'],
  MO: ['中国澳门'],
  KR: ['韩国', '南韩'],
  KP: ['朝鲜', '北韩'],
  US: ['美国', 'United States'],
  GB: ['英国'],
  RU: ['俄罗斯'],
}
const REGION_COUNTRIES = new Set(['CN', 'US', 'CA', 'AU', 'JP', 'KR', 'DE', 'GB', 'FR', 'RU', 'IN', 'BR'])

type Props = Record<string, unknown>
type Row = [string, number, number, string]
type CityRow = [string, number, number, string, number]

async function load(name: string): Promise<{ features: { properties: Props }[] }> {
  mkdirSync(CACHE, { recursive: true })
  const file = new URL(name, CACHE)
  if (!existsSync(file)) {
    console.log(`downloading ${name}`)
    const res = await fetch(BASE + name)
    if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const round2 = (n: number): number => Math.round(n * 100) / 100

function keysOf(names: string[]): string {
  const keys = new Set<string>()
  for (const n of names) {
    if (!n) continue
    for (const k of nameKeys(n)) if (k) keys.add(k)
  }
  return [...keys].join('|')
}

function splitAlt(v: unknown): string[] {
  return str(v).split('|')
}

function sortRows<T extends [string, number, number, string]>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
    const ka = a[3].split('|')[0]!
    const kb = b[3].split('|')[0]!
    if (ka !== kb) return ka < kb ? -1 : 1
    return a[1] - b[1] || a[2] - b[2]
  })
}

function buildCountries(data: { features: { properties: Props }[] }): Row[] {
  const best = new Map<string, Props>()
  for (const { properties: p } of data.features) {
    const iso = str(p.ISO_A2_EH)
    if (!iso || iso === '-99') continue
    const prev = best.get(iso)
    if (!prev || Number(p.POP_EST) > Number(prev.POP_EST)) best.set(iso, p)
  }
  const rows: Row[] = []
  for (const [iso, p] of best) {
    const names = [p.NAME, p.NAME_EN, p.NAME_LONG, p.ADMIN, p.NAME_ZH, p.NAME_ZHT].map(str)
    names.push(...(COUNTRY_ALIASES[iso] ?? []))
    rows.push([iso, round2(Number(p.LABEL_X)), round2(Number(p.LABEL_Y)), keysOf(names)])
  }
  return sortRows(rows)
}

function buildRegions(data: { features: { properties: Props }[] }): Row[] {
  const rows: Row[] = []
  for (const { properties: p } of data.features) {
    const iso = str(p.iso_a2)
    if (!REGION_COUNTRIES.has(iso)) continue
    const names = [p.name, p.name_en, p.name_zh, p.name_zht].map(str).concat(splitAlt(p.name_alt))
    rows.push([iso, round2(Number(p.longitude)), round2(Number(p.latitude)), keysOf(names)])
  }
  return sortRows(rows)
}

function buildCities(data: { features: { properties: Props }[] }, minPop: number, withZht: boolean): CityRow[] {
  const rows: CityRow[] = []
  for (const { properties: p } of data.features) {
    const iso = str(p.ISO_A2)
    const pop = Number(p.POP_MAX)
    const keep =
      iso === 'CN' || pop >= minPop || Number(p.ADM0CAP) === 1 || Number(p.WORLDCITY) === 1
    if (!keep) continue
    const names = [p.NAME, p.NAMEASCII, p.NAME_EN, p.NAME_ZH].map(str)
    if (withZht) names.push(str(p.NAME_ZHT))
    names.push(...splitAlt(p.NAMEALT))
    rows.push([iso, round2(Number(p.LONGITUDE)), round2(Number(p.LATITUDE)), keysOf(names), pop])
  }
  return sortRows(rows) as CityRow[]
}

function buildLandMask(): string {
  const require = (name: string) => JSON.parse(readFileSync(new URL(`node_modules/${name}`, ROOT), 'utf8'))
  const topo = require('world-atlas/land-110m.json')
  const fc: any = feature(topo, topo.objects.land)
  const features: any[] = fc.type === 'FeatureCollection' ? fc.features : [fc]
  const polys: { geom: any; w: number; s: number; e: number; n: number }[] = []
  for (const f of features) {
    const g = f.geometry
    const parts = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    for (const coordinates of parts) {
      const geom = { type: 'Polygon', coordinates }
      const [[w, s], [e, n]] = geoBounds(geom)
      polys.push({ geom, w: w!, s: s!, e: e!, n: n! })
    }
  }
  const W = 720
  const H = 360
  const bytes = new Uint8Array((W * H) >> 3)
  for (let row = 0; row < H; row++) {
    const lat = 89.75 - row * 0.5
    for (let col = 0; col < W; col++) {
      const lon = -179.75 + col * 0.5
      const i = row * W + col
      const hit = polys.some((p) => {
        if (lat < p.s || lat > p.n) return false
        const inLon = p.w <= p.e ? lon >= p.w && lon <= p.e : lon >= p.w || lon <= p.e
        return inLon && geoContains(p.geom, [lon, lat])
      })
      if (hit) bytes[i >> 3]! |= 1 << (7 - (i & 7))
    }
  }
  return Buffer.from(bytes).toString('base64')
}

function report(label: string, content: string): number {
  const gz = gzipSync(content).length
  console.log(`${label}: ${Buffer.byteLength(content)} bytes, ${gz} bytes gzip`)
  return gz
}

const started = Date.now()
const [placesData, adminData, countryData] = await Promise.all(FILES.map(load))

// Size ruling: if over budget, first drop NAME_ZHT from cities, then raise the non-CN threshold.
const attempts: [number, boolean][] = [
  [100000, true],
  [100000, false],
  [150000, false],
]
let json = ''
let cityCount = 0
for (const [minPop, withZht] of attempts) {
  const cities = buildCities(placesData!, minPop, withZht)
  json = JSON.stringify({
    version: 1,
    source: 'Natural Earth v5.1.2 (public domain)',
    countries: buildCountries(countryData!),
    regions: buildRegions(adminData!),
    cities,
  })
  cityCount = cities.length
  if (gzipSync(json).length <= MAX_GZIP) break
  console.log(`places.json over budget (minPop=${minPop}, zht=${withZht}), trimming`)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(new URL('places.json', OUT), json)
const bits = buildLandMask()
const maskSrc =
  `// Generated by scripts/build-geo.ts. Do not edit.\n` +
  `export const LAND_MASK: { width: 720; height: 360; bits: string } = {\n` +
  `  width: 720,\n  height: 360,\n  bits: '${bits}',\n}\n`
writeFileSync(new URL('landMask.ts', OUT), maskSrc)
writeFileSync(
  new URL('SOURCE.md', OUT),
  `# Geo data sources

Files in this directory are generated by \`npm run geo\` (\`scripts/build-geo.ts\`). Do not edit by hand.

- Natural Earth v5.1.2 (\`ne_10m_populated_places\`, \`ne_10m_admin_1_states_provinces\`, \`ne_50m_admin_0_countries\`), downloaded from
  \`${BASE}\`. Natural Earth is public domain.
- Land mask: \`world-atlas/land-110m.json\` (ISC license), rasterised at 0.5 degrees.

Regenerate with:

\`\`\`
npm run geo
\`\`\`
`,
)

const gz = report('places.json', json)
report('landMask.ts', maskSrc)
console.log(`cities: ${cityCount}, runtime ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (gz > MAX_GZIP) {
  console.error('places.json exceeds 150KB gzip')
  process.exit(1)
}
