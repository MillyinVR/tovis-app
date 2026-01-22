require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const p = new PrismaClient();

  const professionalId = "cmj4vhj620001tz0wkm6on714";
  const mobileLocationId = "cmkbytig80001tz7g29k9abwm";

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [blocks, holds, bookings] = await Promise.all([
    p.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: in30 },
        endsAt: { gt: now },
        OR: [{ locationId: null }, { locationId: mobileLocationId }],
      },
      select: { id: true, startsAt: true, endsAt: true, locationId: true },
      orderBy: { startsAt: "asc" },
      take: 200,
    }),
    p.bookingHold.findMany({
      where: {
        professionalId,
        locationType: "MOBILE",
        locationId: mobileLocationId,
        scheduledFor: { gte: now, lt: in30 },
        expiresAt: { gt: now },
      },
      select: { id: true, scheduledFor: true, expiresAt: true, locationType: true, locationId: true },
      orderBy: { scheduledFor: "asc" },
      take: 200,
    }),
    p.booking.findMany({
      where: {
        professionalId,
        locationType: "MOBILE",
        locationId: mobileLocationId,
        scheduledFor: { gte: now, lt: in30 },
        NOT: { status: "CANCELLED" },
      },
      select: { id: true, scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
      orderBy: { scheduledFor: "asc" },
      take: 200,
    }),
  ]);

  console.log("BLOCKS (locationId null blocks ALL locations):");
  console.dir(blocks, { depth: null });

  console.log("\nHOLDS:");
  console.dir(holds, { depth: null });

  console.log("\nBOOKINGS:");
  console.dir(bookings, { depth: null });

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
