// app/_components/media/CropEditor.test.tsx
//
// The editor rendered and DRIVEN, not just typechecked. The geometry itself is
// covered in lib/media/cropDrag.test.ts; what is tested here is the wiring the
// component owns — that a pointer drag reaches the rect at all, that the frame's
// measured box is what pixels are divided by, and that the save is gated and its
// refusal is shown rather than swallowed.

import React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The intrinsic size the stubbed image reports, or null for "never reports one".
 *
 * 🔴 It reports from an EFFECT, not from a load event, on purpose: the real
 * `RemoteImage` fires `onNaturalSize` from its ref for an image that was already
 * `complete` when React attached — which is the normal case for a cached photo,
 * and the case where `onLoad` never fires at all. The editor was measuring every
 * drag against a fallback 3:4 box because of it (found in Chromium, not here).
 */
const mockNaturalSize = vi.hoisted(() => ({
  value: null as { width: number; height: number } | null,
}))

vi.mock('@/app/_components/media/RemoteImage', () => {
  function RemoteImageStub({
    alt,
    onNaturalSize,
  }: {
    alt: string
    onNaturalSize?: (width: number, height: number) => void
  }) {
    React.useEffect(() => {
      const size = mockNaturalSize.value
      if (size && onNaturalSize) onNaturalSize(size.width, size.height)
    }, [onNaturalSize])
    return <div data-testid="image">{alt}</div>
  }
  return { default: RemoteImageStub }
})

vi.mock('@/app/_components/ui', () => ({
  Button: ({
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
}))

import CropEditor from './CropEditor'
import { useProMediaCrop, type ProMediaCropInitial } from './useProMediaCrop'
import { FULL_FRAME_CROP } from '@/lib/media/cropRect'

/** jsdom gives every element a 0×0 box, which would divide every drag by zero. */
const FRAME_PX = { width: 400, height: 533 }

function stubFrameBox() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: FRAME_PX.width,
    bottom: FRAME_PX.height,
    width: FRAME_PX.width,
    height: FRAME_PX.height,
    toJSON: () => ({}),
  } as DOMRect)
}

/** Renders the editor over a real hook, exposing the live rect for assertions. */
function Harness({
  initial,
  onSaved,
}: {
  initial: ProMediaCropInitial
  onSaved?: () => void
}) {
  const crop = useProMediaCrop({ mediaId: 'media_1', initial, onSaved })
  return (
    <>
      <CropEditor crop={crop} src="https://example.test/a.jpg" alt="A look" />
      <output data-testid="rect">
        {`${crop.rect.x.toFixed(4)},${crop.rect.y.toFixed(4)},${crop.rect.w.toFixed(
          4,
        )},${crop.rect.h.toFixed(4)}`}
      </output>
    </>
  )
}

function readRect(): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = screen
    .getByTestId('rect')
    .textContent!.split(',')
    .map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}

const BOUND = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }

beforeEach(() => {
  vi.restoreAllMocks()
  stubFrameBox()
})

/**
 * A pointer press → move → release on `el`, in client pixels.
 *
 * ⚠️ Two jsdom facts this has to work around, both measured rather than assumed:
 *   - `PointerEvent` does not exist, and RTL's `fireEvent.pointerMove` falls back
 *     to a generic Event that DROPS clientX/clientY — so a drag fired that way
 *     travels zero pixels and every assertion below would pass vacuously. A
 *     MouseEvent named `pointermove` carries the coordinates and React and
 *     `addEventListener` both accept it.
 *   - the dispatch must be inside `act()`. Without it the state update happens
 *     but React has not re-rendered when the assertion reads the DOM, which
 *     looks exactly like a drag handler that was never wired up.
 */
async function drag(el: Element, dxPx: number, dyPx: number) {
  const target = el as HTMLElement
  target.setPointerCapture = vi.fn()
  const make = (type: string, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
    Object.defineProperty(e, 'pointerId', { value: 1 })
    return e
  }
  await act(async () => {
    target.dispatchEvent(make('pointerdown', 0, 0))
    target.dispatchEvent(make('pointermove', dxPx, dyPx))
    target.dispatchEvent(make('pointerup', dxPx, dyPx))
  })
}

describe('CropEditor', () => {
  it('opens on the whole bound when the asset has never been re-framed', () => {
    render(
      <Harness
        initial={{ crop: null, bound: BOUND, sourceAspect: 0.75 }}
      />,
    )
    expect(readRect()).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 })
  })

  it('moves the window when the window itself is dragged', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    // A tenth of the frame's width to the right, a tenth of its height down.
    await drag(screen.getByTestId('crop-window'), FRAME_PX.width * 0.1, FRAME_PX.height * 0.1)

    const rect = readRect()
    expect(rect.x).toBeCloseTo(0.4, 3)
    expect(rect.y).toBeCloseTo(0.4, 3)
    // A move keeps its size — this is the assertion that catches a drag wired
    // into resize by mistake.
    expect(rect.w).toBeCloseTo(0.2, 3)
  })

  it('resizes from a corner handle without moving the opposite edge', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    await drag(screen.getByTestId('crop-handle-se'), FRAME_PX.width * 0.1, FRAME_PX.height * 0.1)

    const rect = readRect()
    expect(rect.x).toBeCloseTo(0.3, 3)
    expect(rect.y).toBeCloseTo(0.3, 3)
    expect(rect.w).toBeCloseTo(0.3, 3)
  })

  it('will not drag the window outside the bound', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: BOUND,
          sourceAspect: 0.75,
        }}
      />,
    )

    await drag(screen.getByTestId('crop-window'), FRAME_PX.width * 5, FRAME_PX.height * 5)

    const rect = readRect()
    expect(rect.x + rect.w).toBeLessThanOrEqual(BOUND.x + BOUND.w + 1e-6)
    expect(rect.y + rect.h).toBeLessThanOrEqual(BOUND.y + BOUND.h + 1e-6)
  })

  // ── Keyboard ───────────────────────────────────────────────────────────────
  //
  // 🔴 The handles are real <button>s, so a keyboard user can Tab straight onto
  // them. A focusable control that only answers `pointerdown` is worse than no
  // control — nothing happens and there is no way to tell that from a broken
  // page. Every gesture has a key equivalent, and these are what say so.

  it('moves the window with the arrow keys', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    screen.getByTestId('crop-window').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowDown}')

    const rect = readRect()
    expect(rect.x).toBeCloseTo(0.31, 4)
    expect(rect.y).toBeCloseTo(0.31, 4)
    expect(rect.w).toBeCloseTo(0.2, 4)
  })

  it('takes a bigger step with shift held', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    screen.getByTestId('crop-window').focus()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')

    expect(readRect().x).toBeCloseTo(0.35, 4)
  })

  it('resizes from a focused handle WITHOUT also moving the window', async () => {
    // The handle sits inside the draggable window, so without stopPropagation
    // one arrow press would resize AND slide the rect — the origin would drift
    // by a step while the far edge moved by one.
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    screen.getByTestId('crop-handle-se').focus()
    await userEvent.keyboard('{ArrowRight}')

    const rect = readRect()
    expect(rect.x).toBeCloseTo(0.3, 4)
    expect(rect.w).toBeCloseTo(0.21, 4)
  })

  it('leaves keys it does not handle alone', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    screen.getByTestId('crop-window').focus()
    await userEvent.keyboard('{PageDown}a')

    // Unchanged — and, more to the point, not swallowed: the sheet this lives
    // in still has to be able to scroll.
    expect(readRect()).toEqual({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 })
  })

  it('keeps Save disabled until something actually changes', async () => {
    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
      />,
    )

    const save = screen.getByRole('button', { name: /save framing/i })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Square' }))
    expect(save).not.toBeDisabled()
  })

  it('PUTs the rect and reports success to the caller', async () => {
    const onSaved = vi.fn()
    // Captured through a typed closure rather than read back off the mock and
    // cast — the house rule is no type escapes, tests included.
    const sent: { url: string; init: RequestInit }[] = []
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, init })
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Square' }))
    await userEvent.click(screen.getByRole('button', { name: /save framing/i }))

    expect(sent).toHaveLength(1)
    const call = sent[0]
    if (!call) throw new Error('expected a crop request')
    expect(call.url).toBe('/api/v1/pro/media/media_1/crop')
    expect(call.init.method).toBe('PUT')
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      cropX: expect.any(Number),
      cropY: expect.any(Number),
      cropW: expect.any(Number),
      cropH: expect.any(Number),
    })
    expect(onSaved).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('SHOWS the server’s refusal instead of assuming it cannot happen', async () => {
    // 🔴 The bound in this component is a courtesy; the rule is server-side and
    // is re-read at execution. A 403 is a real answer — including one the UI
    // believed it had already prevented — and the pro has to see it.
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: 'Widening a published photo needs consent.' }),
            { status: 403 },
          ),
        ),
      ),
    )

    render(
      <Harness
        initial={{
          crop: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          bound: FULL_FRAME_CROP,
          sourceAspect: 0.75,
        }}
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Square' }))
    await userEvent.click(screen.getByRole('button', { name: /save framing/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Widening a published photo needs consent.',
    )
    expect(onSaved).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('draws the consent bound only when it is not the whole photo', () => {
    const { rerender } = render(
      <Harness initial={{ crop: null, bound: FULL_FRAME_CROP, sourceAspect: 0.75 }} />,
    )
    expect(screen.queryByTestId('crop-bound')).toBeNull()

    rerender(<Harness initial={{ crop: null, bound: BOUND, sourceAspect: 0.75 }} />)
    expect(screen.getByTestId('crop-bound')).toBeTruthy()
  })
})

describe('CropEditor — the frame takes the PHOTO\'s shape', () => {
  /**
   * 🔴 Why this matters more than it looks: `normalize()` divides pointer pixels
   * by the FRAME's measured box. If the frame is not the photo's shape, the
   * photo sits letterboxed inside it and every drag is scaled by the wrong
   * factor — so the rect that gets stored is not the rect the pro drew on their
   * own photograph. Measured in Chromium on an 880×800 image: the frame stayed
   * at the caller's fallback 3:4 because `onLoad` never fires for an image that
   * was already decoded.
   */
  it('adopts the source aspect the image reports, with no load event', () => {
    mockNaturalSize.value = { width: 880, height: 800 }
    try {
      render(<Harness initial={{ crop: null, bound: FULL_FRAME_CROP, sourceAspect: 3 / 4 }} />)
      const frame = screen.getByTestId('crop-frame')
      expect(frame.style.aspectRatio).toBe('1.1')
    } finally {
      mockNaturalSize.value = null
    }
  })

  it('keeps the caller\'s fallback when the image never reports a size', () => {
    render(<Harness initial={{ crop: null, bound: FULL_FRAME_CROP, sourceAspect: 3 / 4 }} />)
    expect(screen.getByTestId('crop-frame').style.aspectRatio).toBe('0.75')
  })
})
