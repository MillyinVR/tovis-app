'use client'

import Image from 'next/image'
import { useId, useRef, useState } from 'react'
import type { BrandHomeCardPreview } from '@/lib/brand/types'

/** A concept preview, with the same disclosure available to mouse, touch and keyboard. */
export default function CardPreview({ card }: { card: BrandHomeCardPreview }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const pointerType = useRef('')

  return (
    <div
      className="relative mt-5"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setOpen(false)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        pointerType.current = ''
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onPointerDown={(event) => { pointerType.current = event.pointerType }}
        onClick={() => setOpen((value) => pointerType.current === 'mouse' ? true : !value)}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        className="rounded-sm text-left text-sm font-semibold underline decoration-microAccent/50 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-microAccent"
      >
        {card.trigger}
      </button>
      <div id={id} hidden={!open} className="relative z-30 mt-3 w-full max-w-[370px] rounded-[20px] border border-surfaceGlass/20 bg-bgPrimary p-4 shadow-xl md:absolute md:bottom-full md:right-0 md:mb-0 md:mt-0 md:w-[340px]">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">{card.previewLabel}</p>
        <div className="tv-card-stage aspect-[1.586]">
          <div className="tv-card-turn">
            {[false, true].map((back) => (
              <div key={String(back)} aria-hidden={back || undefined} className={`tv-card-face ${back ? 'tv-card-back' : ''} tv-card-concept tv-card-concept--${card.finish} flex flex-col items-center justify-center gap-1 rounded-[12px] border px-5 pb-8 pt-3 text-center`}>
                <Image src={card.markSrc} alt="" width={38} height={38} className="tv-card-mark object-contain" />
                <span className="tv-card-engraving font-display text-2xl font-bold tracking-[-0.04em]">{card.brandName}</span>
                <span className="tv-card-engraving mt-2 font-mono text-[9px] tracking-[0.18em]">{card.tier}</span>
                <span className="tv-card-engraving absolute bottom-4 right-5 font-mono text-[9px] tracking-[0.1em]">{card.serial}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-textMuted">{card.note}</p>
      </div>
    </div>
  )
}
