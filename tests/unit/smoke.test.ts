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
