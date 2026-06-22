'use client'

import { ProNameDisplay } from '@prisma/client'
import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import { formatMoneyFromUnknown as formatMoney } from '@/lib/money'

import { CreateAccountInviteCard } from '@/app/client/_public/CreateAccountInviteCard'
import { isRecord } from '@/lib/guards'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

function readProNameDisplay(value: unknown): ProNameDisplay | null {
  return value === ProNameDisplay.BUSINESS_NAME ||
    value === ProNameDisplay.REAL_NAME ||
    value === ProNameDisplay.HANDLE
    ? value
    : null
}

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
}

type DecisionAction = 'APPROVE' | 'REJECT'

function buildPublicConsultationDecisionIdempotencyKey(args: {
  token: string
  action: DecisionAction
}): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `public-consultation-decision-${args.token}-${args.action}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
}

type ActionState = {
  canApproveOrReject: boolean
  isExpired: boolean
  isRevoked: boolean
  isUsed: boolean
  hasProof: boolean
  isPending: boolean
}

type ProofDto = {
  id: string
  decision: string
  method: string
  actedAt: string | null
  recordedByUserId: string | null
  clientActionTokenId: string | null
  contactMethod: string | null
  destinationSnapshot: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

type ApprovalDto = {
  id: string
  status: string
  proposedServicesJson: unknown
  proposedTotal: unknown
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  clientId: string | null
  proId: string | null
  proof: ProofDto | null
}

type BookingDto = {
  id: string
  status: string
  sessionStep: string | null
  scheduledFor: string | null
  startedAt: string | null
  finishedAt: string | null
  locationType: string | null
  service: {
    id: string
    name: string | null
  } | null
  client: {
    id: string
    firstName: string | null
    lastName: string | null
    claimStatus: string | null
  }
  professional: {
    id: string
    businessName: string | null
    firstName: string | null
    lastName: string | null
    handle: string | null
    nameDisplay: ProNameDisplay | null
    timeZone: string | null
  }
}

type TokenDto = {
  id: string
  deliveryMethod: string | null
  destinationSnapshot: string | null
  expiresAt: string | null
  firstUsedAt: string | null
  lastUsedAt: string | null
  useCount: number
  singleUse: boolean
  revokedAt: string | null
  revokeReason: string | null
}

type PublicConsultationDto = {
  booking: BookingDto
  approval: ApprovalDto
  token: TokenDto
  actionState: ActionState
}

type DecisionApproveResponse = {
  action: 'APPROVE'
  booking: {
    id: string
    serviceId: string | null
    offeringId: string | null
    subtotalSnapshot: unknown
    totalDurationMinutes: number
    consultationConfirmedAt: string | null
  }
  approval: {
    id: string
    status: string
    approvedAt: string | null
    rejectedAt: string | null
  }
  proof: ProofDto
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

type DecisionRejectResponse = {
  action: 'REJECT'
  approval: {
    id: string
    status: string
    approvedAt: string | null
    rejectedAt: string | null
  }
  proof: ProofDto
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

type DecisionResponse = DecisionApproveResponse | DecisionRejectResponse

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PublicConsultationDto }

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatWhen(value: unknown, timeZone: string | null | undefined): string | null {
  const date = toDate(value)
  if (!date) return null

  const tz =
    typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC'

  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDateOnly(value: unknown, timeZone: string | null | undefined): string | null {
  const date = toDate(value)
  if (!date) return null

  const tz =
    typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC'

  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}


type ProposedItemView = {
  key: string
  title: string
  subtitle: string | null
}

function extractProposedItems(value: unknown): ProposedItemView[] {
  if (!isRecord(value)) return []

  const rawItems = value.items
  if (!Array.isArray(rawItems)) return []

  return rawItems.map((item, index) => {
    if (!isRecord(item)) {
      return {
        key: `item-${index}`,
        title: `Proposed service ${index + 1}`,
        subtitle: null,
      }
    }

    const title =
      safeText(item.name) ||
      safeText(item.title) ||
      safeText(item.label) ||
      safeText(item.serviceName) ||
      `Proposed service ${index + 1}`

    const subtitleParts = [
      safeText(item.offeringName),
      safeText(item.offeringId),
      safeText(item.serviceId),
    ].filter(Boolean)

    return {
      key: safeText(item.id) || safeText(item.offeringId) || `item-${index}`,
      title,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : null,
    }
  })
}

function statusPillClass(status: string): string {
  const normalized = upper(status)

  if (normalized === 'APPROVED') {
    return 'border border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess'
  }

  if (normalized === 'REJECTED') {
    return 'border border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
  }

  if (normalized === 'PENDING') {
    return 'border border-toneWarn/30 bg-toneWarn/10 text-toneWarn'
  }

  return 'border border-white/10 bg-bgPrimary text-textPrimary'
}

function friendlyProofMethod(value: string | null | undefined): string | null {
  const normalized = upper(value)
  if (!normalized) return null
  if (normalized === 'REMOTE_SECURE_LINK') return 'Remote secure link'
  if (normalized === 'IN_PERSON_PRO_DEVICE') return 'In-person on pro device'
  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function actionSummary(state: ActionState, approval: ApprovalDto): string {
  if (approval.proof?.method === 'IN_PERSON_PRO_DEVICE') {
    return 'This consultation was recorded in person on the professional’s device.'
  }

  if (upper(approval.status) === 'APPROVED') {
    return 'This consultation has already been approved.'
  }

  if (upper(approval.status) === 'REJECTED') {
    return 'This consultation has already been declined.'
  }

  if (state.isExpired) return 'This secure link has expired.'
  if (state.isRevoked) return 'This secure link is no longer active.'
  if (state.hasProof) return 'A consultation proof record already exists for this link.'
  if (state.isUsed && !state.canApproveOrReject) return 'This secure link has already been used.'
  return 'Review the consultation details below and choose approve or decline.'
}

function SectionCard(props: {
  title: string
  subtitle?: string | null
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-white/10 p-4 shadow-[0_14px_48px_rgba(0,0,0,0.35)] tovis-glass">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary">{props.title}</div>
          {props.subtitle ? (
            <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
              {props.subtitle}
            </div>
          ) : null}
        </div>
        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>

      <div className="mt-4">{props.children}</div>
    </section>
  )
}
function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseActionState(value: unknown): ActionState | null {
  if (!isRecord(value)) return null

  const canApproveOrReject = readBoolean(value.canApproveOrReject)
  const isExpired = readBoolean(value.isExpired)
  const isRevoked = readBoolean(value.isRevoked)
  const isUsed = readBoolean(value.isUsed)
  const hasProof = readBoolean(value.hasProof)
  const isPending = readBoolean(value.isPending)

  if (
    canApproveOrReject === null ||
    isExpired === null ||
    isRevoked === null ||
    isUsed === null ||
    hasProof === null ||
    isPending === null
  ) {
    return null
  }

  return {
    canApproveOrReject,
    isExpired,
    isRevoked,
    isUsed,
    hasProof,
    isPending,
  }
}

function parseProof(value: unknown): ProofDto | null {
  if (!isRecord(value)) return null

  const id = readStringOrNull(value.id)
  const decision = readStringOrNull(value.decision)
  const method = readStringOrNull(value.method)

  if (!id || !decision || !method) return null

  return {
    id,
    decision,
    method,
    actedAt: readStringOrNull(value.actedAt),
    recordedByUserId: readStringOrNull(value.recordedByUserId),
    clientActionTokenId: readStringOrNull(value.clientActionTokenId),
    contactMethod: readStringOrNull(value.contactMethod),
    destinationSnapshot: readStringOrNull(value.destinationSnapshot),
    ipAddress: readStringOrNull(value.ipAddress),
    userAgent: readStringOrNull(value.userAgent),
  }
}

function parseApproval(value: unknown): ApprovalDto | null {
  if (!isRecord(value)) return null

  const id = readStringOrNull(value.id)
  const status = readStringOrNull(value.status)

  if (!id || !status) return null

  return {
    id,
    status,
    proposedServicesJson: value.proposedServicesJson,
    proposedTotal: value.proposedTotal,
    notes: readStringOrNull(value.notes),
    createdAt: readStringOrNull(value.createdAt),
    updatedAt: readStringOrNull(value.updatedAt),
    approvedAt: readStringOrNull(value.approvedAt),
    rejectedAt: readStringOrNull(value.rejectedAt),
    clientId: readStringOrNull(value.clientId),
    proId: readStringOrNull(value.proId),
    proof: parseProof(value.proof),
  }
}

function parseBooking(value: unknown): BookingDto | null {
  if (!isRecord(value)) return null

  const id = readStringOrNull(value.id)
  const status = readStringOrNull(value.status)
  const client = isRecord(value.client) ? value.client : null
  const professional = isRecord(value.professional) ? value.professional : null

  if (!id || !status || !client || !professional) return null

  const service = isRecord(value.service)
    ? {
        id: readStringOrNull(value.service.id) ?? '',
        name: readStringOrNull(value.service.name),
      }
    : null

  return {
    id,
    status,
    sessionStep: readStringOrNull(value.sessionStep),
    scheduledFor: readStringOrNull(value.scheduledFor),
    startedAt: readStringOrNull(value.startedAt),
    finishedAt: readStringOrNull(value.finishedAt),
    locationType: readStringOrNull(value.locationType),
    service,
    client: {
      id: readStringOrNull(client.id) ?? '',
      firstName: readStringOrNull(client.firstName),
      lastName: readStringOrNull(client.lastName),
      claimStatus: readStringOrNull(client.claimStatus),
    },
    professional: {
      id: readStringOrNull(professional.id) ?? '',
      businessName: readStringOrNull(professional.businessName),
      firstName: readStringOrNull(professional.firstName),
      lastName: readStringOrNull(professional.lastName),
      handle: readStringOrNull(professional.handle),
      nameDisplay: readProNameDisplay(professional.nameDisplay),
      timeZone: readStringOrNull(professional.timeZone),
    },
  }
}

function parseToken(value: unknown): TokenDto | null {
  if (!isRecord(value)) return null

  const id = readStringOrNull(value.id)
  const useCount = readNumber(value.useCount)
  const singleUse = readBoolean(value.singleUse)

  if (!id || useCount === null || singleUse === null) return null

  return {
    id,
    deliveryMethod: readStringOrNull(value.deliveryMethod),
    destinationSnapshot: readStringOrNull(value.destinationSnapshot),
    expiresAt: readStringOrNull(value.expiresAt),
    firstUsedAt: readStringOrNull(value.firstUsedAt),
    lastUsedAt: readStringOrNull(value.lastUsedAt),
    useCount,
    singleUse,
    revokedAt: readStringOrNull(value.revokedAt),
    revokeReason: readStringOrNull(value.revokeReason),
  }
}

function parsePublicConsultationDto(value: unknown): PublicConsultationDto | null {
  if (!isRecord(value)) return null

  const booking = parseBooking(value.booking)
  const approval = parseApproval(value.approval)
  const token = parseToken(value.token)
  const actionState = parseActionState(value.actionState)

  if (!booking || !approval || !token || !actionState) return null

  return {
    booking,
    approval,
    token,
    actionState,
  }
}

function parseDecisionResponse(value: unknown): DecisionResponse | null {
  if (!isRecord(value)) return null

  const action = readStringOrNull(value.action)
  const approvalRaw = isRecord(value.approval) ? value.approval : null
  const proof = parseProof(value.proof)
  const metaRaw = isRecord(value.meta) ? value.meta : null

  if (!approvalRaw || !proof || !metaRaw) return null

  const approvalId = readStringOrNull(approvalRaw.id)
  const approvalStatus = readStringOrNull(approvalRaw.status)
  const mutated = readBoolean(metaRaw.mutated)
  const noOp = readBoolean(metaRaw.noOp)

  if (!approvalId || !approvalStatus || mutated === null || noOp === null) {
    return null
  }

  const base = {
    approval: {
      id: approvalId,
      status: approvalStatus,
      approvedAt: readStringOrNull(approvalRaw.approvedAt),
      rejectedAt: readStringOrNull(approvalRaw.rejectedAt),
    },
    proof,
    meta: {
      mutated,
      noOp,
    },
  }

  if (action === 'REJECT') {
    return {
      action,
      ...base,
    }
  }

  if (action === 'APPROVE') {
    const bookingRaw = isRecord(value.booking) ? value.booking : null
    if (!bookingRaw) return null

    const bookingId = readStringOrNull(bookingRaw.id)
    const totalDurationMinutes = readNumber(bookingRaw.totalDurationMinutes)

    if (!bookingId || totalDurationMinutes === null) return null

    return {
      action,
      booking: {
        id: bookingId,
        serviceId: readStringOrNull(bookingRaw.serviceId),
        offeringId: readStringOrNull(bookingRaw.offeringId),
        subtotalSnapshot: bookingRaw.subtotalSnapshot,
        totalDurationMinutes,
        consultationConfirmedAt: readStringOrNull(
          bookingRaw.consultationConfirmedAt,
        ),
      },
      ...base,
    }
  }

  return null
}
export default function PublicConsultationPage({ params }: PageProps) {
  const token = safeText(use(params)?.token)
  const [state, setState] = useState<LoadState>(() =>
    token ? { kind: 'loading' } : { kind: 'error', message: 'Missing consultation link.' },
  )
  const [submittingAction, setSubmittingAction] = useState<DecisionAction | null>(null)

    useEffect(() => {
    let cancelled = false

    async function load() {
      if (!token) {
        setState({
          kind: 'error',
          message: 'Missing consultation link.',
        })
        return
      }

      setState({ kind: 'loading' })

      try {
        const response = await fetch(
          `/api/public/consultation/${encodeURIComponent(token)}`,
          {
            method: 'GET',
            cache: 'no-store',
          },
        )

        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            isRecord(payload) && typeof payload.error === 'string'
              ? payload.error
              : 'Unable to load this consultation link.'

          if (!cancelled) {
            setState({ kind: 'error', message })
          }

          return
        }

        // The API returns the payload flat ({ ok: true, booking, ... }).
        // Tolerate a `data` envelope too in case the contract changes.
        const body =
          isRecord(payload) && isRecord(payload.data) ? payload.data : payload

        if (!isRecord(body)) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message: 'Invalid consultation response.',
            })
          }

          return
        }

        const parsed = parsePublicConsultationDto(body)

        if (!parsed) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message: 'Invalid consultation response.',
            })
          }

          return
        }

        if (!cancelled) {
          setState({
            kind: 'ready',
            data: parsed,
          })
        }
      } catch {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: 'Unable to load this consultation link right now.',
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [token])

  const proposedItems = useMemo(() => {
    if (state.kind !== 'ready') return []
    return extractProposedItems(state.data.approval.proposedServicesJson)
  }, [state])

  async function submitDecision(action: DecisionAction) {
    if (state.kind !== 'ready') return
    if (submittingAction) return
    if (!state.data.actionState.canApproveOrReject) return

    setSubmittingAction(action)

    try {
      const idempotencyKey = buildPublicConsultationDecisionIdempotencyKey({
        token,
        action,
      })

      const response = await fetch(
        `/api/public/consultation/${encodeURIComponent(token)}/decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({ action }),
        },
      )

      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `Unable to ${action.toLowerCase()} consultation.`
        throw new Error(message)
      }

      const body =
        isRecord(payload) && isRecord(payload.data) ? payload.data : payload

      if (!isRecord(body)) {
        throw new Error('Invalid decision response.')
      }

      const decision = parseDecisionResponse(body)

        if (!decision) {
          throw new Error('Invalid decision response.')
        }

      if (state.kind !== 'ready') return

      const nextApproval: ApprovalDto = {
        ...state.data.approval,
        status: decision.approval.status,
        approvedAt: decision.approval.approvedAt,
        rejectedAt: decision.approval.rejectedAt,
        proof: decision.proof,
      }

      const nextState: PublicConsultationDto = {
        ...state.data,
        approval: nextApproval,
        actionState: {
          canApproveOrReject: false,
          isExpired: state.data.actionState.isExpired,
          isRevoked: state.data.actionState.isRevoked,
          isUsed: true,
          hasProof: true,
          isPending: false,
        },
      }

      setState({ kind: 'ready', data: nextState })
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : `Unable to ${action.toLowerCase()} consultation.`
      setState({ kind: 'error', message })
    } finally {
      setSubmittingAction(null)
    }
  }

  if (state.kind === 'loading') {
    return (
      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 pt-16 text-textPrimary">
        <div className="rounded-card border border-white/10 bg-bgSecondary p-5">
          <div className="text-sm font-black">Loading consultation…</div>
          <div className="mt-2 text-sm text-textSecondary">
            Pulling the proposal details from your secure link.
          </div>
        </div>
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 pt-16 text-textPrimary">
        <div className="rounded-card border border-toneDanger/20 bg-toneDanger/5 p-5">
          <div className="text-sm font-black text-textPrimary">Consultation link unavailable</div>
          <div className="mt-2 text-sm text-textSecondary">{state.message}</div>
          <div className="mt-4 text-xs text-textSecondary/75">
            Ask your professional to resend the consultation link if needed.
          </div>
        </div>
      </main>
    )
  }

  const { data } = state
  const timeZone = safeText(data.booking.professional.timeZone, 'UTC')
  const serviceTitle =
    safeText(data.booking.service?.name) || 'Consultation'
  const clientLabel = [data.booking.client.firstName, data.booking.client.lastName]
    .map((part) => safeText(part))
    .filter(Boolean)
    .join(' ')
  const professionalLabel = formatProfessionalPublicDisplayName(
    data.booking.professional,
    'your professional',
  )
  const scheduledLabel = formatWhen(data.booking.scheduledFor, timeZone)
  const proposalTotalLabel = formatMoney(data.approval.proposedTotal)
  const proofMethodLabel = friendlyProofMethod(data.approval.proof?.method)
  const proofActedAtLabel = formatWhen(data.approval.proof?.actedAt, timeZone)
  const createdAtLabel = formatDateOnly(data.approval.createdAt, timeZone)
  const expiresAtLabel = formatWhen(data.token.expiresAt, timeZone)
  const destinationLabel = safeText(data.token.destinationSnapshot)
  const approveBusy = submittingAction === 'APPROVE'
  const rejectBusy = submittingAction === 'REJECT'
  const summaryText = actionSummary(data.actionState, data.approval)

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-20 pt-16 text-textPrimary">
      <header className="rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
            Secure consultation link
          </span>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black ${statusPillClass(
              data.approval.status,
            )}`}
          >
            {safeText(data.approval.status, 'UNKNOWN')}
          </span>
        </div>

        <h1 className="mt-4 text-[24px] font-black text-textPrimary">
          {serviceTitle}
        </h1>

        <div className="mt-2 text-sm text-textSecondary">
          {clientLabel ? <span>For {clientLabel}</span> : null}
          {clientLabel ? <span className="opacity-70"> · </span> : null}
          <span>With {professionalLabel}</span>
        </div>

        <div className="mt-2 text-sm text-textSecondary">
          {scheduledLabel ? (
            <>
              {scheduledLabel} <span className="opacity-70">· {timeZone}</span>
            </>
          ) : (
            <span>Times shown in {timeZone}</span>
          )}
        </div>

        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary px-4 py-3">
          <div className="text-[12px] font-black text-textPrimary">Status</div>
          <div className="mt-1 text-sm text-textSecondary">{summaryText}</div>
        </div>
      </header>

      <div className="mt-4 grid gap-4">
        <SectionCard
          title="Proposal"
          subtitle="Review the recommended services and pricing"
          right={
            proposalTotalLabel ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                Proposed total: {proposalTotalLabel}
              </span>
            ) : null
          }
        >
          {proposedItems.length > 0 ? (
            <div className="grid gap-2">
              {proposedItems.map((item) => (
                <div
                  key={item.key}
                  className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3"
                >
                  <div className="text-[14px] font-black text-textPrimary">{item.title}</div>
                  {item.subtitle ? (
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      {item.subtitle}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-textSecondary">
              No structured proposal items were found in this consultation payload.
            </div>
          )}

          <div className="mt-4">
            <div className="text-[12px] font-black text-textSecondary">Consultation notes</div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-textPrimary">
              {safeText(data.approval.notes) || 'No consultation notes provided.'}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Proof and link details" subtitle="Audit-friendly consultation context">
          <div className="grid gap-2 text-sm text-textSecondary">
            <div>
              <span className="font-black text-textPrimary">Proposal created:</span>{' '}
              {createdAtLabel || 'Unknown'}
            </div>

            <div>
              <span className="font-black text-textPrimary">Link expires:</span>{' '}
              {expiresAtLabel || 'Unknown'}
            </div>

            <div>
              <span className="font-black text-textPrimary">Delivery:</span>{' '}
              {safeText(data.token.deliveryMethod) || 'Unknown'}
              {destinationLabel ? (
                <span className="opacity-80"> · {destinationLabel}</span>
              ) : null}
            </div>

            {proofMethodLabel ? (
              <div>
                <span className="font-black text-textPrimary">Proof method:</span>{' '}
                {proofMethodLabel}
              </div>
            ) : null}

            {proofActedAtLabel ? (
              <div>
                <span className="font-black text-textPrimary">Decision recorded:</span>{' '}
                {proofActedAtLabel}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Decision" subtitle="Approve or decline this consultation">
          {data.actionState.canApproveOrReject ? (
            <>
              <div className="text-sm text-textSecondary">
                Approving confirms the proposed consultation plan. Declining keeps the consultation from moving forward until your professional updates it.
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void submitDecision('APPROVE')}
                  disabled={Boolean(submittingAction)}
                  className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-5 py-2.5 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {approveBusy ? 'Approving…' : 'Approve consultation'}
                </button>

                <button
                  type="button"
                  onClick={() => void submitDecision('REJECT')}
                  disabled={Boolean(submittingAction)}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-5 py-2.5 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {rejectBusy ? 'Declining…' : 'Decline consultation'}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3 text-sm text-textSecondary">
              {summaryText}
            </div>
          )}
        </SectionCard>

        {upper(data.booking.client.claimStatus) === 'UNCLAIMED' &&
        (data.actionState.hasProof || !data.actionState.isPending) ? (
          <CreateAccountInviteCard actionToken={token} context="consultation" />
        ) : null}

        <section className="text-xs text-textSecondary/75">
          <div className="font-black text-textSecondary">Need help?</div>
          <div className="mt-1">
            If this link no longer works, ask {professionalLabel} to resend your consultation request.
          </div>
          {safeId(data.booking.professional.id) ? (
            <div className="mt-3">
              <Link
                href={`/professionals/${encodeURIComponent(data.booking.professional.id)}`}
                className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
              >
                View professional profile
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}