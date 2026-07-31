// app/pro/services/PrepayScopePicker.test.tsx
//
// K10: the picker is the only place a pro turns on "pay in full up front", and
// the thing it must not get wrong is what it TELLS them. A pro who does not
// realise this overrides their account-wide deposit setting, or that a client
// who cancels late forfeits the whole service price, has been mis-sold a
// control that moves real money.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { OfferingPrepayScope } from '@prisma/client'

import PrepayScopePicker from '@/app/pro/services/PrepayScopePicker'

function renderPicker(
  overrides: Partial<Parameters<typeof PrepayScopePicker>[0]> = {},
) {
  const onChange = vi.fn()

  const result = render(
    <PrepayScopePicker
      name="prepay-test"
      value={null}
      onChange={onChange}
      {...overrides}
    />,
  )

  return { onChange, ...result }
}

describe('PrepayScopePicker', () => {
  it('offers exactly Off + the two scopes', () => {
    renderPicker()

    const radios = screen.getAllByRole('radio')

    expect(radios).toHaveLength(Object.values(OfferingPrepayScope).length + 1)
    expect(screen.getByRole('radio', { name: 'Off' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'This service only' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'Whole booking' })).toBeDefined()
  })

  it('defaults to Off, and Off means null — not a third enum value', () => {
    const { onChange } = renderPicker({
      value: OfferingPrepayScope.SERVICE_ONLY,
    })

    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'This service only' })
        .checked,
    ).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'Off' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it.each([
    ['This service only', OfferingPrepayScope.SERVICE_ONLY],
    ['Whole booking', OfferingPrepayScope.ENTIRE_BOOKING],
  ])('reports %s as the enum value the API stores', (label, expected) => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByRole('radio', { name: label }))

    expect(onChange).toHaveBeenCalledWith(expected)
  })

  // 🔴 The load-bearing assertions: the three consequences a pro must be told
  // about BEFORE they switch this on. Each is a real behaviour of the deposit
  // rail this reuses, not marketing copy.
  describe('what it tells the pro', () => {
    it.each(Object.values(OfferingPrepayScope))(
      'says it overrides the account-wide deposit setting (%s)',
      (value) => {
        const { container } = renderPicker({ value })

        expect(container.textContent).toContain(
          'overrides your account-wide deposit setting',
        )
      },
    )

    it.each(Object.values(OfferingPrepayScope))(
      'warns that a late cancel forfeits it (%s)',
      (value) => {
        const { container } = renderPicker({ value })

        expect(container.textContent).toContain('forfeits it')
      },
    )

    // 🔴 It has to name the gate the SERVER actually applies. Prepay overrides
    // `depositEnabled`, but never `proStripeReady` (charges + payouts on
    // Connect) — see resolveDepositRequirement. Promising a different
    // precondition would leave a pro wondering why nothing is being collected.
    it.each(Object.values(OfferingPrepayScope))(
      'names the Stripe gate it cannot override (%s)',
      (value) => {
        const { container } = renderPicker({ value })

        expect(container.textContent).toContain('Stripe payouts are set up')
      },
    )

    // The mixed-booking choice is the whole point of having two scopes; if the
    // two read the same, the pro has no way to tell them apart.
    it('describes the two scopes differently', () => {
      const serviceOnly = render(
        <PrepayScopePicker
          name="a"
          value={OfferingPrepayScope.SERVICE_ONLY}
          onChange={vi.fn()}
        />,
      ).container.textContent

      const wholeBooking = render(
        <PrepayScopePicker
          name="b"
          value={OfferingPrepayScope.ENTIRE_BOOKING}
          onChange={vi.fn()}
        />,
      ).container.textContent

      expect(serviceOnly).not.toBe(wholeBooking)
      expect(serviceOnly).toContain('settled afterwards')
      expect(wholeBooking).toContain('nothing left to collect on the day')
    })

    it('promises nothing about prepay while it is Off', () => {
      const { container } = renderPicker({ value: null })

      expect(container.textContent).not.toContain('paid in full')
      expect(container.textContent).toContain('pay after the appointment')
    })
  })

  // The K8 lesson, repeated: `disabled` on the fieldset alone bars descendants
  // as inherited STATE, but each input's own `disabled` property stays false —
  // so anything reading the control rather than the group is told it is
  // editable. It has to be set in both places.
  it('disables every input, not just the fieldset', () => {
    renderPicker({ disabled: true })

    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.disabled).toBe(true)
    }
  })
})
