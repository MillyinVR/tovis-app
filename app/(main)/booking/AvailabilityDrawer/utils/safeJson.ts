// app/(main)/booking/AvailabilityDrawer/utils/safeJson.ts
export async function safeJson(res: Response): Promise<any> {
  try {
    // some endpoints legitimately return empty bodies
    const text = await res.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}
