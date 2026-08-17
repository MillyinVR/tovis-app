// lib/brand/BrandLoader.tsx
//
// The tovis loading splash ("Immersive Shimmer"): the feather Eye breathing
// in a drifting plume of light, the wordmark, and a shimmer progress bar.
// Themed light/dark via brand tokens; the eye + plume + shimmer are brand
// constants. Reduced-motion users get a static version (global reset).
//
// variant:
//   'fullscreen' — fixed full-viewport splash (root loading.tsx / cold start)
//   'inline'     — fills its container (section/route-segment loading states)
import type { CSSProperties } from 'react'
import BrandWordmark from './BrandWordmark'
import { TOVIS_EYE_GLINT, TOVIS_EYE_PATH } from './eyeSvg'
import { TovisEyeGradient } from './TovisEye'

type BrandLoaderProps = {
  variant?: 'fullscreen' | 'inline'
  /** Caption under the bar. Defaults to a calm brand line. */
  caption?: string
  /** 0–100 for a determinate bar; omit for an indeterminate shimmer. */
  progress?: number
}

// Brand-constant plume (matches --plume direction; used as the ambient glow).
const PLUME_GLOW =
  'radial-gradient(60% 50% at 50% 38%, #15C9A8, #1574C4 46%, #6B4BE6 78%, transparent 100%)'

const driftStyle: CSSProperties = {
  position: 'absolute',
  inset: '-20%',
  background: PLUME_GLOW,
  opacity: 0.28,
  filter: 'blur(36px)',
  animation: 'tovisDrift 11s ease-in-out infinite',
  pointerEvents: 'none',
}

const eyeWrapStyle: CSSProperties = {
  width: 116,
  height: 116,
  animation: 'tovisBreathe 4.5s ease-in-out infinite',
  filter:
    'drop-shadow(0 0 24px rgba(255,240,194,0.45)) drop-shadow(0 0 12px rgba(242,180,62,0.5))',
}

export default function BrandLoader({
  variant = 'fullscreen',
  caption = 'Setting the light',
  progress,
}: BrandLoaderProps) {
  const isDeterminate = typeof progress === 'number'
  const width = isDeterminate
    ? `${Math.max(0, Math.min(100, progress as number))}%`
    : undefined

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={[
        'flex flex-col items-center justify-center overflow-hidden bg-bgPrimary',
        variant === 'fullscreen'
          ? 'fixed inset-0 z-[100000]'
          : 'relative min-h-[60vh] w-full',
      ].join(' ')}
    >
      <span className="sr-only">Loading…</span>

      {/* drifting plume + grounding vignette */}
      <div aria-hidden="true" style={driftStyle} />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 70% at 50% 50%, transparent 30%, rgb(var(--bg-primary) / 0.5) 78%, rgb(var(--bg-primary)) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* breathing eye + wordmark */}
      <div className="relative z-10 flex flex-col items-center">
        <div style={eyeWrapStyle}>
          <svg
            width="116"
            height="116"
            viewBox="0 0 100 100"
            style={{ overflow: 'visible' }}
            aria-hidden="true"
          >
            <TovisEyeGradient id="tovisLoaderEye" />
            <path d={TOVIS_EYE_PATH} fill="url(#tovisLoaderEye)" />
            {/* The splash's glint pulses, and is a brighter white than the
                mark's resting cream so it reads through the breathing glow. */}
            <circle
              cx={TOVIS_EYE_GLINT.cx}
              cy={TOVIS_EYE_GLINT.cy}
              r={TOVIS_EYE_GLINT.r}
              fill="#FFFFFF"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'tovisGlint 2.2s ease-in-out infinite',
              }}
            />
          </svg>
        </div>

        <div className="mt-6 text-textPrimary">
          <BrandWordmark size={32} />
        </div>
      </div>

      {/* shimmer bar + caption */}
      <div className="relative z-10 mt-10 w-[min(78%,320px)]">
        <div
          className="h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: 'rgb(var(--surface-glass) / 0.14)' }}
        >
          {isDeterminate ? (
            <div
              style={{
                height: '100%',
                width,
                borderRadius: 999,
                background: 'var(--plume)',
                backgroundSize: '200% 100%',
                animation: 'tovisShimmer 2.4s linear infinite alternate',
              }}
            />
          ) : (
            <div
              style={{
                height: '100%',
                width: '32%',
                borderRadius: 999,
                background: 'var(--cta)',
                animation: 'tovisIndeterminate 1.5s ease-in-out infinite',
              }}
            />
          )}
        </div>
        <div className="mt-3.5 text-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">
          {caption}
        </div>
      </div>
    </div>
  )
}
