// app/_components/ProSessionFooter/ProSessionFooter.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useUnreadBadge: vi.fn(),
  useProSession: vi.fn(),

  handleCenterClick: vi.fn(),
  setPickerOpen: vi.fn(),
  startSelectedBooking: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

vi.mock('@/app/_components/_hooks/useUnreadBadge', () => ({
  useUnreadBadge: mocks.useUnreadBadge,
}))

vi.mock('./useProSession', () => ({
  useProSession: mocks.useProSession,
}))

import ProSessionFooter from './ProSessionFooter'

function mockSession(overrides?: Partial<ReturnTypeShape>) {
  const base: ReturnTypeShape = {
    mode: 'IDLE',
    booking: null,
    eligibleBookings: [],
    center: {
      label: 'Start',
      action: 'NONE',
      href: null,
    },
    error: null,
    centerDisabled: true,
    displayLabel: 'Start',
    handleCenterClick: mocks.handleCenterClick,
    loading: false,
    actionLoading: null,
    pickerOpen: false,
    setPickerOpen: mocks.setPickerOpen,
    startSelectedBooking: mocks.startSelectedBooking,

    pathname: '/pro/calendar',
    targetStep: null,
    setError: vi.fn(),
    FORCE_EVENT: 'tovis:pro-session:force',
  }

  mocks.useProSession.mockReturnValue({
    ...base,
    ...overrides,
  })
}

type ReturnTypeShape = {
  pathname: string
  mode: 'IDLE' | 'UPCOMING' | 'UPCOMING_PICKER' | 'ACTIVE'
  booking: {
    id: string
    serviceName?: string
    clientName?: string
    scheduledFor?: string | null
    sessionStep?: string | null
  } | null
  eligibleBookings: Array<{
    id: string
    serviceName?: string
    clientName?: string
    scheduledFor?: string | null
    sessionStep?: string | null
  }>
  targetStep: 'consult' | 'session' | 'aftercare' | null
  center: {
    label: string
    action:
      | 'NONE'
      | 'START'
      | 'NAVIGATE'
      | 'FINISH'
      | 'CAPTURE_BEFORE'
      | 'CAPTURE_AFTER'
      | 'PICK_BOOKING'
    href: string | null
  }
  loading: boolean
  actionLoading: 'start' | 'nav' | null
  error: string | null
  setError: (value: string | null) => void
  centerDisabled: boolean
  displayLabel: string
  pickerOpen: boolean
  setPickerOpen: (value: boolean) => void
  handleCenterClick: () => void | Promise<void>
  startSelectedBooking: (bookingId: string) => void | Promise<void>
  FORCE_EVENT: string
}

describe('ProSessionFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePathname.mockReturnValue('/pro/calendar')
    mocks.useUnreadBadge.mockReturnValue(null)
    mockSession()
  })

  it('renders disabled center when there is no active or upcoming session', () => {
    render(<ProSessionFooter />)

    const center = screen.getByRole('button', { name: 'Start' })

    expect(center).toBeDisabled()
    expect(center).toHaveAttribute('title', 'No upcoming session')
    expect(screen.getByRole('link', { name: /calendar/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows an unread badge on messages when provided', () => {
    mocks.useUnreadBadge.mockReturnValue('3')

    render(<ProSessionFooter messagesBadge="3" />)

    expect(screen.getByRole('link', { name: /messages/i })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls center action when active center is clicked', () => {
    mockSession({
      mode: 'UPCOMING',
      booking: {
        id: 'booking_1',
        serviceName: 'Haircut',
        clientName: 'Tori Morales',
        scheduledFor: '2026-04-20T18:00:00.000Z',
        sessionStep: 'NONE',
      },
      center: {
        label: 'Start',
        action: 'START',
        href: '/pro/bookings/booking_1/session',
      },
      centerDisabled: false,
      displayLabel: 'Start',
    })

    render(<ProSessionFooter />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(mocks.handleCenterClick).toHaveBeenCalledTimes(1)
  })

  it('renders camera icon button with camera aria-label for capture actions', () => {
    mockSession({
      mode: 'ACTIVE',
      booking: {
        id: 'booking_1',
        serviceName: 'Color',
        clientName: 'Client One',
        scheduledFor: '2026-04-20T18:00:00.000Z',
        sessionStep: 'BEFORE_PHOTOS',
      },
      center: {
        label: 'Before photos',
        action: 'CAPTURE_BEFORE',
        href: '/pro/bookings/booking_1/session/before-photos',
      },
      centerDisabled: false,
      displayLabel: 'Before photos',
    })

    render(<ProSessionFooter />)

    expect(screen.getByRole('button', { name: 'Open camera' })).toBeEnabled()
  })

  it('opens booking picker and starts selected booking', () => {
    mockSession({
      mode: 'UPCOMING_PICKER',
      booking: null,
      eligibleBookings: [
        {
          id: 'booking_a',
          serviceName: 'Cut',
          clientName: 'Tori Morales',
          scheduledFor: '2026-04-20T18:00:00.000Z',
        },
        {
          id: 'booking_b',
          serviceName: 'Color',
          clientName: 'Client Two',
          scheduledFor: '2026-04-20T19:00:00.000Z',
        },
      ],
      center: {
        label: 'Choose booking',
        action: 'PICK_BOOKING',
        href: null,
      },
      centerDisabled: false,
      displayLabel: 'Choose booking',
      pickerOpen: true,
    })

    render(<ProSessionFooter />)

    expect(screen.getByText('Choose booking to start')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /cut/i }))

    expect(mocks.startSelectedBooking).toHaveBeenCalledWith('booking_a')
  })

  it('closes booking picker', () => {
    mockSession({
      mode: 'UPCOMING_PICKER',
      eligibleBookings: [
        {
          id: 'booking_a',
          serviceName: 'Cut',
          clientName: 'Tori Morales',
        },
        {
          id: 'booking_b',
          serviceName: 'Color',
          clientName: 'Client Two',
        },
      ],
      center: {
        label: 'Choose booking',
        action: 'PICK_BOOKING',
        href: null,
      },
      centerDisabled: false,
      displayLabel: 'Choose booking',
      pickerOpen: true,
    })

    render(<ProSessionFooter />)

    fireEvent.click(screen.getByRole('button', { name: 'Close booking picker' }))

    expect(mocks.setPickerOpen).toHaveBeenCalledWith(false)
  })

  it('renders error from session hook', () => {
    mockSession({
      error: 'Network error loading session.',
    })

    render(<ProSessionFooter />)

    expect(screen.getByText('Network error loading session.')).toBeInTheDocument()
  })

  it('clamps long center label visually but keeps full aria label', () => {
    mockSession({
      mode: 'ACTIVE',
      booking: {
        id: 'booking_1',
        serviceName: 'Color',
        clientName: 'Client One',
      },
      center: {
        label: 'Create aftercare',
        action: 'NAVIGATE',
        href: '/pro/bookings/booking_1/aftercare',
      },
      centerDisabled: false,
      displayLabel: 'Create aftercare',
    })

    render(<ProSessionFooter />)

    expect(
      screen.getByRole('button', { name: 'Create aftercare' }),
    ).toBeInTheDocument()

    expect(screen.getByText('Create a…')).toBeInTheDocument()
  })
})