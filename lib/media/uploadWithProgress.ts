// lib/media/uploadWithProgress.ts
//
// XHR-based upload to a Supabase signed URL with real progress events.
// Replaces the Supabase client SDK's uploadToSignedUrl which uses fetch
// (no progress support in browsers).

export type UploadProgressArgs = {
  bucket: string
  path: string
  token: string
  file: File
  contentType: string
  onProgress: (percent: number) => void
  signal: AbortSignal
}

export type UploadProgressResult = {
  error: string | null
}

function readErrorMessage(xhr: XMLHttpRequest): string {
  try {
    const body: unknown = JSON.parse(xhr.responseText)
    if (
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
    ) {
      return (body as { message: string }).message
    }
  } catch {
    // Fall through to default
  }

  return `Upload failed (${xhr.status}).`
}

export function uploadWithProgress(
  args: UploadProgressArgs,
): Promise<UploadProgressResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return Promise.resolve({ error: 'Storage configuration missing.' })
  }

  if (args.signal.aborted) {
    return Promise.resolve({ error: null })
  }

  return new Promise((resolve) => {
    const url = new URL(
      `/storage/v1/object/upload/sign/${args.bucket}/${args.path}`,
      supabaseUrl,
    )
    url.searchParams.set('token', args.token)

    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) {
        args.onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ error: null })
      } else {
        resolve({ error: readErrorMessage(xhr) })
      }
    })

    xhr.addEventListener('error', () => {
      resolve({ error: 'Upload failed — check your connection.' })
    })

    xhr.addEventListener('abort', () => {
      resolve({ error: null })
    })

    args.signal.addEventListener('abort', () => xhr.abort(), { once: true })

    // MUST be PUT, not POST.
    //
    // The signed-upload endpoint authorizes the write via the service-role-signed
    // `token` in the URL and bypasses RLS — but only on PUT (this matches the
    // Supabase SDK's uploadToSignedUrl). A POST to the same endpoint is treated as
    // a normal upload, runs as the request's anon role, and fails the media-private
    // INSERT RLS check with "new row violates row-level security policy". That is
    // exactly what produced the intermittent BEFORE-ok / AFTER-fail session photos
    // after a storage-api change stopped POST from honoring the token.
    //
    // `apikey` is required for the API gateway to route the request. No
    // Authorization bearer is needed — the token is the sole authorizer, and
    // sending the anon key as a bearer only invites anon-role evaluation.
    //
    // Verified against production 2026-06-13 (scripts/diag-signed-upload.mjs):
    // PUT+apikey -> 200; POST+apikey -> 403 RLS.
    xhr.open('PUT', url.toString())
    xhr.setRequestHeader('apikey', supabaseKey)
    xhr.setRequestHeader('Content-Type', args.contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.send(args.file)
  })
}
