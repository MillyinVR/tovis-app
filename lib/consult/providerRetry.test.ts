import { describe, expect, it, vi } from 'vitest'

import {
  isRetryableConsultProviderError,
  withOneConsultRetry,
} from './providerRetry'

const err = (kind: string) => Object.assign(new Error('x'), { kind })

describe('isRetryableConsultProviderError', () => {
  it('retries bad_output and nothing else', () => {
    expect(isRetryableConsultProviderError(err('bad_output'))).toBe(true)
    // The three deliberate exclusions — see the file header for each reason.
    expect(isRetryableConsultProviderError(err('unavailable'))).toBe(false)
    expect(isRetryableConsultProviderError(err('refused'))).toBe(false)
    expect(isRetryableConsultProviderError(err('no_vocabulary'))).toBe(false)
  })

  it('does not retry something that is not a consult provider error', () => {
    for (const value of [null, undefined, 'bad_output', new Error('plain'), {}]) {
      expect(isRetryableConsultProviderError(value)).toBe(false)
    }
  })
})

describe('withOneConsultRetry', () => {
  it('does not call twice when the first attempt succeeds', async () => {
    const attempt = vi.fn().mockResolvedValue('ok')
    await expect(withOneConsultRetry({ attempt })).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledOnce()
    expect(attempt).toHaveBeenCalledWith(1)
  })

  it('retries once on bad_output and returns the second answer', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(err('bad_output'))
      .mockResolvedValueOnce('recovered')
    const onRetry = vi.fn()
    await expect(withOneConsultRetry({ attempt, onRetry })).resolves.toBe(
      'recovered',
    )
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(attempt).toHaveBeenLastCalledWith(2)
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('stops at two attempts and surfaces the LAST failure', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(err('bad_output'))
      .mockRejectedValueOnce(Object.assign(new Error('second'), { kind: 'bad_output' }))
    await expect(withOneConsultRetry({ attempt })).rejects.toThrow('second')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not retry a kind that is not retryable', async () => {
    for (const kind of ['unavailable', 'refused', 'no_vocabulary']) {
      const attempt = vi.fn().mockRejectedValue(err(kind))
      await expect(withOneConsultRetry({ attempt })).rejects.toMatchObject({ kind })
      expect(attempt).toHaveBeenCalledOnce()
    }
  })

  it('surfaces the first failure rather than starting a retry past the deadline', async () => {
    const attempt = vi.fn().mockRejectedValue(err('bad_output'))
    const onRetry = vi.fn()
    await expect(
      withOneConsultRetry({ attempt, canStartRetry: () => false, onRetry }),
    ).rejects.toMatchObject({ kind: 'bad_output' })
    expect(attempt).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
  })
})
