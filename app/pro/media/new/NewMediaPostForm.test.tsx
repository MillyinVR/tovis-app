// app/pro/media/new/NewMediaPostForm.test.tsx
//
// Pins the form's video validation to the SAME constant the signing route
// enforces (app/api/v1/pro/uploads/route.test.ts drives the route side of this
// agreement). Before this pin the form promised 200MB while the route refused
// anything over 30MB — a 31-200MB video passed client validation and died at
// upload init.

import { describe, expect, it } from 'vitest'

import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/media/uploadLimits'
import { getVideoFileError } from './NewMediaPostForm'

function videoOfSize(size: number): File {
  const file = new File([], 'clip.mp4', { type: 'video/mp4' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('getVideoFileError', () => {
  it('accepts a video exactly at UPLOAD_MAX_BYTES — what the signing route accepts', () => {
    expect(getVideoFileError(videoOfSize(UPLOAD_MAX_BYTES))).toBeNull()
  })

  it('rejects one byte over UPLOAD_MAX_BYTES, quoting the shared label', () => {
    const error = getVideoFileError(videoOfSize(UPLOAD_MAX_BYTES + 1))

    expect(error).not.toBeNull()
    expect(error).toContain(`The video limit is ${UPLOAD_MAX_LABEL}.`)
  })

  it('still rejects a missing or empty file', () => {
    expect(getVideoFileError(null)).toBe('Select an image or video to post.')
    expect(getVideoFileError(videoOfSize(0))).toBe('That file looks empty.')
  })
})
