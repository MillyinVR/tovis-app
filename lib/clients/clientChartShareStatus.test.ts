// lib/clients/clientChartShareStatus.test.ts
import { ClientChartShareStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  CLIENT_CHART_SHARE_STATUS_COPY,
  clientChartShareGrantsAccess,
  clientChartShareIsOpenAsk,
  isClientChartShareStatus,
} from './clientChartShareStatus'

describe('clientChartShareGrantsAccess', () => {
  it('opens the chart for GRANTED and nothing else', () => {
    expect(clientChartShareGrantsAccess(ClientChartShareStatus.GRANTED)).toBe(true)

    // 🔴 REQUESTED is the pro having ASKED. It grants nothing, and reading it as
    // access would open a medical record on the strength of the request for it.
    expect(clientChartShareGrantsAccess(ClientChartShareStatus.REQUESTED)).toBe(false)
    expect(clientChartShareGrantsAccess(ClientChartShareStatus.DECLINED)).toBe(false)
    expect(clientChartShareGrantsAccess(ClientChartShareStatus.REVOKED)).toBe(false)
  })

  it('fails CLOSED on anything unrecognised', () => {
    for (const value of [null, undefined, '', 'granted', 'GRANTED_', 0, 1, {}, []]) {
      expect(clientChartShareGrantsAccess(value)).toBe(false)
    }
  })
})

describe('clientChartShareIsOpenAsk', () => {
  it('is true for REQUESTED only', () => {
    expect(clientChartShareIsOpenAsk(ClientChartShareStatus.REQUESTED)).toBe(true)

    // Granted is a fact; declined and revoked are answers the client already
    // gave. Highlighting any of them would nag a client about their own choice.
    expect(clientChartShareIsOpenAsk(ClientChartShareStatus.GRANTED)).toBe(false)
    expect(clientChartShareIsOpenAsk(ClientChartShareStatus.DECLINED)).toBe(false)
    expect(clientChartShareIsOpenAsk(ClientChartShareStatus.REVOKED)).toBe(false)
  })

  it('is never the same question as access', () => {
    // An open ask grants nothing, and access is not an ask — no status is both.
    for (const status of Object.values(ClientChartShareStatus)) {
      expect(
        clientChartShareIsOpenAsk(status) && clientChartShareGrantsAccess(status),
      ).toBe(false)
    }
  })

  it('is false for anything unrecognised', () => {
    for (const value of [null, undefined, '', 'requested', 0, {}]) {
      expect(clientChartShareIsOpenAsk(value)).toBe(false)
    }
  })
})

describe('CLIENT_CHART_SHARE_STATUS_COPY', () => {
  it('covers every status the schema can produce', () => {
    // Derived from the enum, not a hand-written list — a fifth status added to
    // the schema fails here rather than rendering `undefined` at a client.
    for (const status of Object.values(ClientChartShareStatus)) {
      const copy = CLIENT_CHART_SHARE_STATUS_COPY[status]
      expect(typeof copy).toBe('string')
      expect(copy.trim().length).toBeGreaterThan(0)
    }
  })

  it('gives each status its own distinct sentence', () => {
    // DECLINED and REVOKED are both "closed" but are deliberately distinct
    // states; telling a client the same thing about both would erase whether
    // they ever said yes.
    const all = Object.values(ClientChartShareStatus).map(
      (status) => CLIENT_CHART_SHARE_STATUS_COPY[status],
    )
    expect(new Set(all).size).toBe(all.length)
  })

  it('is frozen, so a caller cannot reword a consent statement in place', () => {
    expect(Object.isFrozen(CLIENT_CHART_SHARE_STATUS_COPY)).toBe(true)
  })
})

describe('isClientChartShareStatus', () => {
  it('accepts every real status', () => {
    for (const status of Object.values(ClientChartShareStatus)) {
      expect(isClientChartShareStatus(status)).toBe(true)
    }
  })

  it('rejects non-statuses, including inherited Object keys', () => {
    for (const value of [null, undefined, 42, {}, 'REQUEST', 'granted', 'toString']) {
      expect(isClientChartShareStatus(value)).toBe(false)
    }
  })
})
