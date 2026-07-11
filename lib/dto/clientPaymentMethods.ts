// lib/dto/clientPaymentMethods.ts
//
// Wire contract for the client card-on-file endpoints (Phase 2 revenue
// protection): POST /api/v1/client/payment-methods/setup-intent (start a
// SetupIntent), GET/POST /api/v1/client/payment-methods (list / persist a
// confirmed card), DELETE /api/v1/client/payment-methods/[id] (remove).

/** A single saved card, safe to render (never the full PAN). */
export type ClientPaymentMethodDTO = {
  id: string
  /** Card network, e.g. "visa" | "mastercard". Null until Stripe details load. */
  brand: string | null
  /** Last four digits of the card. Null until Stripe details load. */
  last4: string | null
  /** Expiry month 1-12. */
  expMonth: number | null
  /** Expiry year, four digits. */
  expYear: number | null
  /** The card charged first for no-show fees. Exactly one default per client. */
  isDefault: boolean
  /** ISO-8601 instant the card was saved. */
  createdAt: string
}

/** Response for POST /api/v1/client/payment-methods/setup-intent. */
export type ClientSetupIntentResponseDTO = {
  /** SetupIntent client secret to confirm the card with Stripe.js on the client. */
  clientSecret: string
  /** SetupIntent id, echoed back to the confirm (POST payment-methods) step. */
  setupIntentId: string
  /** The client's Stripe Billing customer id. */
  customerId: string
  /**
   * The Stripe publishable key to initialize the client SDK with. Web reads this
   * from the `NEXT_PUBLIC_` bundle inline and ignores this field; native clients
   * (which can't inline build-time env) use it so the key always matches the
   * backend's Stripe mode (test vs live). Empty string if unconfigured.
   */
  publishableKey: string
}

/** Response for GET /api/v1/client/payment-methods. */
export type ClientPaymentMethodsListResponseDTO = {
  paymentMethods: ClientPaymentMethodDTO[]
}

/** Request body for POST /api/v1/client/payment-methods (persist a confirmed card). */
export type ClientPaymentMethodConfirmRequestDTO = {
  /** The SetupIntent the client just confirmed with Stripe.js. */
  setupIntentId: string
}

/** Response for POST /api/v1/client/payment-methods (a card was persisted). */
export type ClientPaymentMethodConfirmResponseDTO = {
  paymentMethod: ClientPaymentMethodDTO
}

/** Response for DELETE /api/v1/client/payment-methods/[id]. */
export type ClientPaymentMethodDeleteResponseDTO = {
  removedId: string
}
