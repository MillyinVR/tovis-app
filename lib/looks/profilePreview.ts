import type { LooksProProfilePreviewRow } from '@/lib/looks/selects'
import type { LooksProProfilePreviewDto } from '@/lib/looks/types'

export function mapLooksProProfilePreviewToDto(
  profile: LooksProProfilePreviewRow,
): LooksProProfilePreviewDto {
  return {
    id: profile.id,
    businessName: profile.businessName ?? null,
    handle: profile.handle ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    professionType: profile.professionType ?? null,
    location: profile.location ?? null,
    verificationStatus: profile.verificationStatus,
    isPremium: profile.isPremium,
  }
}