import type { ConsultLookBriefVersionDTO } from '@/lib/dto/consult'

export async function saveConsultLookBriefAction(consultId: string, professional: boolean, action: 'acknowledge' | 'adjust' | 'author', body: object): Promise<ConsultLookBriefVersionDTO> {
  const response = await fetch(`/api/v1/${professional ? 'pro/consults' : 'client/consult'}/${encodeURIComponent(consultId)}/look-plan/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const result: { lookBrief?: ConsultLookBriefVersionDTO } = await response.json()
  if (!response.ok || !result.lookBrief) throw new Error('Your plan may have changed. Refresh and review the current version before saving.')
  return result.lookBrief
}
