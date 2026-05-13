// app/pro/ProReadinessBanner.tsx
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

type LiveBookingMode = 'SALON' | 'MOBILE'

type ProReadinessBlocker =
  | 'NO_ACTIVE_OFFERING'
  | 'NO_BOOKABLE_LOCATION'
  | 'SALON_MISSING_ADDRESS'
  | 'MOBILE_MISSING_BASE_CONFIG'
  | 'LOCATION_MISSING_TIMEZONE'
  | 'LOCATION_MISSING_WORKING_HOURS'
  | 'OFFERING_MISSING_SALON_PRICE_OR_DURATION'
  | 'OFFERING_MISSING_MOBILE_PRICE_OR_DURATION'
  | 'VERIFICATION_NOT_APPROVED'

type ProReadiness =
  | {
      ok: true
      liveModes: LiveBookingMode[]
      readyLocationIds: string[]
    }
  | {
      ok: false
      blockers: ProReadinessBlocker[]
    }

type ReadinessResponse = {
  ok: true
  readiness: ProReadiness
}

type BlockerViewModel = {
  label: string
  href: string
}

const BLOCKER_LABELS: Record<ProReadinessBlocker, BlockerViewModel> = {
  NO_ACTIVE_OFFERING: {
    label: 'Add at least one active service offering.',
    href: '/pro/services',
  },
  NO_BOOKABLE_LOCATION: {
    label: 'Add or publish at least one bookable location.',
    href: '/pro/locations',
  },
  SALON_MISSING_ADDRESS: {
    label: 'Add a valid address to your salon or suite location.',
    href: '/pro/locations',
  },
  MOBILE_MISSING_BASE_CONFIG: {
    label: 'Add your mobile base postal code and service radius.',
    href: '/pro/locations',
  },
  LOCATION_MISSING_TIMEZONE: {
    label: 'Add a valid timezone to every bookable location.',
    href: '/pro/locations',
  },
  LOCATION_MISSING_WORKING_HOURS: {
    label: 'Add working hours for every bookable location.',
    href: '/pro/calendar',
  },
  OFFERING_MISSING_SALON_PRICE_OR_DURATION: {
    label: 'Add salon pricing and duration to salon services.',
    href: '/pro/services',
  },
  OFFERING_MISSING_MOBILE_PRICE_OR_DURATION: {
    label: 'Add mobile pricing and duration to mobile services.',
    href: '/pro/services',
  },
  VERIFICATION_NOT_APPROVED: {
    label: 'Finish professional verification.',
    href: '/pro/verification',
  },
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  if (record.ok !== true) return false

  const readiness = record.readiness
  if (!readiness || typeof readiness !== 'object') return false

  const readinessRecord = readiness as Record<string, unknown>
  if (readinessRecord.ok === true) {
    return (
      Array.isArray(readinessRecord.liveModes) &&
      Array.isArray(readinessRecord.readyLocationIds)
    )
  }

  if (readinessRecord.ok === false) {
    return Array.isArray(readinessRecord.blockers)
  }

  return false
}

function blockerViewModels(blockers: readonly ProReadinessBlocker[]) {
  return blockers
    .map((blocker) => BLOCKER_LABELS[blocker])
    .filter((item): item is BlockerViewModel => Boolean(item))
}

export default function ProReadinessBanner() {
  const ref = useRef<HTMLDivElement | null>(null)

  const [readiness, setReadiness] = useState<ProReadiness | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadReadiness(): Promise<void> {
      try {
        const response = await fetch('/api/pro/readiness', {
          cache: 'no-store',
        })

        const data: unknown = await response.json().catch(() => null)

        if (cancelled) return
        if (!response.ok) return
        if (!isReadinessResponse(data)) return

        setReadiness(data.readiness)
      } catch {
        // This banner should never break the pro shell.
      }
    }

    void loadReadiness()

    return () => {
      cancelled = true
    }
  }, [])

  const blockers = useMemo(() => {
    if (!readiness || readiness.ok) return []
    return blockerViewModels(readiness.blockers)
  }, [readiness])

  useEffect(() => {
    const el = ref.current

    if (!el) return

    const update = () => {
      document.documentElement.style.setProperty(
        '--pro-readiness-banner-h',
        `${Math.max(0, Math.round(el.getBoundingClientRect().height))}px`,
      )
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)

    return () => {
      resizeObserver.disconnect()
      document.documentElement.style.setProperty('--pro-readiness-banner-h', '0px')
    }
  }, [blockers.length])

  if (!readiness || readiness.ok || blockers.length === 0) return null

  return (
    <div
      ref={ref}
      className="border-b border-toneWarn/35 bg-bgSecondary/98 px-4 py-3 text-sm shadow-sm"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-black text-textPrimary">
            You are not bookable yet.
          </p>
          <p className="mt-1 text-textSecondary">
            Finish these setup items so clients can book you without the app
            quietly throwing a tiny tantrum.
          </p>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {blockers.map((blocker) => (
              <li key={`${blocker.href}:${blocker.label}`}>
                <Link
                  href={blocker.href}
                  className="inline-flex rounded-xl border border-white/10 bg-bgPrimary px-3 py-2 font-bold text-textPrimary transition hover:border-toneWarn/50"
                >
                  {blocker.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <Link
          href="/pro/locations"
          className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-textPrimary px-4 py-2 font-black text-bgPrimary transition hover:opacity-90"
        >
          Fix setup
        </Link>
      </div>
    </div>
  )
}