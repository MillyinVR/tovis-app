// lib/dto/services.ts

export type ServiceDTO = {
  id: string
  name: string
  minPrice: string
  defaultDurationMinutes: number
  defaultImageUrl?: string | null
  isAddOnEligible: boolean
  addOnGroup?: string | null
}

export type CategoryDTO = {
  id: string
  name: string
  services: ServiceDTO[]
  children: { id: string; name: string; services: ServiceDTO[] }[]
}

export type OfferingDTO = {
  id: string
  serviceId: string
}
