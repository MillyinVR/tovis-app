// app/_components/media/ProMediaEditFields.tsx
'use client'

import type { ReactNode } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { FieldLabel } from '@/app/_components/ui'
import { cn } from '@/lib/utils'

import {
  PRO_MEDIA_CAPTION_MAX,
  type ProMediaEdit,
} from './useProMediaEdit'

/**
 * The asset fields a pro edits about their own photo: caption, the before/after
 * pairing, and the service tags. Rendered by BOTH the media detail page's owner
 * menu and the library's manage sheet, so the two can't drift into offering
 * different controls over the same row.
 *
 * 🔴 It renders no visibility control. Whether a photo is public is decided by
 * publish/retract — one act, with its destinations named — and a caller that
 * still owns the two underlying flags renders them itself and passes them to
 * `edit.save()`.
 *
 * `surfaceGlass` is byte-identical to `textPrimary`, so these `textPrimary/…`
 * fills read the same inside the detail page's glass modal as they do on the
 * library sheet's opaque surface.
 */
export default function ProMediaEditFields({
  edit,
}: {
  edit: ProMediaEdit
}) {
  const busy = edit.saving

  return (
    <div className="grid gap-4">
      <Field
        label="Caption"
        right={
          <span className="text-[11px] font-semibold text-textSecondary">
            {edit.caption.trim().length}/{PRO_MEDIA_CAPTION_MAX}
          </span>
        }
      >
        <textarea
          value={edit.caption}
          onChange={(event) =>
            edit.setCaption(event.target.value.slice(0, PRO_MEDIA_CAPTION_MAX))
          }
          rows={3}
          disabled={busy}
          className={cn(
            'w-full resize-y rounded-[16px] border border-textPrimary/10 bg-textPrimary/5',
            'px-3 py-3 text-[13px] text-textPrimary outline-none',
            'focus:ring-2 focus:ring-accentPrimary/35',
          )}
          placeholder="Write a caption…"
        />
      </Field>

      {!edit.isVideo ? (
        <Field
          label="Before / after"
          hint="Pair a “before” photo to show a comparison slider on your public portfolio."
        >
          <div className="flex flex-wrap gap-2 rounded-[18px] border border-textPrimary/10 bg-textPrimary/5 p-3">
            {!edit.beforeOptionsLoaded ? (
              <div className="grid h-16 place-items-center px-2 text-[11px] font-semibold text-textSecondary">
                Loading…
              </div>
            ) : edit.beforeOptions.length === 0 && edit.beforeAssetId === null ? (
              <div className="grid h-16 place-items-center px-2 text-[11px] font-semibold text-textSecondary">
                No before photos from this booking to pair.
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => edit.chooseBefore(null)}
                  className={cn(
                    'brand-focus grid h-16 w-16 place-items-center rounded-xl border text-[11px] font-black transition',
                    edit.beforeAssetId === null
                      ? 'border-accentPrimary/40 bg-accentPrimary/15 text-accentPrimary'
                      : 'border-textPrimary/10 bg-textPrimary/5 text-textSecondary hover:bg-textPrimary/10',
                    busy ? 'cursor-not-allowed opacity-70' : '',
                  )}
                  title="No before/after pairing"
                >
                  None
                </button>

                {edit.beforeOptions.map((option) => {
                  const on = edit.beforeAssetId === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={busy}
                      onClick={() => edit.chooseBefore(option.id)}
                      className={cn(
                        'brand-focus relative h-16 w-16 overflow-hidden rounded-xl border transition',
                        on
                          ? 'border-accentPrimary shadow-[0_0_0_2px_rgb(var(--accent-primary)/0.45)]'
                          : 'border-textPrimary/10 hover:border-textPrimary/30',
                        busy ? 'cursor-not-allowed opacity-70' : '',
                      )}
                      title={
                        option.phase === 'BEFORE'
                          ? 'Before photo'
                          : 'Photo from this booking'
                      }
                    >
                      <RemoteImage
                        src={option.thumbUrl}
                        alt="Before candidate"
                        width={128}
                        height={128}
                        className="h-full w-full object-cover"
                      />
                      {on ? (
                        <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-accentPrimary text-[10px] font-black text-onAccent">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </Field>
      ) : null}

      <Field
        label="Services attached"
        hint="At least 1 service is required."
        right={
          <span className="text-[11px] font-semibold text-textSecondary">
            {edit.selectedServiceIds.length} selected
          </span>
        }
      >
        {edit.selectedServiceIds.length ? (
          <div className="flex flex-wrap gap-2 rounded-[18px] border border-textPrimary/10 bg-textPrimary/5 p-3">
            {edit.selectedServiceIds.slice(0, 10).map((id) => {
              const name = edit.serviceNameById.get(id) || 'Service'
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => edit.removeService(id)}
                  className={cn(
                    'brand-focus inline-flex items-center gap-2 rounded-full px-3 py-1',
                    'border border-textPrimary/10 bg-textPrimary/5',
                    'text-[12px] font-extrabold text-textPrimary',
                    busy ? 'opacity-70' : 'hover:bg-textPrimary/10',
                  )}
                  title="Remove"
                >
                  <span className="max-w-[220px] truncate">{name}</span>
                  <span className="text-textSecondary" aria-hidden="true">
                    ✕
                  </span>
                </button>
              )
            })}
            {edit.selectedServiceIds.length > 10 ? (
              <div className="rounded-full border border-textPrimary/10 bg-textPrimary/5 px-3 py-1 text-[12px] font-extrabold text-textSecondary">
                +{edit.selectedServiceIds.length - 10} more
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[18px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
            Attach at least 1 service to save.
          </div>
        )}

        <div className="mt-3">
          <input
            value={edit.serviceQuery}
            onChange={(event) => edit.setServiceQuery(event.target.value)}
            placeholder="Search services…"
            aria-label="Search services"
            disabled={busy}
            className={cn(
              'w-full rounded-[16px] border border-textPrimary/10 bg-textPrimary/5',
              'px-3 py-2 text-[13px] text-textPrimary outline-none',
              'focus:ring-2 focus:ring-accentPrimary/35',
            )}
          />
        </div>

        <div className="mt-2 max-h-[260px] overflow-auto rounded-[18px] border border-textPrimary/10 bg-textPrimary/5">
          {edit.filteredServices.map((service) => {
            const on = edit.selectedServiceIds.includes(service.id)
            return (
              <button
                key={service.id}
                type="button"
                disabled={busy}
                onClick={() => edit.toggleService(service.id)}
                className={cn(
                  'brand-focus flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                  'border-b border-textPrimary/5 last:border-b-0',
                  busy ? 'opacity-70' : 'hover:bg-textPrimary/10',
                )}
              >
                <span className="text-[13px] font-black text-textPrimary">
                  {service.name}
                </span>

                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black',
                    on
                      ? 'border border-accentPrimary/30 bg-accentPrimary/20 text-accentPrimary'
                      : 'border border-textPrimary/10 bg-textPrimary/5 text-textSecondary',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      on ? 'bg-accentPrimary' : 'bg-textPrimary/35',
                    )}
                  />
                  {on ? 'Selected' : 'Add'}
                </span>
              </button>
            )
          })}

          {edit.filteredServices.length === 0 ? (
            <div className="px-4 py-4 text-[12px] font-semibold text-textSecondary">
              No services found.
            </div>
          ) : null}
        </div>
      </Field>

      {edit.error ? (
        <div className="rounded-[14px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
          {edit.error}
        </div>
      ) : null}
    </div>
  )
}

/** Shared label/hint scaffold, also used by callers that add their own fields. */
export function Field({
  label,
  hint,
  right,
  children,
}: {
  label: string
  hint?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-end justify-between gap-2">
        <div className="grid">
          <FieldLabel>{label}</FieldLabel>
          {hint ? (
            <div className="mt-0.5 text-[11px] font-semibold text-textPrimary/55">
              {hint}
            </div>
          ) : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </div>
  )
}
