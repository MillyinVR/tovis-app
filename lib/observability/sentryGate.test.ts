import { describe, expect, it } from 'vitest'

import { isLoopbackHostname, shouldEnableSentry } from './sentryGate'

describe('isLoopbackHostname', () => {
  it.each(['localhost', 'LOCALHOST', ' localhost ', 'app.localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])(
    'treats %j as a developer machine',
    (host) => {
      expect(isLoopbackHostname(host)).toBe(true)
    },
  )

  it.each(['tovis.app', 'tovis-git-main.vercel.app', 'localhost.example.com', '10.0.0.5', ''])(
    'does not treat %j as loopback',
    (host) => {
      expect(isLoopbackHostname(host)).toBe(false)
    },
  )
})

describe('shouldEnableSentry', () => {
  const dsn = 'https://key@o1.ingest.sentry.io/1'

  it('reports on a deployed runtime with a DSN', () => {
    expect(shouldEnableSentry({ dsn, onDeployedRuntime: true, allowLocal: false })).toBe(true)
  })

  it('stays silent on a laptop even when the env file carries the live DSN', () => {
    expect(shouldEnableSentry({ dsn, onDeployedRuntime: false, allowLocal: false })).toBe(false)
  })

  it('lets an operator opt a local run in explicitly', () => {
    expect(shouldEnableSentry({ dsn, onDeployedRuntime: false, allowLocal: true })).toBe(true)
  })

  it('never reports without a DSN, deployed or not', () => {
    expect(shouldEnableSentry({ dsn: undefined, onDeployedRuntime: true, allowLocal: true })).toBe(false)
    expect(shouldEnableSentry({ dsn: '', onDeployedRuntime: true, allowLocal: true })).toBe(false)
  })
})
