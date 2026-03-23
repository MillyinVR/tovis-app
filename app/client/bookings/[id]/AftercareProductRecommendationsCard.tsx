// app/client/bookings/[id]/AftercareProductRecommendationsCard.tsx

'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type CheckoutStatus =
  | 'NOT_READY'
  | 'READY'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'WAIVED'
  | string
  | null
  | undefined

type RecommendedProduct = {
  id: string
  productId?: string | null
  note?: string | null
  externalName?: string | null
  externalUrl?: string | null
  product?: {
    id: string
    name: string
    brand?: string | null
    retailPrice?: unknown
  } | null
}

type PurchasedProduct = {
  id: string
  productId?: string | null
  name?: string | null
  quantity: number
  unitPrice?: unknown
  lineTotal?: unknown
}

type SelectedCheckoutProduct = {
  recommendationId: string
  productId: string
  quantity: number
}

type Props = {
  bookingId: string
  checkoutStatus: CheckoutStatus
  paymentCollectedAt?: string | Date | null
  recommendedProducts: RecommendedProduct[]
  purchasedProducts: PurchasedProduct[]
  selectedCheckoutProducts: SelectedCheckoutProduct[]
}

type SelectedLine = {
  recommendationId: string
  productId: string
  quantity: number
}

type SubmitResponse = {
  booking?: {
    id: string
    checkoutStatus?: string | null
    serviceSubtotalSnapshot?: string | null
    productSubtotalSnapshot?: string | null
    subtotalSnapshot?: string | null
    tipAmount?: string | null
    taxAmount?: string | null
    discountAmount?: string | null
    totalAmount?: string | null
    paymentAuthorizedAt?: string | null
    paymentCollectedAt?: string | null
  }
  selectedProducts?: Array<{
    recommendationId: string
    productId: string
    quantity: number
    unitPrice: string
    lineTotal: string
  }>
  error?: string
  message?: string
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function getNumericMoney(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.toString === 'function'
  ) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function formatMoneyFromUnknown(value: unknown): string | null {
  const numeric = getNumericMoney(value)
  if (numeric != null) {
    return `$${numeric.toFixed(2)}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
  }

  return null
}

function isInternalRecommendation(
  item: RecommendedProduct,
): item is RecommendedProduct & {
  productId: string
  product: NonNullable<RecommendedProduct['product']>
} {
  return (
    typeof item.productId === 'string' &&
    item.productId.trim().length > 0 &&
    !!item.product &&
    typeof item.product.id === 'string' &&
    item.product.id.trim().length > 0
  )
}

function hasExternalLink(item: RecommendedProduct): boolean {
  return (
    typeof item.externalUrl === 'string' && item.externalUrl.trim().length > 0
  )
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0
  const whole = Math.trunc(value)
  if (whole <= 0) return 0
  if (whole > 99) return 99
  return whole
}

function parseSubmitErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null

  if ('error' in data && typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }

  if (
    'message' in data &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message
  }

  return null
}

async function submitRecommendedProducts(args: {
  bookingId: string
  lines: SelectedLine[]
}): Promise<SubmitResponse> {
  const response = await fetch(
    `/api/client/bookings/${encodeURIComponent(args.bookingId)}/checkout/products`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: args.lines,
      }),
    },
  )

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(
      parseSubmitErrorMessage(data) || 'Could not update booking checkout.',
    )
  }

  return (data ?? {}) as SubmitResponse
}

export default function AftercareProductRecommendationsCard(props: Props) {
  const router = useRouter()

  const [selectedQuantities, setSelectedQuantities] = useState<
    Record<string, number>
  >(() => {
    const initial: Record<string, number> = {}

    for (const item of props.selectedCheckoutProducts) {
      if (
        typeof item.recommendationId === 'string' &&
        item.recommendationId.trim() &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0
      ) {
        initial[item.recommendationId] = Math.max(1, Math.trunc(item.quantity))
      }
    }

    return initial
  })

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const checkoutStatus = upper(props.checkoutStatus)
  const paymentCollected = Boolean(props.paymentCollectedAt)
  const checkoutLocked =
    paymentCollected ||
    checkoutStatus === 'PAID' ||
    checkoutStatus === 'WAIVED'

  const purchasedByProductId = useMemo(() => {
    const map = new Map<string, number>()

    for (const sale of props.purchasedProducts) {
      const productId =
        typeof sale.productId === 'string' ? sale.productId.trim() : ''
      if (!productId) continue

      const quantity = Number.isFinite(sale.quantity)
        ? Math.max(0, Math.trunc(sale.quantity))
        : 0

      map.set(productId, (map.get(productId) ?? 0) + quantity)
    }

    return map
  }, [props.purchasedProducts])

  const internalRecommendations = useMemo(
    () => props.recommendedProducts.filter(isInternalRecommendation),
    [props.recommendedProducts],
  )

  const externalRecommendations = useMemo(
    () =>
      props.recommendedProducts.filter(
        (item) => !isInternalRecommendation(item),
      ),
    [props.recommendedProducts],
  )

  const recommendationById = useMemo(() => {
    return new Map(internalRecommendations.map((item) => [item.id, item]))
  }, [internalRecommendations])

  const selectedLines = useMemo<SelectedLine[]>(() => {
    return internalRecommendations
      .map((recommendation) => {
        const quantity = clampQuantity(selectedQuantities[recommendation.id] ?? 0)
        if (quantity <= 0) return null

        return {
          recommendationId: recommendation.id,
          productId: recommendation.productId,
          quantity,
        }
      })
      .filter((line): line is SelectedLine => line !== null)
  }, [internalRecommendations, selectedQuantities])

  const selectedCount = useMemo(() => {
    return selectedLines.reduce((sum, line) => sum + line.quantity, 0)
  }, [selectedLines])

  const selectedSubtotal = useMemo(() => {
    return selectedLines.reduce((sum, line) => {
      const recommendation = recommendationById.get(line.recommendationId)
      const unitPrice = getNumericMoney(recommendation?.product?.retailPrice)
      return unitPrice != null ? sum + unitPrice * line.quantity : sum
    }, 0)
  }, [recommendationById, selectedLines])

  function setQuantity(recommendationId: string, nextQuantity: number) {
    setError(null)
    setSuccess(null)

    setSelectedQuantities((current) => {
      const normalized = clampQuantity(nextQuantity)

      if (normalized <= 0) {
        const next = { ...current }
        delete next[recommendationId]
        return next
      }

      return {
        ...current,
        [recommendationId]: normalized,
      }
    })
  }

  function increment(recommendationId: string) {
    const current = selectedQuantities[recommendationId] ?? 0
    setQuantity(recommendationId, current + 1)
  }

  function decrement(recommendationId: string) {
    const current = selectedQuantities[recommendationId] ?? 0
    setQuantity(recommendationId, current - 1)
  }

  function onQuantityInput(recommendationId: string, raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      setQuantity(recommendationId, 0)
      return
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      return
    }

    setQuantity(recommendationId, parsed)
  }

  function clearSelection() {
    setError(null)
    setSuccess(null)
    setSelectedQuantities({})
  }

  function handleSubmit() {
    if (checkoutLocked || isPending) return

    setError(null)
    setSuccess(null)

    startTransition(() => {
      void submitRecommendedProducts({
        bookingId: props.bookingId,
        lines: selectedLines,
      })
        .then(() => {
          setSuccess(
            selectedLines.length > 0
              ? 'Updated booking checkout products.'
              : 'Cleared booking checkout products.',
          )
          router.refresh()
        })
        .catch((submitError: unknown) => {
          const message =
            submitError instanceof Error && submitError.message.trim()
              ? submitError.message
              : 'Could not update booking checkout.'
          setError(message)
        })
    })
  }

  if (props.recommendedProducts.length === 0) {
    return (
      <div className="text-[12px] font-semibold text-textSecondary">
        No product recommendations were added yet.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {internalRecommendations.length > 0 ? (
        <div className="grid gap-2">
          {internalRecommendations.map((recommendation) => {
            const productName =
              recommendation.product.name?.trim() || 'Recommended product'
            const productBrand = recommendation.product.brand?.trim() || null
            const unitPrice = getNumericMoney(recommendation.product.retailPrice)
            const priceLabel = formatMoneyFromUnknown(
              recommendation.product.retailPrice,
            )
            const purchasedQty =
              purchasedByProductId.get(recommendation.productId) ?? 0
            const quantity = selectedQuantities[recommendation.id] ?? 0
            const lineTotal =
              unitPrice != null && quantity > 0 ? unitPrice * quantity : null
            const alreadyPurchased = purchasedQty > 0

            return (
              <div
                key={recommendation.id}
                className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[14px] font-black text-textPrimary">
                        {productName}
                      </div>

                      <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                        Booking checkout
                      </span>

                      {alreadyPurchased ? (
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                          Already purchased: {purchasedQty}
                        </span>
                      ) : null}
                    </div>

                    {productBrand ? (
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {productBrand}
                      </div>
                    ) : null}

                    {recommendation.note ? (
                      <div className="mt-2 whitespace-pre-wrap text-[12px] leading-snug text-textPrimary">
                        {recommendation.note}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-black text-textPrimary">
                      {priceLabel || 'Price unavailable'}
                    </div>

                    {lineTotal != null && quantity > 0 ? (
                      <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                        {formatMoneyFromUnknown(lineTotal)} total
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decrement(recommendation.id)}
                    disabled={checkoutLocked || isPending || quantity <= 0}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-bgSecondary text-[16px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Decrease quantity for ${productName}`}
                  >
                    −
                  </button>

                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={quantity > 0 ? String(quantity) : ''}
                    onChange={(event) =>
                      onQuantityInput(recommendation.id, event.target.value)
                    }
                    disabled={checkoutLocked || isPending}
                    placeholder="0"
                    className="h-9 w-16 rounded-full border border-white/10 bg-bgSecondary px-3 text-center text-[12px] font-black text-textPrimary outline-none placeholder:text-textSecondary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Quantity for ${productName}`}
                  />

                  <button
                    type="button"
                    onClick={() => increment(recommendation.id)}
                    disabled={checkoutLocked || isPending}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-bgSecondary text-[16px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Increase quantity for ${productName}`}
                  >
                    +
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setQuantity(recommendation.id, quantity > 0 ? 0 : 1)
                    }
                    disabled={checkoutLocked || isPending}
                    className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[11px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {quantity > 0 ? 'Remove' : 'Add to checkout'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {externalRecommendations.length > 0 ? (
        <div className="grid gap-2">
          {externalRecommendations.map((recommendation) => {
            const productName =
              recommendation.externalName?.trim() || 'Recommended product'
            const href = hasExternalLink(recommendation)
              ? recommendation.externalUrl!.trim()
              : null

            const content = (
              <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[14px] font-black text-textPrimary">
                        {productName}
                      </div>

                      <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                        External link
                      </span>
                    </div>

                    {recommendation.note ? (
                      <div className="mt-2 whitespace-pre-wrap text-[12px] leading-snug text-textPrimary">
                        {recommendation.note}
                      </div>
                    ) : null}
                  </div>

                  {href ? (
                    <div className="shrink-0 text-[11px] font-semibold text-accentPrimary">
                      View
                    </div>
                  ) : null}
                </div>
              </div>
            )

            return href ? (
              <a
                key={recommendation.id}
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {content}
              </a>
            ) : (
              <div key={recommendation.id}>{content}</div>
            )
          })}
        </div>
      ) : null}

      {internalRecommendations.length > 0 ? (
        <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[12px] font-black text-textPrimary">
                Booking-linked product checkout
              </div>

              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                Selected items: {selectedCount}
                {selectedSubtotal > 0
                  ? ` · ${formatMoneyFromUnknown(selectedSubtotal)}`
                  : ''}
              </div>

              {checkoutLocked ? (
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Checkout is locked because payment has already been completed
                  for this booking.
                </div>
              ) : (
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Internal recommendations are added to this booking’s checkout,
                  not a separate store.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearSelection}
                disabled={checkoutLocked || isPending}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={checkoutLocked || isPending}
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? 'Updating…' : 'Save selection'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-3 text-[12px] font-semibold text-red-300">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="mt-3 text-[12px] font-semibold text-textPrimary">
              {success}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}