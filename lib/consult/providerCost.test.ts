import { describe, expect, it } from 'vitest'

import {
  consultProviderCostMicroUsd,
  formatConsultProviderCost,
  readConsultProviderUsage,
} from './providerCost'
import { buildConsultProviderCallRecord } from './providerMeter'

describe('consult provider cost', () => {
  it('prices claude-sonnet-5 at its published rate, exactly', () => {
    // $2.00 / MTok input, $10.00 / MTok output. A million input tokens is
    // 2,000,000 µUSD; a million output tokens is 10,000,000. Asserting the
    // round numbers is what would catch a units slip (µ vs n, per-token vs
    // per-million) that a ratio test would happily accept.
    expect(
      consultProviderCostMicroUsd('claude-sonnet-5', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toBe(2_000_000)
    expect(
      consultProviderCostMicroUsd('claude-sonnet-5', {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toBe(10_000_000)
  })

  it('prices a realistic consult call in whole millionths', () => {
    // A measured-shape analysis call: seven images in, a page of JSON out.
    expect(
      consultProviderCostMicroUsd('claude-sonnet-5', {
        inputTokens: 12_500,
        outputTokens: 3_200,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toBe(12_500 * 2 + 3_200 * 10)
  })

  it('charges cache writes at 1.25x and cache reads at 0.1x', () => {
    expect(
      consultProviderCostMicroUsd('claude-sonnet-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBe(2_500_000 + 200_000)
  })

  it('returns null — never zero — for a model with no committed price', () => {
    // 🔴 The distinction this whole nullable column exists for. A model the
    // repo has no rate for must read as "unpriced", not as "free": a $0 row
    // would silently understate the bill and look like a working meter.
    expect(
      consultProviderCostMicroUsd('some-unpriced-model', {
        inputTokens: 50_000,
        outputTokens: 5_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toBeNull()
    expect(formatConsultProviderCost(null)).toBe('unpriced')
    expect(formatConsultProviderCost(0)).toBe('$0.0000')
  })

  it('reads the provider usage block without trusting its shape', () => {
    // The SDK's cache fields are nullable and new fields arrive over time. A
    // meter that threw on an unfamiliar usage block would fail a call that had
    // already succeeded and already been billed.
    expect(
      readConsultProviderUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: null,
        server_tool_use: { web_search_requests: 3 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })
    expect(readConsultProviderUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })
    expect(readConsultProviderUsage({ input_tokens: -5 })).toMatchObject({
      inputTokens: 0,
    })
  })

  it('builds a meter row from a failed call that still cost money', () => {
    // A refusal is billed. The row records the tokens and the price, and says
    // REFUSED — the money is not conditional on us liking the answer.
    const record = buildConsultProviderCallRecord({
      kind: 'ANALYSIS_DIRECTION',
      outcome: 'REFUSED',
      model: 'claude-sonnet-5',
      latencyMs: 1_234.6,
      usage: { input_tokens: 900, output_tokens: 10 },
    })
    expect(record).toMatchObject({
      outcome: 'REFUSED',
      inputTokens: 900,
      outputTokens: 10,
      latencyMs: 1_235,
      costMicroUsd: 900 * 2 + 10 * 10,
    })
  })

  it('records a call that never reached the model as zero tokens, not zero cost-unknown', () => {
    const record = buildConsultProviderCallRecord({
      kind: 'CAPTURE_GATE',
      outcome: 'UNAVAILABLE',
      model: 'claude-sonnet-5',
      latencyMs: Number.NaN,
      usage: undefined,
    })
    expect(record).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costMicroUsd: 0,
    })
  })
})
