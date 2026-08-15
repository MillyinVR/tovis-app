// app/pro/portfolio/_components/ProPortfolioSheets.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { formatCompactCount } from '@/lib/format/compactCount'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'
import { pickString } from '@/lib/pick'
import { DEFAULT_TIME_ZONE, formatRelativeDayAgo, getViewerTimeZone } from '@/lib/time'
import { cn } from '@/lib/utils'
import { zClass } from '@/lib/zIndex'

import type {
  ProPortfolioNudgeBlock,
  ProPortfolioTile,
} from '../_data/proPortfolioTypes'

type Props = {
  tile: ProPortfolioTile | null
  onClose: () => void
}

/**
 * One tap on a tile opens the sheet that matches its STATE, so the pro never
 * meets a control that the server would refuse:
 *   held    → the consent sheet (names the client, offers the only real action)
 *   private → the publish sheet (states where it lands before it lands there)
 *   public  → the manage sheet (its numbers, Signature, make-private, delete)
 * Retract is reached from manage, because taking something down should cost one
 * more deliberate tap than putting it up.
 */
export default function ProPortfolioSheets({ tile, onClose }: Props) {
  // Keyed by tile id so the manage→retract step resets when a different photo
  // is opened, without an effect that writes state during render.
  return tile ? (
    <SheetForTile key={tile.id} tile={tile} onClose={onClose} />
  ) : null
}

function SheetForTile({
  tile,
  onClose,
}: {
  tile: ProPortfolioTile
  onClose: () => void
}) {
  const [retracting, setRetracting] = useState(false)

  if (tile.hold) return <ConsentSheet tile={tile} onClose={onClose} />
  if (tile.publishedAt === null) return <PublishSheet tile={tile} onClose={onClose} />

  return retracting ? (
    <RetractSheet tile={tile} onClose={onClose} onKeep={() => setRetracting(false)} />
  ) : (
    <ManageSheet
      tile={tile}
      onClose={onClose}
      onRetract={() => setRetracting(true)}
    />
  )
}

function Sheet({
  children,
  onClose,
  label,
}: {
  children: React.ReactNode
  onClose: () => void
  label: string
}) {
  return (
    <div
      className={cn('fixed inset-0 flex items-end justify-center bg-overlay/70', zClass.modal)}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'max-h-[92%] w-full overflow-auto rounded-t-[22px] px-4 pb-5 pt-2',
          'border border-textPrimary/10 bg-bgSurface',
          'md:mb-auto md:mt-auto md:w-[480px] md:rounded-[20px] md:px-[22px] md:pb-[22px]',
        )}
      >
        <div className="mx-auto mb-3.5 mt-1.5 h-1 w-[38px] rounded-[3px] bg-textPrimary/15" />
        {children}
      </div>
    </div>
  )
}

function SheetHead({
  tile,
  eyebrow,
  eyebrowTone,
  title,
  meta,
  dimmed,
}: {
  tile: ProPortfolioTile
  eyebrow: string
  eyebrowTone: 'accent' | 'gold' | 'danger'
  title: string
  meta: string
  dimmed?: boolean
}) {
  return (
    <div className="flex items-start gap-[13px]">
      <span
        className={cn(
          'block h-[98px] w-[74px] flex-none overflow-hidden rounded-[13px]',
          dimmed ? 'opacity-60 grayscale' : '',
        )}
      >
        <RemoteImage src={tile.src} alt="" className="h-full w-full object-cover" intrinsic />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'brand-cap mb-[7px] text-[9px]',
            eyebrowTone === 'accent' ? 'text-accentPrimary' : '',
            eyebrowTone === 'gold' ? 'text-microAccent' : '',
            eyebrowTone === 'danger' ? 'text-toneDanger' : '',
          )}
        >
          {eyebrow}
        </div>
        <h2 className="font-display text-[19px] font-bold leading-tight tracking-[-0.025em] text-textPrimary">
          {title}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-snug text-textMuted">{meta}</p>
      </div>
    </div>
  )
}

/**
 * Publishing, stated. The three destinations are the actual consequence — the
 * grid, the feed/search, and client boards — because the system welds
 * portfolio-visibility and Looks-eligibility together anyway. Showing them as
 * two independent toggles (as the old edit modal did) is a lie the pro has to
 * unlearn the first time they use it.
 */
function PublishSheet({ tile, onClose }: { tile: ProPortfolioTile; onClose: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const publish = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(tile.id)}/portfolio`,
        { method: 'POST' },
      )
      const body = await safeJson(res)
      if (!res.ok) throw new Error(readError(body, 'Could not publish this photo.'))

      onClose()
      router.refresh()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not publish this photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} label="Publish this photo">
      <SheetHead
        tile={tile}
        eyebrow="Publish"
        eyebrowTone="accent"
        title="This goes public."
        meta={tile.caption ?? 'Your work, out where clients can find it.'}
      />

      <div className="mt-[18px]">
        <div className="brand-cap mb-1 text-[9px] text-textMuted">Where it appears</div>
        <Destination
          title="Your profile grid"
          body="Anyone who opens your profile."
        />
        <Destination
          title="The Looks feed & search"
          body="Clients who've never heard of you can find it."
        />
        <Destination
          title="Client boards"
          body="They can save it and bring it to a booking."
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-[14px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className={cn(
          'brand-focus mt-[18px] flex h-[50px] w-full items-center justify-center rounded-[14px]',
          'bg-accentPrimary text-[14.5px] font-bold text-onAccent transition',
          busy ? 'cursor-not-allowed opacity-70' : 'hover:bg-accentPrimaryHover',
        )}
      >
        {busy ? 'Publishing…' : 'Publish to my portfolio'}
      </button>

      {/* Reversibility said at the point of the tap — it's what keeps this from
          feeling irreversible without underselling what it does. */}
      <p className="mt-[11px] text-center text-[12px] text-textMuted">
        You can take it back down any time.
      </p>
    </Sheet>
  )
}

function Destination({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-[11px] border-t border-textPrimary/10 py-[11px]">
      <span
        className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-accentPrimary"
        aria-hidden="true"
      />
      <div>
        <div className="text-[13.5px] font-semibold text-textPrimary">{title}</div>
        <div className="mt-0.5 text-[12px] text-textMuted">{body}</div>
      </div>
    </div>
  )
}

/**
 * A blocked photo names a PERSON, not a rule. The only honest action here is to
 * re-issue the aftercare — that is where the client ticks media use, so in this
 * product "ask for permission" and "send the aftercare again" are the same act.
 * The frame drew them as two buttons; two buttons for one action would be a lie.
 */
function ConsentSheet({ tile, onClose }: { tile: ProPortfolioTile; onClose: () => void }) {
  const hold = tile.hold
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!hold) return null

  const nudge = async () => {
    if (busy || !hold.bookingId) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(hold.bookingId)}/aftercare/nudge`,
        { method: 'POST' },
      )
      const body = await safeJson(res)
      if (!res.ok) throw new Error(readError(body, 'Could not send that just now.'))

      setSent(true)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not send that just now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} label={`Waiting on ${hold.clientFirstName}`}>
      <SheetHead
        tile={tile}
        eyebrow={`Waiting on ${hold.clientFirstName}`}
        eyebrowTone="gold"
        title={`${hold.clientFirstName} hasn't said yes to this one.`}
        meta={tile.caption ?? 'Taken during their appointment.'}
        dimmed
      />

      <div className="mt-4 rounded-[18px] border border-microAccent/30 bg-microAccent/10 p-[14px_15px]">
        <p className="text-[13px] leading-relaxed text-textSecondary">
          Photos taken at the chair stay between you and your client. It becomes
          yours to publish the moment {hold.clientFirstName} adds it to a review,
          or ticks media use in their aftercare.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-[14px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}

      {/* 🔴 Offered only when the write boundary would actually accept it.
          `nudgeAftercareRebook` refuses for TWO reasons, and this used to check
          one: no aftercare to re-send (AFTERCARE_NOT_COMPLETED), and no email or
          phone on the client (AFTERCARE_DELIVERY_FAILED) — which is the ordinary
          shape of the unclaimed clients a pro creates by hand. `canNudge` is the
          single gate; `nudgeBlock` says which wall was hit. */}
      {hold.canNudge ? (
        <button
          type="button"
          onClick={nudge}
          disabled={busy || sent}
          className={cn(
            'brand-focus mt-4 flex h-[50px] w-full items-center justify-center rounded-[14px]',
            'text-[14.5px] font-bold transition',
            sent
              ? 'border border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess'
              : 'bg-accentPrimary text-onAccent hover:bg-accentPrimaryHover',
            busy ? 'cursor-not-allowed opacity-70' : '',
          )}
        >
          {sent
            ? `Sent — it's with ${hold.clientFirstName} now`
            : busy
              ? 'Sending…'
              : `Send ${hold.clientFirstName} their aftercare again`}
        </button>
      ) : (
        <p className="mt-4 text-[12.5px] leading-relaxed text-textMuted">
          {nudgeBlockedCopy(hold.nudgeBlock, hold.clientFirstName)}
        </p>
      )}

      <p className="mt-3 text-center text-[12px] leading-snug text-textMuted">
        Nothing is public until {hold.clientFirstName} allows it.
      </p>
    </Sheet>
  )
}

/**
 * A public photo's numbers, then the two things the pro can do to it.
 *
 * 🔴 Six stats, not the frame's seven — "Remixes" is deliberately absent.
 * Remix-clicks are explicitly UNTRACKED in this product (the LookPost rank
 * comment says views stand in for them), so a Remixes tile would be a number we
 * invented. Views are job-incremented and therefore lag; the label stays plain.
 */
function ManageSheet({
  tile,
  onClose,
  onRetract,
}: {
  tile: ProPortfolioTile
  onClose: () => void
  onRetract: () => void
}) {
  const engagement = tile.engagement
  const zone = getViewerTimeZone() ?? DEFAULT_TIME_ZONE
  const since = tile.publishedAt ? formatRelativeDayAgo(tile.publishedAt, zone) : ''

  const stats: Array<{ label: string; value: number; gold?: boolean }> = engagement
    ? [
        { label: 'Views', value: engagement.views },
        { label: 'Likes', value: engagement.likes },
        { label: 'Saves', value: engagement.saves },
        { label: 'Comments', value: engagement.comments },
        { label: 'Shares', value: engagement.shares },
        { label: 'Booked', value: engagement.booked, gold: true },
      ]
    : []

  return (
    <Sheet onClose={onClose} label="Manage this photo">
      <SheetHead
        tile={tile}
        eyebrow={since ? `Public since ${since}` : 'Public'}
        eyebrowTone="accent"
        title={tile.caption ?? 'Untitled photo'}
        meta="On your profile and in the Looks feed."
      />

      {stats.length > 0 ? (
        <>
          <div className="mt-[18px] grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[12px] border border-textPrimary/10 bg-textPrimary/5 p-[11px_12px]"
              >
                <div className="brand-cap text-[8px] text-textMuted">{stat.label}</div>
                <div
                  className={cn(
                    'mt-1.5 font-display text-[19px] font-bold tracking-[-0.02em]',
                    stat.gold ? 'text-microAccent' : 'text-textPrimary',
                  )}
                >
                  {formatCompactCount(stat.value)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] leading-snug text-textMuted">
            Booked means a client opened this photo and then booked you.
          </p>
        </>
      ) : null}

      <div className="my-4 h-px bg-textPrimary/10" />

      <button
        type="button"
        onClick={onRetract}
        className={cn(
          'brand-focus flex h-[46px] w-full items-center justify-start gap-[11px] rounded-[14px] px-4',
          'border border-textPrimary/10 bg-textPrimary/5 text-[14px] font-bold text-textPrimary',
          'transition hover:border-textPrimary/25',
        )}
      >
        Make private — take it off my profile
      </button>
    </Sheet>
  )
}

/**
 * Taking down counts what it costs, in the client's terms rather than the
 * database's — the saves are other people's boards, and they lose it.
 */
function RetractSheet({
  tile,
  onClose,
  onKeep,
}: {
  tile: ProPortfolioTile
  onClose: () => void
  onKeep: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saves = tile.engagement?.saves ?? 0

  const retract = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(tile.id)}/portfolio`,
        { method: 'DELETE' },
      )
      const body = await safeJson(res)
      if (!res.ok) throw new Error(readError(body, 'Could not take this down.'))

      onClose()
      router.refresh()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not take this down.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} label="Take this photo down">
      <SheetHead
        tile={tile}
        eyebrow="Take down"
        eyebrowTone="danger"
        title="Take this back to only you?"
        meta={tile.caption ?? 'It leaves everywhere clients can see it.'}
      />

      <div className="mt-4">
        <Consequence tone="danger" text="It leaves your profile grid and the Looks feed." />
        {saves > 0 ? (
          <Consequence
            tone="danger"
            text={`The ${saves} ${saves === 1 ? 'client who saved' : 'clients who saved'} it to a board lose it.`}
          />
        ) : null}
        <Consequence
          tone="muted"
          text="The photo itself stays here, private. Nothing is deleted."
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-[14px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}

      <div className="mt-[18px] flex gap-2.5">
        <button
          type="button"
          onClick={onKeep}
          className={cn(
            'brand-focus flex h-[46px] flex-1 items-center justify-center rounded-[14px]',
            'border border-textPrimary/10 bg-textPrimary/5 text-[14px] font-bold text-textPrimary',
          )}
        >
          Keep it public
        </button>
        <button
          type="button"
          onClick={retract}
          disabled={busy}
          className={cn(
            'brand-focus flex h-[46px] flex-1 items-center justify-center rounded-[14px]',
            'bg-toneDanger text-[14px] font-bold text-onAccent transition',
            busy ? 'cursor-not-allowed opacity-70' : '',
          )}
        >
          {busy ? 'Taking down…' : 'Take it down'}
        </button>
      </div>
    </Sheet>
  )
}

function Consequence({ tone, text }: { tone: 'danger' | 'muted'; text: string }) {
  return (
    <div className="flex items-start gap-[11px] border-t border-textPrimary/10 py-[11px] first:border-t-0">
      <span
        className={cn(
          'mt-[7px] h-1.5 w-1.5 flex-none rounded-full',
          tone === 'danger' ? 'bg-toneDanger' : 'bg-textMuted',
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          'text-[13.5px]',
          tone === 'danger' ? 'text-textPrimary' : 'text-textSecondary',
        )}
      >
        {text}
      </div>
    </div>
  )
}

/**
 * What to say instead of the button. Each line names the thing the pro can
 * actually go and do — a generic "you can't do that here" would leave them
 * staring at a dimmed photo with no next step.
 */
function nudgeBlockedCopy(
  block: ProPortfolioNudgeBlock | null,
  clientFirstName: string,
): string {
  if (block === 'NO_CONTACT') {
    return `${clientFirstName} has no email or phone on file, so their aftercare can't be sent. Add one to their client record first.`
  }

  if (block === 'NO_BOOKING') {
    return 'This one is private until your client releases it. There is no appointment attached, so there is nothing to re-send from here.'
  }

  return `Send ${clientFirstName} their aftercare first — the media-use tick lives there.`
}

function readError(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  return pickString(body.error) ?? pickString(body.message) ?? fallback
}
