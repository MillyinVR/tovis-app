// app/pro/services/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import ServicePicker from './ServicePicker'
import OfferingManager from './OfferingManager'

export default async function ProServicesPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/services')
  }

  const profId = user.professionalProfile.id

  const categories = await prisma.serviceCategory.findMany({
    where: { isActive: true, parentId: null },
    include: {
      children: {
        where: { isActive: true },
        include: { services: { where: { isActive: true }, orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      },
      services: { where: { isActive: true }, orderBy: { name: 'asc' } },
    },
    orderBy: { name: 'asc' },
  })

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: profId, isActive: true },
    include: {
      service: { include: { category: true } },
    },
    orderBy: { service: { name: 'asc' } },
  })

  const categoryPayload = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    services: cat.services.map((s) => ({
      id: s.id,
      name: s.name,
      minPrice: moneyToString(s.minPrice) ?? '0.00',
      defaultDurationMinutes: s.defaultDurationMinutes,
    })),
    children: cat.children.map((child) => ({
      id: child.id,
      name: child.name,
      services: child.services.map((s) => ({
        id: s.id,
        name: s.name,
        minPrice: moneyToString(s.minPrice) ?? '0.00',
        defaultDurationMinutes: s.defaultDurationMinutes,
      })),
    })),
  }))

  const offeringsPayload = offerings.map((o) => ({
    id: o.id,
    serviceId: o.serviceId,
    title: o.title,
    description: o.description,
    price: moneyToString(o.price) ?? '0.00',
    durationMinutes: o.durationMinutes,
    customImageUrl: o.customImageUrl ?? null,
    defaultImageUrl: (o.service as any).defaultImageUrl ?? null, // avoids TS blowups if schema differs
    serviceName: o.service.name,
    categoryName: o.service.category?.name ?? null,
  }))

  return (
    <main style={{ maxWidth: 960, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>My services</h1>
          <p style={{ fontSize: 13, color: '#555' }}>
            Choose from the TOVIS service library, then customize time, price, and photo for your own menu.
            Only your version changes, not anyone else&apos;s.
          </p>
        </div>

        <a href="/pro" style={{ fontSize: 12, color: '#555', textDecoration: 'none', alignSelf: 'flex-start' }}>
          ← Back to pro dashboard
        </a>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Add a service to your menu</h2>
        <ServicePicker categories={categoryPayload} offerings={offeringsPayload} />
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Your current offerings</h2>

        {offeringsPayload.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            You haven&apos;t added any services yet. Use the flow above to add your first one.
          </p>
        ) : (
          <OfferingManager initialOfferings={offeringsPayload} />
        )}
      </section>
    </main>
  )
}
