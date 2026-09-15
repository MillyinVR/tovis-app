import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LookAnalysisReview from './LookAnalysisReview'
import type { LookAnalysisItem } from '@/lib/looks/analysis/contracts'
import { lookAnalysisCopy as copy } from '@/lib/brand/lookAnalysisCopy'
import { lookAnalysisReviewCopy as reviewCopy } from '@/lib/brand/lookAnalysisReviewCopy'

const item: LookAnalysisItem = {
  id: 'analysis-1', mediaAssetId: 'media-1', status: 'NEEDS_ADMIN', revision: 4,
  mediaType: 'VIDEO', caption: 'A finished look', selectedFrame: 0, frameCount: 2,
  frameReadBase: '/api/v1/admin/looks/analysis/analysis-1/frame',
  questions: [{ key: 'extensions', label: copy.extensions, options: [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }] }],
  answers: {}, observations: { tone: { value: 'WARM', confidence: { min: 0.5, max: 0.8 }, region: null } },
  flags: [], failure: null, reviewedByUserId: null,
}
const response = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
function mockFetch(status = 200, initial = item) {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ ok: true, items: [initial] })).mockResolvedValueOnce(response({ ok: status === 200 }, status)).mockResolvedValue(response({ ok: true, items: [] }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
async function loaded(mode: 'admin' | 'pro' = 'admin') {
  render(<LookAnalysisReview mode={mode} />)
  await screen.findByText(item.caption!)
  fireEvent.load(screen.getByAltText(reviewCopy.imageAlt))
}
function inspected() { fireEvent.click(screen.getByLabelText(reviewCopy.inspect)) }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('look analysis review', () => {
  it('sends professional answers with the current revision and frame', async () => {
    const fetcher = mockFetch(200, { ...item, status: 'NEEDS_PRO' })
    await loaded('pro')
    fireEvent.change(screen.getByLabelText(copy.extensions), { target: { value: 'NO' } })
    fireEvent.click(screen.getByRole('button', { name: copy.answer }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ revision: 4, action: 'answer', answers: { extensions: 'NO' }, selectedFrame: 0 })
    expect(await screen.findByText(copy.empty)).toBeInTheDocument()
  })
  it('sends admin corrections while preserving original observations on screen', async () => {
    const fetcher = mockFetch()
    await loaded()
    const toneEditor = screen.getByRole('group', { name: copy.fields.tone })
    fireEvent.change(within(toneEditor).getByRole('combobox'), { target: { value: 'COOL' } })
    fireEvent.change(within(toneEditor).getByLabelText(reviewCopy.confidenceMin), { target: { value: '0.7' } })
    fireEvent.click(within(toneEditor).getByLabelText(reviewCopy.region))
    fireEvent.change(within(toneEditor).getByLabelText(reviewCopy.regionLabels.w), { target: { value: '0.5' } })
    expect(screen.getByText('warmth in it', { selector: 'dd' })).toBeInTheDocument()
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ revision: 4, action: 'approve', selectedFrame: 0, corrections: { tone: { value: 'COOL', confidence: { min: 0.7, max: 0.8 }, region: { x: 0, y: 0, w: 0.5, h: 1 } } } })
  })
  it('keeps approved readings separate and preserves their values when editing again', async () => {
    const approvedTone = { value: 'COOL', confidence: { min: 0.7, max: 0.9 }, region: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } }
    const fetcher = mockFetch(200, { ...item, status: 'READY', reviewedObservations: { tone: approvedTone } })
    await loaded()
    const original = screen.getByRole('region', { name: copy.original })
    const approved = screen.getByRole('region', { name: reviewCopy.approved })
    expect(within(original).getByText('warmth in it', { selector: 'dd' })).toBeInTheDocument()
    expect(within(approved).getByText('cool, silvery cast', { selector: 'dd' })).toBeInTheDocument()
    const toneEditor = screen.getByRole('group', { name: copy.fields.tone })
    expect(within(toneEditor).getByRole('combobox')).toHaveValue('COOL')
    expect(within(toneEditor).getByLabelText(reviewCopy.confidenceMin)).toHaveValue(0.7)
    expect(within(toneEditor).getByLabelText(reviewCopy.regionLabels.x)).toHaveValue(0.1)
    fireEvent.change(within(toneEditor).getByLabelText(reviewCopy.confidenceMin), { target: { value: '0.8' } })
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).corrections).toEqual({ tone: { ...approvedTone, confidence: { min: 0.8, max: 0.9 } } })
  })
  it('blocks stale approval after a conflict until a refresh', async () => {
    const fetcher = mockFetch(409)
    await loaded()
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.conflict)
    expect(screen.getByRole('button', { name: copy.approve })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument()
  })
  it('keeps a failed save visible and never shows successful feedback', async () => {
    mockFetch(500)
    await loaded()
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.failed)
    expect(screen.getByText(item.caption!)).toBeInTheDocument()
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument()
  })
  it('hides the previous reading if saving succeeds but refreshing fails', async () => {
    const fetcher = mockFetch()
    fetcher.mockReset().mockResolvedValueOnce(response({ ok: true, items: [item] })).mockResolvedValueOnce(response({ ok: true })).mockResolvedValue(response({ ok: false }, 500))
    await loaded()
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.failed)
    expect(screen.queryByText(item.caption!)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument()
  })
  it('requires the chosen frame reading to reload before approval', async () => {
    const fetcher = mockFetch()
    await loaded()
    inspected()
    fireEvent.change(screen.getByLabelText(copy.frame), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: copy.approve })).toBeDisabled()
    expect(screen.queryByText(copy.original)).not.toBeInTheDocument()
    fireEvent.load(screen.getByAltText(reviewCopy.imageAlt))
    fireEvent.click(screen.getByRole('button', { name: reviewCopy.saveFrame }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ action: 'answer', selectedFrame: 1, revision: 4 })
  })
  it('rejects an invalid confidence range locally', async () => {
    const fetcher = mockFetch()
    await loaded()
    const toneEditor = screen.getByRole('group', { name: copy.fields.tone })
    fireEvent.change(within(toneEditor).getByLabelText(reviewCopy.confidenceMin), { target: { value: '0.9' } })
    inspected()
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    expect(await screen.findByRole('alert')).toHaveTextContent(reviewCopy.invalid)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cannot approve an image that failed to load', async () => {
    mockFetch()
    render(<LookAnalysisReview mode="admin" />)
    await screen.findByText(item.caption!)
    fireEvent.error(screen.getByAltText(reviewCopy.imageAlt))
    expect(screen.getByRole('button', { name: copy.approve })).toBeDisabled()
    expect(screen.getByLabelText(reviewCopy.inspect)).toBeDisabled()
  })
})
