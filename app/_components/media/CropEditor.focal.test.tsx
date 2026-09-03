// app/_components/media/CropEditor.focal.test.tsx
//
// The one thing CropEditor.test.tsx cannot see: what the editor HANDS the feed
// preview. There the preview is real (its shape and width are what is pinned);
// here it is a spy, so the focal the editor remaps can be read back. jsdom has
// no layout, so where the backdrop actually lands is the preview's own concern.

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CropRect } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <div data-testid="image">{alt}</div>,
}))

vi.mock('@/app/_components/ui', () => ({
  Button: ({
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
}))

vi.mock('@/app/_components/media/CropFeedPreview', () => ({
  default: ({
    cropRect,
    focalPoint,
  }: {
    cropRect: CropRect | null
    focalPoint: FocalPoint | null
  }) => (
    <div
      data-testid="preview-spy"
      data-rect={cropRect ? `${cropRect.x},${cropRect.y},${cropRect.w},${cropRect.h}` : 'none'}
      data-focal={focalPoint ? `${focalPoint.x},${focalPoint.y}` : 'none'}
    />
  ),
}))

import CropEditor from './CropEditor'
import { useProMediaCrop } from './useProMediaCrop'

const STORED: CropRect = { x: 0.2, y: 0.1, w: 0.5, h: 0.8 }

function Harness({ focal }: { focal: FocalPoint | null }) {
  const crop = useProMediaCrop({
    mediaId: 'media_1',
    initial: { crop: STORED, bound: STORED, sourceAspect: 3 / 4 },
  })
  return (
    <CropEditor crop={crop} src="https://example.test/a.jpg" alt="A look" focal={focal} />
  )
}

describe('CropEditor → CropFeedPreview focal', () => {
  it('remaps the FRAME-space focal into the live rect before handing it to the preview', () => {
    // Frame (0.45, 0.5) sits inside the rect at ((0.45-0.2)/0.5, (0.5-0.1)/0.8).
    render(<Harness focal={{ x: 0.45, y: 0.5 }} />)

    const spy = screen.getByTestId('preview-spy')
    const rect = spy.getAttribute('data-rect')!.split(',').map(Number)
    const focal = spy.getAttribute('data-focal')!.split(',').map(Number)
    // The hook normalises the rect through the drag maths, so compare
    // numerically — 0.19999999999999996 is 0.2.
    expect(rect[0]).toBeCloseTo(0.2, 10)
    expect(rect[1]).toBeCloseTo(0.1, 10)
    expect(rect[2]).toBeCloseTo(0.5, 10)
    expect(rect[3]).toBeCloseTo(0.8, 10)
    expect(focal[0]).toBeCloseTo(0.5, 10)
    expect(focal[1]).toBeCloseTo(0.5, 10)
  })

  it('hands the preview null when the subject was framed OUT of the rect', () => {
    render(<Harness focal={{ x: 0.05, y: 0.05 }} />)
    expect(screen.getByTestId('preview-spy').getAttribute('data-focal')).toBe('none')
  })

  it('hands the preview null when no focal is stored', () => {
    render(<Harness focal={null} />)
    expect(screen.getByTestId('preview-spy').getAttribute('data-focal')).toBe('none')
  })
})
