// app/offerings/[id]/_bookingPanel/api.ts

export async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

export function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return 'That time was just taken or your hold expired. Please pick another slot.'
  return `Request failed (${res.status}).`
}
