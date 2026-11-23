import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8')

describe('design tokens', () => {
  it('contains the Cursor palette', () => {
    for (const hex of ['#f7f7f4', '#26251e', '#f54e00', '#cfcdc4']) {
      expect(css).toContain(hex)
    }
  })
  it('never uses shadows', () => {
    expect(css).not.toContain('box-shadow')
  })
})

describe('base.css', () => {
  const base = readFileSync(resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  it('keeps all rules inside @layer base', () => {
    expect(base).toContain('@layer base')
    const trimmed = base.trim()
    expect(trimmed.startsWith('@layer base {')).toBe(true)
    expect(trimmed.endsWith('}')).toBe(true)
    // the outer block must be the only top-level block: braces return to depth 0 only at the end
    let depth = 0
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++
      if (trimmed[i] === '}') {
        depth--
        if (depth === 0) expect(i).toBe(trimmed.length - 1)
      }
    }
  })
  it('defines caption-uppercase', () => {
    expect(base).toContain('.caption-uppercase')
  })
})
