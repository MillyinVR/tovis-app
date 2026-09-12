import { describe, expect, it } from 'vitest'

import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

import { visibleConsultThreadMessages } from './visibleThread'

const text = (
  id: string,
  state: ConsultThreadMessageDTO['state'] = 'DONE',
): ConsultThreadMessageDTO => ({ kind: 'TEXT', id, author: 'APP', state, text: id })

describe('visibleConsultThreadMessages', () => {
  it('shows history up to and including the open step, and nothing after it', () => {
    const messages = [text('a'), text('b', 'OPEN'), text('c', 'OPEN'), text('d', 'BLOCKED')]
    expect(
      visibleConsultThreadMessages({ messages, nextOpenMessageId: 'b' }).map((m) => m.id),
    ).toEqual(['a', 'b'])
  })

  it('shows the whole thread when nothing is open', () => {
    const messages = [text('a'), text('b'), text('c', 'BLOCKED')]
    expect(
      visibleConsultThreadMessages({ messages, nextOpenMessageId: null }).map((m) => m.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('shows the whole thread when the open id is not in the list', () => {
    const messages = [text('a'), text('b')]
    expect(
      visibleConsultThreadMessages({ messages, nextOpenMessageId: 'zzz' }).map((m) => m.id),
    ).toEqual(['a', 'b'])
  })

  it('keeps a blocked message that sits BEFORE the open one', () => {
    const messages = [text('a'), text('skipped', 'BLOCKED'), text('b', 'OPEN'), text('c')]
    expect(
      visibleConsultThreadMessages({ messages, nextOpenMessageId: 'b' }).map((m) => m.id),
    ).toEqual(['a', 'skipped', 'b'])
  })
})
