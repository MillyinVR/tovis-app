require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const professionalId = process.env.PRO_ID || "cmj4vhj620001tz0wkm6on714";
  console.log("WIPING test data for pro:", professionalId);

  // grab bookings
  const bookingsList = await prisma.booking.findMany({
    where: { professionalId },
    select: { id: true },
    take: 5000,
  });
  const bookingIds = bookingsList.map(b => b.id);
  console.log("Bookings found:", bookingIds.length);

  // delete booking children first (fixes your FK error)
  if (bookingIds.length) {
    const aftercare = await prisma.aftercareSummary.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });
    console.log("Deleted AftercareSummary:", aftercare.count);
  }

  // then delete the rest
  const holds = await prisma.bookingHold.deleteMany({ where: { professionalId } });
  console.log("Deleted booking holds:", holds.count);

  const blocks = await prisma.calendarBlock.deleteMany({ where: { professionalId } });
  console.log("Deleted calendar blocks:", blocks.count);

  const bookings = await prisma.booking.deleteMany({ where: { professionalId } });
  console.log("Deleted bookings:", bookings.count);

  await prisma.$disconnect();
  console.log("✅ Done.");
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
