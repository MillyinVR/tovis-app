'use client'

import { useEffect, useMemo } from 'react'
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'

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

type Props = {
  me: Coords | null
  pins: Pin[]
  radiusMiles?: number

  onSelectPin: (id: string) => void

  // ✅ tells parent when user moved map (for “Search this area”)
  onViewportChange?: (center: Coords, zoom: number) => void

  // ✅ parent can force recentering (when selecting a list item)
  focus?: { lat: number; lng: number; zoom?: number } | null
}

// ✅ Fix Leaflet default marker icons in Next/Webpack
L.Icon.Default.mergeOptions({
  iconRetinaUrl: (markerIcon2x as unknown as string) ?? undefined,
  iconUrl: (markerIcon as unknown as string) ?? undefined,
  shadowUrl: (markerShadow as unknown as string) ?? undefined,
})

function milesToMeters(mi: number) {
  return mi * 1609.344
}

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap()

  useEffect(() => {
    const nextZoom = typeof zoom === 'number' ? zoom : map.getZoom()
    map.setView([lat, lng], nextZoom, { animate: true })
  }, [lat, lng, zoom, map])

  return null
}

function FixLeafletSize() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize()
    }, 50)
    return () => clearTimeout(t)
  }, [map])
  return null
}

function ViewportReporter({
  onViewportChange,
}: {
  onViewportChange?: (center: Coords, zoom: number) => void
}) {
  useMapEvents({
    moveend(e) {
      const m = e.target
      const c = m.getCenter()
      onViewportChange?.({ lat: c.lat, lng: c.lng }, m.getZoom())
    },
    zoomend(e) {
      const m = e.target
      const c = m.getCenter()
      onViewportChange?.({ lat: c.lat, lng: c.lng }, m.getZoom())
    },
  })
  return null
}

export default function MapView({
  me,
  pins,
  onSelectPin,
  radiusMiles = 15,
  onViewportChange,
  focus,
}: Props) {
  const hasMe = me?.lat != null && me?.lng != null

  const center: [number, number] = useMemo(() => {
    if (hasMe) return [me!.lat, me!.lng]
    if (pins.length) return [pins[0].lat, pins[0].lng]
    return [34.0522, -118.2437] // LA fallback
  }, [hasMe, me, pins])

  const activePin = useMemo(() => pins.find((p) => p.active) ?? null, [pins])

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

  return (
    <div className="tovis-glass h-full w-full overflow-hidden rounded-card border border-white/10">
      <div className="h-full w-full">
        <MapContainer
          center={center}
          zoom={hasMe ? 12 : 10}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <FixLeafletSize />
          <ViewportReporter onViewportChange={onViewportChange} />

          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Optional: user radius ring */}
          {hasMe ? (
            <Circle
              center={[me!.lat, me!.lng]}
              radius={milesToMeters(radiusMiles)}
              pathOptions={{ opacity: 0.65, fillOpacity: 0.08 }}
            />
          ) : null}

          {/* Pins */}
          {pins.map((p) => (
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
          ))}

          {/* Active pin recenter */}
          {activePin ? <Recenter lat={activePin.lat} lng={activePin.lng} /> : null}

          {/* Parent-driven focus (list click) */}
          {focus ? <Recenter lat={focus.lat} lng={focus.lng} zoom={focus.zoom} /> : null}
        </MapContainer>
      </div>
    </div>
  )
}
