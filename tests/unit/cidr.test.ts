import { describe, expect, it } from 'vitest'
import { candidateCidrs, isIpv4, isIpv4Cidr } from '../../src/domain/cidr'

describe('isIpv4 / isIpv4Cidr', () => {
  it('accepts well-formed values', () => {
    expect(isIpv4('10.144.144.9')).toBe(true)
    expect(isIpv4Cidr('192.168.1.0/24')).toBe(true)
    expect(isIpv4Cidr('0.0.0.0/0')).toBe(true)
    expect(isIpv4Cidr('10.0.0.1/32')).toBe(true)
  })

  it('rejects malformed values', () => {
    for (const s of ['', '10.0.0', '10.0.0.256', '10.0.0.1/33', '10.0.0.1/', '10.0.0.1/-1', 'a.b.c.d/24', ' 10.0.0.0/8', '010.0.0.0/8']) {
      expect(isIpv4Cidr(s), s).toBe(false)
    }
    expect(isIpv4('10.0.0.1/24')).toBe(false)
    expect(isIpv4('1.2.3')).toBe(false)
  })
})

describe('candidateCidrs', () => {
  it('derives a /24 per interface address (show_node_info fixture: 192.168.97.3)', () => {
    expect(candidateCidrs(['192.168.97.3'])).toEqual(['192.168.97.0/24'])
  })

  it('skips ones already present, duplicates, loopback, link-local and the virtual network', () => {
    expect(
      candidateCidrs(['192.168.97.3', '192.168.97.9', '127.0.0.1', '169.254.3.4', '10.144.144.3', '172.16.5.5', '192.168.77.2'], {
        existing: ['192.168.77.0/24'],
        virtualCidr: '10.144.144.0/24',
      }),
    ).toEqual(['192.168.97.0/24', '172.16.5.0/24'])
  })

  it('ignores garbage input', () => {
    expect(candidateCidrs(['nope', ''])).toEqual([])
  })
})
