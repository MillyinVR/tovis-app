import { CONSULT_HAIR_MAP_FIELDS, CONSULT_HAIR_MAP_SHAPE_FIELDS, CONSULT_HAIR_MAP_ZONES, sanitizeConsultHairMap, type ConsultHairMapView } from '@/lib/consult/hairMap'

export function hairMapFixture(view: ConsultHairMapView = 'hair_back') {
  const unknown = () => ({ value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, evidence: [] })
  const map = {
    zones: Object.fromEntries(CONSULT_HAIR_MAP_ZONES.map(zone => [zone, { level: unknown(), tone: unknown(), pattern: unknown() }])),
    shape: Object.fromEntries(CONSULT_HAIR_MAP_SHAPE_FIELDS.map(field => [field, unknown()])),
  }
  return sanitizeConsultHairMap(map, { role: view === 'inspiration' ? 'REFERENCE' : 'CURRENT', views: [view] })
}

export function hairObservation<F extends keyof typeof CONSULT_HAIR_MAP_FIELDS>(field: F, value: (typeof CONSULT_HAIR_MAP_FIELDS)[F][number], view: ConsultHairMapView = 'hair_back') {
  return { value, confidence: { min: 0.7, max: 0.85 }, evidence: [{ view, region: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }] }
}
