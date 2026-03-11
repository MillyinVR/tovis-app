// app/(main)/booking/AvailabilityDrawer/hooks/useMobileAddresses.ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  ClientAddressRecord,
  MobileAddressOption,
} from '../types'

import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const value = raw.error
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseClientAddresses(raw: unknown): ClientAddressRecord[] {
  if (!isRecord(raw)) return []

  const rows = raw.addresses
  if (!Array.isArray(rows)) return []

  const out: ClientAddressRecord[] = []

  for (const row of rows) {
    if (!isRecord(row)) continue

    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const kind =
      typeof row.kind === 'string' ? row.kind.trim().toUpperCase() : ''
    const isDefault = Boolean(row.isDefault)

    if (!id) continue
    if (kind !== 'SEARCH_AREA' && kind !== 'SERVICE_ADDRESS') continue

    out.push({
      id,
      kind,
      label:
        typeof row.label === 'string' && row.label.trim()
          ? row.label.trim()
          : null,
      formattedAddress:
        typeof row.formattedAddress === 'string' && row.formattedAddress.trim()
          ? row.formattedAddress.trim()
          : null,
      addressLine1:
        typeof row.addressLine1 === 'string' && row.addressLine1.trim()
          ? row.addressLine1.trim()
          : null,
      addressLine2:
        typeof row.addressLine2 === 'string' && row.addressLine2.trim()
          ? row.addressLine2.trim()
          : null,
      city:
        typeof row.city === 'string' && row.city.trim()
          ? row.city.trim()
          : null,
      state:
        typeof row.state === 'string' && row.state.trim()
          ? row.state.trim()
          : null,
      postalCode:
        typeof row.postalCode === 'string' && row.postalCode.trim()
          ? row.postalCode.trim()
          : null,
      countryCode:
        typeof row.countryCode === 'string' && row.countryCode.trim()
          ? row.countryCode.trim()
          : null,
      placeId:
        typeof row.placeId === 'string' && row.placeId.trim()
          ? row.placeId.trim()
          : null,
      lat:
        typeof row.lat === 'number' && Number.isFinite(row.lat)
          ? row.lat
          : null,
      lng:
        typeof row.lng === 'number' && Number.isFinite(row.lng)
          ? row.lng
          : null,
      isDefault,
    })
  }

  return out
}

function toMobileAddressOptions(
  addresses: ClientAddressRecord[],
): MobileAddressOption[] {
  return addresses
    .filter((address) => address.kind === 'SERVICE_ADDRESS')
    .map((address) => ({
      id: address.id,
      label: address.label ?? 'Service address',
      formattedAddress:
        address.formattedAddress ??
        [
          address.addressLine1,
          address.addressLine2,
          address.city,
          address.state,
          address.postalCode,
        ]
          .filter(Boolean)
          .join(', '),
      isDefault: address.isDefault,
    }))
    .filter((address) => address.formattedAddress.trim().length > 0)
}

export function useMobileAddresses(args: {
  open: boolean
  mobileAddressGateRequested: boolean
  holding: boolean
}) {
  const { open, mobileAddressGateRequested, holding } = args

  const router = useRouter()

  const [mobileAddresses, setMobileAddresses] = useState<MobileAddressOption[]>(
    [],
  )
  const [loadingMobileAddresses, setLoadingMobileAddresses] = useState(false)
  const [mobileAddressesError, setMobileAddressesError] = useState<string | null>(
    null,
  )
  const [selectedClientAddressId, setSelectedClientAddressId] = useState<
    string | null
  >(null)
  const [addressCreateOpen, setAddressCreateOpen] = useState(false)

  const resetMobileAddressState = useCallback(() => {
    setMobileAddresses([])
    setLoadingMobileAddresses(false)
    setMobileAddressesError(null)
    setSelectedClientAddressId(null)
    setAddressCreateOpen(false)
  }, [])

  const loadMobileAddresses = useCallback(async () => {
    try {
      setLoadingMobileAddresses(true)
      setMobileAddressesError(null)

      const res = await fetch('/api/client/addresses', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'availability')
        return null
      }

      if (!res.ok) {
        throw new Error(
          pickErrorMessage(raw) ?? `Failed to load addresses (${res.status}).`,
        )
      }

      const parsed = parseClientAddresses(raw)
      const options = toMobileAddressOptions(parsed)

      setMobileAddresses(options)
      setSelectedClientAddressId((current) => {
        if (current && options.some((option) => option.id === current)) {
          return current
        }

        return (
          options.find((option) => option.isDefault)?.id ??
          options[0]?.id ??
          null
        )
      })

      return options
    } catch (error: unknown) {
      setMobileAddresses([])
      setSelectedClientAddressId(null)
      setMobileAddressesError(
        error instanceof Error
          ? error.message
          : 'Failed to load mobile addresses.',
      )
      return null
    } finally {
      setLoadingMobileAddresses(false)
    }
  }, [router])

  const handleAddressSaved = useCallback(
    async (address: MobileAddressOption | null) => {
      const options = await loadMobileAddresses()

      if (address?.id) {
        setSelectedClientAddressId(address.id)
      } else if (options?.length) {
        setSelectedClientAddressId(
          options.find((option) => option.isDefault)?.id ??
            options[0]?.id ??
            null,
        )
      }

      setMobileAddressesError(null)
      setAddressCreateOpen(false)
    },
    [loadMobileAddresses],
  )

  useEffect(() => {
    if (!open) return

    if (!mobileAddressGateRequested) {
      setAddressCreateOpen(false)
      return
    }

    void loadMobileAddresses()
  }, [open, mobileAddressGateRequested, loadMobileAddresses])

  useEffect(() => {
    if (!open) return
    if (!mobileAddressGateRequested) return
    if (holding) return

    setMobileAddressesError(null)
  }, [open, mobileAddressGateRequested, holding])

  return {
    mobileAddresses,
    loadingMobileAddresses,
    mobileAddressesError,
    selectedClientAddressId,
    setSelectedClientAddressId,
    addressCreateOpen,
    setAddressCreateOpen,
    loadMobileAddresses,
    handleAddressSaved,
    resetMobileAddressState,
  }
}