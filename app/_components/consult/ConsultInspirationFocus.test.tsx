import { fireEvent, render, screen } from '@testing-library/react'
import { useCallback } from 'react'
import { expect, it, vi } from 'vitest'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import ConsultInspirationFocus from './ConsultInspirationFocus'

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
function setup(busy = false) {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  render(<ConsultInspirationFocus src="blob:local-photo" copy={copy} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.load(screen.getByAltText(copy.photo))
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
