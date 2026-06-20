// lib/booking/overridePrompts.test.ts
import { describe, expect, it } from 'vitest'

import {
  BookingOverrideRequiredError,
  bookingOverridePromptFor,
  mergeBookingOverrideFlags,
  readBookingOverridePrompt,
} from './overridePrompts'

describe('readBookingOverridePrompt', () => {
  it('maps ADVANCE_NOTICE_REQUIRED to allowShortNotice', () => {
    const prompt = readBookingOverridePrompt({
      ok: false,
      error: 'That booking is too soon unless you explicitly override advance notice.',
      code: 'ADVANCE_NOTICE_REQUIRED',
    })

    expect(prompt?.code).toBe('ADVANCE_NOTICE_REQUIRED')
    expect(prompt?.flag).toBe('allowShortNotice')
  })

  it('maps MAX_DAYS_AHEAD_EXCEEDED to allowFarFuture', () => {
    const prompt = readBookingOverridePrompt({
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
    })

    expect(prompt?.flag).toBe('allowFarFuture')
  })

  it('maps OUTSIDE_WORKING_HOURS to allowOutsideWorkingHours', () => {
    const prompt = readBookingOverridePrompt({
      code: 'OUTSIDE_WORKING_HOURS',
    })

    expect(prompt?.flag).toBe('allowOutsideWorkingHours')
  })

  it('returns null for non-override-gated codes', () => {
    expect(readBookingOverridePrompt({ code: 'TIME_BOOKED' })).toBeNull()
    expect(readBookingOverridePrompt({ code: 'FORBIDDEN' })).toBeNull()
  })

  it('returns null for malformed payloads', () => {
    expect(readBookingOverridePrompt(null)).toBeNull()
    expect(readBookingOverridePrompt('ADVANCE_NOTICE_REQUIRED')).toBeNull()
    expect(readBookingOverridePrompt({})).toBeNull()
    expect(readBookingOverridePrompt({ code: 42 })).toBeNull()
  })

  it('does not treat inherited object keys as codes', () => {
    expect(readBookingOverridePrompt({ code: 'toString' })).toBeNull()
    expect(readBookingOverridePrompt({ code: 'constructor' })).toBeNull()
  })

  it('returns edit-intent copy when asked', () => {
    const prompt = readBookingOverridePrompt(
      { code: 'ADVANCE_NOTICE_REQUIRED' },
      'edit',
    )

    expect(prompt?.flag).toBe('allowShortNotice')
    expect(prompt?.question).toContain('Save it anyway?')
  })

  it('returns create-intent copy for a new pro booking', () => {
    const prompt = readBookingOverridePrompt(
      { code: 'OUTSIDE_WORKING_HOURS' },
      'create',
    )

    expect(prompt?.flag).toBe('allowOutsideWorkingHours')
    expect(prompt?.question).toContain('Book it anyway?')
  })
})

describe('bookingOverridePromptFor', () => {
  it('keeps the same code and flag across intents', () => {
    const accept = bookingOverridePromptFor('MAX_DAYS_AHEAD_EXCEEDED', 'accept')
    const edit = bookingOverridePromptFor('MAX_DAYS_AHEAD_EXCEEDED', 'edit')
    const create = bookingOverridePromptFor('MAX_DAYS_AHEAD_EXCEEDED', 'create')

    expect(accept.code).toBe(edit.code)
    expect(accept.flag).toBe(edit.flag)
    expect(create.flag).toBe(accept.flag)
    expect(accept.question).not.toBe(edit.question)
    expect(create.question).not.toBe(accept.question)
  })
})

describe('mergeBookingOverrideFlags', () => {
  it('appends a new flag', () => {
    expect(mergeBookingOverrideFlags(['allowShortNotice'], 'allowFarFuture')).toEqual([
      'allowShortNotice',
      'allowFarFuture',
    ])
  })

  it('does not duplicate an existing flag', () => {
    expect(
      mergeBookingOverrideFlags(['allowShortNotice'], 'allowShortNotice'),
    ).toEqual(['allowShortNotice'])
  })
})

describe('BookingOverrideRequiredError', () => {
  it('carries the prompt and message', () => {
    const prompt = readBookingOverridePrompt({ code: 'ADVANCE_NOTICE_REQUIRED' })
    if (!prompt) throw new Error('expected prompt')

    const error = new BookingOverrideRequiredError('too soon', prompt)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BookingOverrideRequiredError')
    expect(error.message).toBe('too soon')
    expect(error.prompt.flag).toBe('allowShortNotice')
  })
})
