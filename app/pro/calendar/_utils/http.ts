// app/pro/calendar/_utils/http.ts

export async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}
