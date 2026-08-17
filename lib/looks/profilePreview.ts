import type { LooksProProfilePreviewRow } from '@/lib/looks/selects'
import type { LooksProProfilePreviewDto } from '@/lib/looks/types'
import { formatProfessionLabel } from '@/lib/profiles/publicProfileFormatting'

export function mapLooksProProfilePreviewToDto(
  profile: LooksProProfilePreviewRow,
): LooksProProfilePreviewDto {
  return {
    id: profile.id,
    businessName: profile.businessName ?? null,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
    handle: profile.handle ?? null,
    nameDisplay: profile.nameDisplay ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    professionType: profile.professionType ?? null,
    // The label rides the wire so no client re-derives it. `professionType`
    // stays for callers that branch on the enum rather than print it.
    professionLabel: formatProfessionLabel(profile.professionType),
    location: profile.location ?? null,
    verificationStatus: profile.verificationStatus,
    isPremium: profile.isPremium,
  }
}