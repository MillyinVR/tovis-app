import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import ElapsedTimer from './ElapsedTimer'

describe('ElapsedTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Fixed "now" so elapsed math is deterministic.
    vi.setSystemTime(new Date('2026-06-13T12:00:05.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks up once per second while a service is in progress', () => {
    // Started 5 seconds before the fixed system time.
    const startedAt = new Date('2026-06-13T12:00:00.000Z')

    render(<ElapsedTimer startedAt={startedAt} />)

    expect(screen.getByText('0:00:05')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('0:00:06')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('0:00:08')).toBeInTheDocument()
  })

  it('renders the zero placeholder and does not start an interval when startedAt is null', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    render(<ElapsedTimer startedAt={null} />)

    expect(screen.getByText('0:00:00')).toBeInTheDocument()
    expect(setIntervalSpy).not.toHaveBeenCalled()

    // Advancing time must not change the rendered value.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('0:00:00')).toBeInTheDocument()
  })

  it('clears the interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const startedAt = new Date('2026-06-13T12:00:00.000Z')

    const { unmount } = render(<ElapsedTimer startedAt={startedAt} />)
    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
