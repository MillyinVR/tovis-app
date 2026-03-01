// app/(main)/search/_components/MapView.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

type Coords = { lat: number; lng: number }

export type Pin = {
  id: string
  lat: number
  lng: number
  label: string
  sublabel?: string
  active?: boolean
}

export type Bounds = { north: number; south: number; east: number; west: number }

type Props = {
  me: Coords | null
  origin?: Coords | null
  pins: Pin[]
  radiusMiles?: number
  onSelectPin: (id: string) => void

  onViewportChange?: (center: Coords, zoom: number) => void
  focus?: { lat: number; lng: number; zoom?: number } | null
  fitBounds?: Bounds | null

  enableClustering?: boolean
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function assetUrl(mod: unknown): string | undefined {
  if (typeof mod === 'string') return mod
  if (isRecord(mod) && typeof mod.src === 'string') return mod.src
  return undefined
}

L.Icon.Default.mergeOptions({
  iconRetinaUrl: assetUrl(markerIcon2x),
  iconUrl: assetUrl(markerIcon),
  shadowUrl: assetUrl(markerShadow),
})

function milesToMeters(mi: number) {
  return mi * 1609.344
}

const EPS = 1e-6
function nearlyEqual(a: number, b: number, eps = EPS) {
  return Math.abs(a - b) <= eps
}

function sameViewport(
  prev: { lat: number; lng: number; zoom: number } | null,
  next: { lat: number; lng: number; zoom: number },
) {
  if (!prev) return false
  return nearlyEqual(prev.lat, next.lat) && nearlyEqual(prev.lng, next.lng) && prev.zoom === next.zoom
}

function FixLeafletSize() {
  const map = useMap()
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 50)
    return () => window.clearTimeout(t)
  }, [map])
  return null
}

function ViewportReporter({ onViewportChange }: { onViewportChange?: (center: Coords, zoom: number) => void }) {
  const cbRef = useRef(onViewportChange)
  const lastRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null)
  const map = useMap()

  useEffect(() => {
    cbRef.current = onViewportChange
  }, [onViewportChange])

  const report = () => {
    const c = map.getCenter()
    const z = map.getZoom()
    const next = { lat: c.lat, lng: c.lng, zoom: z }
    if (sameViewport(lastRef.current, next)) return
    lastRef.current = next
    cbRef.current?.({ lat: next.lat, lng: next.lng }, next.zoom)
  }

  useMapEvents({
    moveend: report,
    zoomend: report,
  })

  useEffect(() => {
    report()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap()
  const lastAppliedRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null)

  useEffect(() => {
    const targetZoom = typeof zoom === 'number' ? zoom : map.getZoom()
    const cur = map.getCenter()
    const curZoom = map.getZoom()
    const next = { lat, lng, zoom: targetZoom }

    const already = nearlyEqual(cur.lat, lat) && nearlyEqual(cur.lng, lng) && curZoom === targetZoom
    if (already) return
    if (sameViewport(lastAppliedRef.current, next)) return

    lastAppliedRef.current = next
    map.setView([lat, lng], targetZoom, { animate: true })
  }, [lat, lng, zoom, map])

  return null
}

function FitToBounds({ fitBounds }: { fitBounds: Bounds | null | undefined }) {
  const map = useMap()
  const lastKeyRef = useRef<string>('')

  useEffect(() => {
    if (!fitBounds) return
    const key = `${fitBounds.south},${fitBounds.west},${fitBounds.north},${fitBounds.east}`
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key

    map.fitBounds(
      [
        [fitBounds.south, fitBounds.west],
        [fitBounds.north, fitBounds.east],
      ],
      { padding: [22, 22] },
    )
  }, [fitBounds, map])

  return null
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap()
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  })
  return null
}

function MapControls(props: { me: Coords | null; origin: Coords | null }) {
  const { me, origin } = props
  const map = useMap()

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[800] flex flex-col gap-2">
      <div className="pointer-events-auto tovis-glass-strong overflow-hidden rounded-2xl border border-white/12 bg-bgSecondary/80 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => map.zoomIn()}
          className="block w-11 px-0 py-2 text-center text-[16px] font-black text-textPrimary hover:bg-white/10"
          aria-label="Zoom in"
        >
          +
        </button>
        <div className="h-px bg-white/10" />
        <button
          type="button"
          onClick={() => map.zoomOut()}
          className="block w-11 px-0 py-2 text-center text-[16px] font-black text-textPrimary hover:bg-white/10"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {origin ? (
        <button
          type="button"
          onClick={() => map.setView([origin.lat, origin.lng], Math.max(map.getZoom(), 11), { animate: true })}
          className="pointer-events-auto tovis-glass-strong rounded-full border border-white/12 bg-bgSecondary/80 px-3 py-2 text-[12px] font-black text-textPrimary backdrop-blur-xl hover:bg-white/10"
        >
          Center
        </button>
      ) : null}

      {me ? (
        <button
          type="button"
          onClick={() => map.setView([me.lat, me.lng], Math.max(map.getZoom(), 12), { animate: true })}
          className="pointer-events-auto tovis-glass-strong rounded-full border border-white/12 bg-bgSecondary/80 px-3 py-2 text-[12px] font-black text-textPrimary backdrop-blur-xl hover:bg-white/10"
        >
          Me
        </button>
      ) : null}
    </div>
  )
}

/** Dependency-free “good enough” clustering for low zoom. */
function clusterStepForZoom(z: number) {
  if (z <= 8) return 0.2
  if (z <= 10) return 0.06
  if (z <= 11) return 0.03
  return 0
}

type RenderItem =
  | { kind: 'pin'; pin: Pin }
  | { kind: 'cluster'; id: string; lat: number; lng: number; count: number; sampleLabel: string }

function clusterPins(pins: Pin[], zoom: number): RenderItem[] {
  const step = clusterStepForZoom(zoom)
  if (!step) return pins.map((pin) => ({ kind: 'pin', pin }))

  const buckets = new Map<string, { latSum: number; lngSum: number; count: number; sampleLabel: string }>()
  for (const p of pins) {
    const bl = Math.round(p.lat / step) * step
    const bg = Math.round(p.lng / step) * step
    const key = `${bl.toFixed(4)}:${bg.toFixed(4)}`
    const cur = buckets.get(key)
    if (!cur) {
      buckets.set(key, { latSum: p.lat, lngSum: p.lng, count: 1, sampleLabel: p.label })
    } else {
      cur.latSum += p.lat
      cur.lngSum += p.lng
      cur.count += 1
    }
  }

  const out: RenderItem[] = []
  for (const [key, v] of buckets) {
    if (v.count === 1) {
      // find the original pin in that bucket to preserve active style
      const [latKey, lngKey] = key.split(':')
      const latK = Number(latKey)
      const lngK = Number(lngKey)
      const pin = pins.find((p) => Math.round(p.lat / step) * step === latK && Math.round(p.lng / step) * step === lngK)
      if (pin) out.push({ kind: 'pin', pin })
      continue
    }
    out.push({
      kind: 'cluster',
      id: `cluster:${key}`,
      lat: v.latSum / v.count,
      lng: v.lngSum / v.count,
      count: v.count,
      sampleLabel: v.sampleLabel,
    })
  }
  return out
}

function ClusterMarker(props: { lat: number; lng: number; count: number; sampleLabel: string }) {
  const { lat, lng, count, sampleLabel } = props
  const map = useMap()

  const icon = useMemo(() => {
    const size = count >= 50 ? 44 : count >= 20 ? 40 : 36
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width:${size}px; height:${size}px;
          border-radius:999px;
          display:flex; align-items:center; justify-content:center;
          background: rgb(var(--accent-primary));
          box-shadow: 0 16px 48px rgb(0 0 0 / 0.55), 0 0 0 3px rgb(255 255 255 / 0.18);
          color: rgb(var(--bg-primary));
          font-weight: 900;
          font-size: 13px;
        ">${count}</div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  }, [count])

  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      eventHandlers={{
        click: () => {
          const z = map.getZoom()
          map.setView([lat, lng], Math.min(14, z + 2), { animate: true })
        },
      }}
    >
      <Popup>
        <div className="text-[12px] font-semibold">
          <div className="text-[13px] font-black">{count} pros</div>
          <div className="mt-1 opacity-80">Zoom in to see individuals</div>
          <div className="mt-1 opacity-80">Example: {sampleLabel}</div>
        </div>
      </Popup>
    </Marker>
  )
}

export default function MapView({
  me,
  origin = null,
  pins,
  onSelectPin,
  radiusMiles = 15,
  onViewportChange,
  focus,
  fitBounds = null,
  enableClustering = true,
}: Props) {
  const hasOrigin = origin?.lat != null && origin?.lng != null
  const hasMe = me?.lat != null && me?.lng != null

  const center: [number, number] = useMemo(() => {
    if (hasOrigin) return [origin!.lat, origin!.lng]
    if (hasMe) return [me!.lat, me!.lng]
    if (pins.length) return [pins[0].lat, pins[0].lng]
    return [0, 0]
  }, [hasOrigin, origin, hasMe, me, pins])

  const baseZoom = hasOrigin ? 11 : hasMe ? 12 : pins.length ? 10 : 2
  const [zoom, setZoom] = useState(baseZoom)

  useEffect(() => {
    setZoom(baseZoom)
  }, [baseZoom])

  const circleCenter = hasOrigin ? origin! : hasMe ? me! : null

  const activeIcon = useMemo(() => {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 14px; height: 14px;
          border-radius: 999px;
          background: rgb(var(--accent-primary));
          box-shadow: 0 8px 22px rgb(0 0 0 / 0.55), 0 0 0 3px rgb(255 255 255 / 0.16);
        "></div>
      `,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
  }, [])

  const normalIcon = useMemo(() => {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 10px; height: 10px;
          border-radius: 999px;
          background: rgb(255 255 255 / 0.88);
          box-shadow: 0 10px 26px rgb(0 0 0 / 0.55), 0 0 0 2px rgb(255 255 255 / 0.10);
        "></div>
      `,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })
  }, [])

  const originIcon = useMemo(() => {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 12px; height: 12px;
          border-radius: 999px;
          background: rgb(255 255 255 / 0.92);
          box-shadow: 0 14px 40px rgb(0 0 0 / 0.60), 0 0 0 3px rgb(var(--accent-primary) / 0.45);
        "></div>
      `,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    })
  }, [])

  const items = useMemo(() => {
    return enableClustering ? clusterPins(pins, zoom) : pins.map((pin) => ({ kind: 'pin', pin } as const))
  }, [pins, zoom, enableClustering])

  return (
    <div className="tovis-glass relative h-full w-full overflow-hidden rounded-card border border-white/10">
      <MapContainer
        center={center}
        zoom={baseZoom}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <FixLeafletSize />
        <ViewportReporter onViewportChange={onViewportChange} />
        <FitToBounds fitBounds={fitBounds} />
        <ZoomTracker onZoom={(z) => setZoom((prev) => (prev === z ? prev : z))} />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <MapControls me={me} origin={origin} />

        {circleCenter ? (
          <Circle
            center={[circleCenter.lat, circleCenter.lng]}
            radius={milesToMeters(radiusMiles)}
            pathOptions={{ opacity: 0.65, fillOpacity: 0.08 }}
          />
        ) : null}

        {hasOrigin ? <Marker position={[origin!.lat, origin!.lng]} icon={originIcon} /> : null}

        {items.map((it) => {
          if (it.kind === 'cluster') {
            return (
              <ClusterMarker
                key={it.id}
                lat={it.lat}
                lng={it.lng}
                count={it.count}
                sampleLabel={it.sampleLabel}
              />
            )
          }

          const p = it.pin
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={p.active ? activeIcon : normalIcon}
              eventHandlers={{ click: () => onSelectPin(p.id) }}
            >
              <Popup>
                <div className="text-[12px] font-semibold">
                  <div className="text-[13px] font-black">{p.label}</div>
                  {p.sublabel ? <div className="mt-1 opacity-80">{p.sublabel}</div> : null}
                </div>
              </Popup>
            </Marker>
          )
        })}

        {focus ? <Recenter lat={focus.lat} lng={focus.lng} zoom={focus.zoom} /> : null}
      </MapContainer>
    </div>
  )
}