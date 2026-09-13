import { fireEvent, render, screen } from '@testing-library/react'
import { useCallback } from 'react'
import { expect, it, vi } from 'vitest'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import ConsultPhotoFocus from './ConsultPhotoFocus'

vi.mock('@/app/_components/media/RemoteImage', () => ({ default: function MockRemoteImage(props: {
  src: string; alt: string; onNaturalSize?: (width: number, height: number) => void
  onError?: () => void
}) {
  // Match RemoteImage's cached-image ref notification: an unstable callback
  // used to trigger a render loop before a user could make any selection.
  const ref = useCallback((image: HTMLImageElement | null) => {
    if (image) props.onNaturalSize?.(400, 500)
  }, [props.onNaturalSize])
  return <img ref={ref} src={props.src} alt={props.alt} onLoad={() => props.onNaturalSize?.(400, 500)} onError={props.onError} />
} }))

const copy = defaultClientConsultInspirationCopy.focus!
const selfieCopy = defaultClientConsultThreadCopy.captureFocus
function setup(busy = false) {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  render(<ConsultPhotoFocus src="blob:local-photo" copy={copy} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.load(screen.getByAltText(copy.photo))
  return { onConfirm, onCancel }
}

/** The selfie's card: the same component, plus the whole-photo answer. */
function setupSelfie(busy = false) {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  render(<ConsultPhotoFocus src="blob:local-selfie" copy={selfieCopy} busy={busy}
    fullFrameLabel={selfieCopy.fullFrame} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.load(screen.getByAltText(selfieCopy.photo))
  return { onConfirm, onCancel }
}

it('requires an explicit choice and confirmation, with adjustable bounded edges', () => {
  const { onConfirm } = setup()
  expect(screen.queryByRole('button', { name: copy.confirm })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: copy.center }))
  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('slider', { name: copy.right }), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  const [call] = onConfirm.mock.calls
  if (!call) throw new Error('Expected a confirmed selection')
  expect(call[0]).toMatchObject({ x: 0.3, y: 0.25, h: 0.5 })
  expect(call[0].w).toBeCloseTo(0.08)
})

it('cancels without confirming or uploading', () => {
  const { onConfirm, onCancel } = setup()
  fireEvent.click(screen.getByRole('button', { name: copy.center }))
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onConfirm).not.toHaveBeenCalled()
})

it('does not permit confirmation of an unreadable image', () => {
  const { onConfirm } = setup()
  fireEvent.error(screen.getByAltText(copy.photo))
  expect(screen.getByRole('alert')).toHaveTextContent(copy.loadError)
  expect(screen.queryByRole('button', { name: copy.confirm })).not.toBeInTheDocument()
  expect(onConfirm).not.toHaveBeenCalled()
})

it('disables selection while the upload owner is busy', () => {
  setup(true)
  expect(screen.getByRole('button', { name: copy.center })).toBeDisabled()
  expect(screen.getByRole('button', { name: copy.cancel })).toBeDisabled()
})

// 🔴 The whole photo is an ANSWER on the selfie, not a fallback: she has just
// chosen a picture of herself, and a crop is the exception. It is offered
// without a rectangle, and confirming it hands over the full frame.
it('sends the selfie whole in one tap, and still allows a zoom', () => {
  const { onConfirm } = setupSelfie()
  fireEvent.click(screen.getByRole('button', { name: selfieCopy.fullFrame }))
  expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, w: 1, h: 1 })

  fireEvent.click(screen.getByRole('button', { name: selfieCopy.center }))
  fireEvent.click(screen.getByRole('button', { name: selfieCopy.confirm }))
  expect(onConfirm).toHaveBeenCalledTimes(2)
  expect(onConfirm.mock.calls[1]?.[0]).toMatchObject({ x: 0.3, y: 0.25, w: 0.4, h: 0.5 })
})

// The inspiration card has no such answer — the whole frame is exactly what it
// exists to narrow down — so the button must not appear there.
it('offers the whole frame only where the caller asked for it', () => {
  setup()
  expect(screen.queryByTestId('consult-focus-full-frame')).not.toBeInTheDocument()
})

it('does not send an unreadable selfie whole', () => {
  const { onConfirm } = setupSelfie()
  fireEvent.error(screen.getByAltText(selfieCopy.photo))
  expect(screen.queryByTestId('consult-focus-full-frame')).not.toBeInTheDocument()
  expect(onConfirm).not.toHaveBeenCalled()
})

// The whole photo does not wait on a natural size: a rectangle needs the
// image's dimensions, and sending the frame as it is does not. Caught in a
// browser — the button rendered greyed out before the image reported a size.
it('offers the whole photo before the image reports its size', () => {
  const onConfirm = vi.fn()
  render(<ConsultPhotoFocus src="blob:unloaded" copy={selfieCopy} busy={false}
    fullFrameLabel={selfieCopy.fullFrame} onConfirm={onConfirm} onCancel={vi.fn()} />)
  const whole = screen.getByTestId('consult-focus-full-frame')
  expect(whole).toBeEnabled()
  fireEvent.click(whole)
  expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, w: 1, h: 1 })
})
