// lib/migration/calendarFeed.test.ts
//
// Unit tests for the SSRF classifiers that guard the feed-URL fetch. The
// network orchestration (DNS + redirect re-validation + size cap) is exercised
// against a real feed during the wired flow.

import { describe, expect, it } from 'vitest'

import { isPrivateIp, normalizeFeedUrl } from './calendarFeed'

describe('normalizeFeedUrl', () => {
  it('accepts https URLs', () => {
    expect(normalizeFeedUrl('https://calendar.example.com/feed.ics')?.protocol).toBe('https:')
  })

  it('upgrades webcal:// to https', () => {
    const url = normalizeFeedUrl('webcal://calendar.example.com/feed.ics')
    expect(url?.protocol).toBe('https:')
    expect(url?.hostname).toBe('calendar.example.com')
  })

  it('rejects non-https schemes and junk', () => {
    expect(normalizeFeedUrl('http://example.com/feed.ics')).toBeNull()
    expect(normalizeFeedUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeFeedUrl('ftp://example.com')).toBeNull()
    expect(normalizeFeedUrl('not a url')).toBeNull()
    expect(normalizeFeedUrl('')).toBeNull()
    expect(normalizeFeedUrl(null)).toBeNull()
  })
})

describe('isPrivateIp', () => {
  it('flags private / loopback / link-local IPv4', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.5.4',
      '172.31.255.255',
      '192.168.0.1',
      '100.64.0.1', // CGNAT
      '224.0.0.1', // multicast
      '255.255.255.255',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('flags private / loopback / link-local IPv6 (incl. IPv4-mapped)', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::abcd', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('treats blank input as private (fail closed)', () => {
    expect(isPrivateIp('')).toBe(true)
    expect(isPrivateIp('   ')).toBe(true)
  })
})
