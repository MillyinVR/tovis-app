import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsultProFollowUpDTO } from '@/lib/dto/consult'

import ProConsultAskFollowUp from './ProConsultAskFollowUp'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function question(over: Partial<ConsultProFollowUpDTO> = {}): ConsultProFollowUpDTO {
  return {
    id: 'q1',
    questionKey: 'pro_1',
    priority: 'HELPFUL_FOR_PREP',
    text: 'Have you had keratin in the last year?',
    options: [
      { value: 'option-1', label: 'Yes' },
      { value: 'option-2', label: 'No' },
    ],
    selectedValue: null,
    selectedLabel: null,
    planVersion: 1,
    askedAt: '2026-09-11T06:00:00.000Z',
    answeredAt: null,
    ...over,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  // A real Response, not a shaped object: the component reads `ok` and calls
  // `json()`, and the house rule forbids a type escape to fake either.
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  fetchMock.mockReset()
})

describe('ProConsultAskFollowUp', () => {
  it('starts empty, disabled, and posts exactly what the pro typed once it is valid', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, questions: [question({ text: 'Any allergies to hair dye?' })] }),
    )
    render(<ProConsultAskFollowUp consultId="consult 1" initialQuestions={[]} />)

    expect(screen.getByText('You haven’t asked anything yet.')).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Send question' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText('Your question'), '  Any allergies to hair dye?  ')
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Option 1'), 'Yes')
    await user.type(screen.getByLabelText('Option 2'), ' No ')
    expect((submit as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Needed before the appointment' }))
    await user.click(submit)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/pro/consults/consult%201/follow-up')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      priority: 'NEED_BEFORE_APPOINTMENT',
      text: 'Any allergies to hair dye?',
      options: ['Yes', 'No'],
    })

    // The server's list replaces the local one, and the form resets.
    expect(await screen.findByText('Any allergies to hair dye?')).toBeTruthy()
    expect(screen.getByText(/Waiting for her answer/)).toBeTruthy()
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('')
  })

  it('refuses duplicate answers locally and shows the server\'s refusal when it comes', async () => {
    const user = userEvent.setup()
    render(<ProConsultAskFollowUp consultId="c1" initialQuestions={[]} />)
    await user.type(screen.getByLabelText('Your question'), 'Q?')
    await user.type(screen.getByLabelText('Option 1'), 'Yes')
    await user.type(screen.getByLabelText('Option 2'), 'yes')
    const submit = screen.getByRole('button', { name: 'Send question' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    await user.clear(screen.getByLabelText('Option 2'))
    await user.type(screen.getByLabelText('Option 2'), 'No')
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { ok: false, error: 'Wait for an answer before asking another question.' }),
    )
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wait for an answer before asking another question.',
    )
  })

  it('shows the answer once it exists, and stops at three open questions', () => {
    render(
      <ProConsultAskFollowUp
        consultId="c1"
        initialQuestions={[
          question({ id: 'a', questionKey: 'pro_1', selectedValue: 'option-2', selectedLabel: 'No', answeredAt: '2026-09-11T07:00:00.000Z' }),
          question({ id: 'b', questionKey: 'pro_2' }),
          question({ id: 'c', questionKey: 'pro_3' }),
          question({ id: 'd', questionKey: 'pro_4' }),
        ]}
      />,
    )
    expect(screen.getByText('Answered: No')).toBeTruthy()
    expect(screen.getAllByText(/Waiting for her answer/)).toHaveLength(3)
    expect(screen.getByText(/Up to 3 questions can be open at once/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
