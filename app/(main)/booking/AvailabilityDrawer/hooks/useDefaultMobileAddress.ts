// app/(main)/booking/AvailabilityDrawer/hook/useDefaultMobileAddress.ts 
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ClientAddressRecord } from '../types'

import { safeJson } from '@/lib/http'

type DefaultMobileAddressState = {
  defaultAddressId: string | null
  defaultAddress: ClientAddressRecord | null
  addresses: ClientAddressRecord[]
  loading: boolean
  error: string | null
}

type CachedDefaultMobileAddress = {
  at: number
  state: Omit<DefaultMobileAddressState, 'loading' | 'error'> & {
    error: string | null
  }
}

const CACHE_TTL_MS = 60_000

let cachedDefaultMobileAddress: CachedDefaultMobileAddress | null = null
let inFlightDefaultMobileAddressPromise:
  | Promise<{
      addresses: ClientAddressRecord[]
      defaultAddress: ClientAddressRecord | null
      defaultAddressId: string | null
    }>
  | null = null

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickBoolean(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null
}

function parseClientAddressRecord(raw: unknown): ClientAddressRecord | null {
  if (!isRecord(raw)) return null

  const id = pickString(raw.id)
  const kind = pickString(raw.kind)
  const isDefault = pickBoolean(raw.isDefault)

  if (!id || !isDefault) {
    return null
  }

  if (kind !== 'SEARCH_AREA' && kind !== 'SERVICE_ADDRESS') {
    return null
  }

  return {
    id,
    kind,
    label: raw.label == null ? null : pickString(raw.label),
    formattedAddress:
      raw.formattedAddress == null ? null : pickString(raw.formattedAddress),
    addressLine1:
      raw.addressLine1 == null ? null : pickString(raw.addressLine1),
    addressLine2:
      raw.addressLine2 == null ? null : pickString(raw.addressLine2),
    city: raw.city == null ? null : pickString(raw.city),
    state: raw.state == null ? null : pickString(raw.state),
    postalCode: raw.postalCode == null ? null : pickString(raw.postalCode),
    countryCode:
      raw.countryCode == null ? null : pickString(raw.countryCode),
    placeId: raw.placeId == null ? null : pickString(raw.placeId),
    lat: typeof raw.lat === 'number' && Number.isFinite(raw.lat) ? raw.lat : null,
    lng: typeof raw.lng === 'number' && Number.isFinite(raw.lng) ? raw.lng : null,
    isDefault,
  }
}

function parseClientAddressesResponse(raw: unknown): ClientAddressRecord[] {
  if (!isRecord(raw)) return []

  const addressesRaw = raw.addresses
  if (!Array.isArray(addressesRaw)) return []

  const parsed: ClientAddressRecord[] = []

  for (const row of addressesRaw) {
    const address = parseClientAddressRecord(row)
    if (address) {
      parsed.push(address)
    }
  }

  return parsed
}

function pickDefaultMobileAddress(
  addresses: ClientAddressRecord[],
): ClientAddressRecord | null {
  const serviceAddresses = addresses.filter(
    (address) => address.kind === 'SERVICE_ADDRESS',
  )

  if (serviceAddresses.length === 0) return null

  const explicitDefault =
    serviceAddresses.find((address) => address.isDefault) ?? null

  if (explicitDefault) return explicitDefault

  return serviceAddresses[0] ?? null
}

function getFreshCachedState(): DefaultMobileAddressState | null {
  if (!cachedDefaultMobileAddress) return null
  if (Date.now() - cachedDefaultMobileAddress.at >= CACHE_TTL_MS) return null

  return {
    defaultAddressId: cachedDefaultMobileAddress.state.defaultAddressId,
    defaultAddress: cachedDefaultMobileAddress.state.defaultAddress,
    addresses: cachedDefaultMobileAddress.state.addresses,
    loading: false,
    error: cachedDefaultMobileAddress.state.error,
  }
}

async function fetchDefaultMobileAddress(options?: {
  signal?: AbortSignal
}): Promise<{
  addresses: ClientAddressRecord[]
  defaultAddress: ClientAddressRecord | null
  defaultAddressId: string | null
}> {
  const cached = getFreshCachedState()
  if (cached) {
    return {
      addresses: cached.addresses,
      defaultAddress: cached.defaultAddress,
      defaultAddressId: cached.defaultAddressId,
    }
  }

  if (!inFlightDefaultMobileAddressPromise) {
    inFlightDefaultMobileAddressPromise = (async () => {
      const res = await fetch('/api/client/addresses', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        return {
          addresses: [],
          defaultAddress: null,
          defaultAddressId: null,
        }
      }

      if (!res.ok) {
        const message =
          isRecord(raw) && pickString(raw.error)
            ? pickString(raw.error)
            : 'Failed to load client addresses.'

        throw new Error(message ?? 'Failed to load client addresses.')
      }

      const addresses = parseClientAddressesResponse(raw)
      const defaultAddress = pickDefaultMobileAddress(addresses)
      const defaultAddressId = defaultAddress?.id ?? null

      cachedDefaultMobileAddress = {
        at: Date.now(),
        state: {
          addresses,
          defaultAddress,
          defaultAddressId,
          error: null,
        },
      }

      return {
        addresses,
        defaultAddress,
        defaultAddressId,
      }
    })()
  }

  try {
    return await inFlightDefaultMobileAddressPromise
  } finally {
    inFlightDefaultMobileAddressPromise = null
  }
}

export function clearDefaultMobileAddressCache(): void {
  cachedDefaultMobileAddress = null
  inFlightDefaultMobileAddressPromise = null
}

export function useDefaultMobileAddress(enabled = true) {
  const mountedRef = useRef(true)
  const [state, setState] = useState<DefaultMobileAddressState>(() => {
    const cached = getFreshCachedState()

    return (
      cached ?? {
        defaultAddressId: null,
        defaultAddress: null,
        addresses: [],
        loading: Boolean(enabled),
        error: null,
      }
    )
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    clearDefaultMobileAddressCache()

    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))

    try {
      const result = await fetchDefaultMobileAddress()

      if (!mountedRef.current) return

      setState({
        defaultAddressId: result.defaultAddressId,
        defaultAddress: result.defaultAddress,
        addresses: result.addresses,
        loading: false,
        error: null,
      })
    } catch (e: unknown) {
      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        loading: false,
        error:
          e instanceof Error
            ? e.message
            : 'Failed to load default mobile address.',
      }))
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({
        ...prev,
        loading: false,
      }))
      return
    }

    const cached = getFreshCachedState()
    if (cached) {
      setState(cached)
      return
    }

    const ac = new AbortController()

    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))

    void fetchDefaultMobileAddress({ signal: ac.signal })
      .then((result) => {
        if (!mountedRef.current || ac.signal.aborted) return

        setState({
          defaultAddressId: result.defaultAddressId,
          defaultAddress: result.defaultAddress,
          addresses: result.addresses,
          loading: false,
          error: null,
        })
      })
      .catch((e: unknown) => {
        if (!mountedRef.current || ac.signal.aborted) return

        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            e instanceof Error
              ? e.message
              : 'Failed to load default mobile address.',
        }))
      })

    return () => {
      ac.abort()
    }
  }, [enabled])

  return {
    defaultAddressId: state.defaultAddressId,
    defaultAddress: state.defaultAddress,
    addresses: state.addresses,
    loading: state.loading,
    error: state.error,
    refresh,
  }
}