require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function addDaysToYMD(year, month, day, daysToAdd) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Minimal “local midnight” converter using Intl (no deps)
function zonedTimeToUtc({ year, month, day, hour, minute, timeZone }) {
  // initial guess
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  // refine offset a few times
  for (let i = 0; i < 4; i++) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(guess).reduce((m, p) => (m[p.type] = p.value, m), {});
    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offsetMs = asIfUtc - guess.getTime();
    const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMs);
    if (Math.abs(corrected.getTime() - guess.getTime()) < 500) return corrected;
    guess = corrected;
  }
  return guess;
}

function formatInTz(d, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

(async () => {
  const professionalId = process.env.PRO_ID || "cmj4vhj620001tz0wkm6on714";
  const date = process.env.DATE || "2026-01-22";
  const timeZone = process.env.TZ || "America/Los_Angeles";

  const [y, m, d] = date.split("-").map(Number);
  const dayStartUtc = zonedTimeToUtc({ year: y, month: m, day: d, hour: 0, minute: 0, timeZone });
  const next = addDaysToYMD(y, m, d, 1);
  const dayEndExclusiveUtc = zonedTimeToUtc({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0, timeZone });

  console.log("PRO:", professionalId);
  console.log("TZ:", timeZone);
  console.log("DAY START UTC:", dayStartUtc.toISOString(), "=>", formatInTz(dayStartUtc, timeZone));
  console.log("DAY END   UTC:", dayEndExclusiveUtc.toISOString(), "=>", formatInTz(dayEndExclusiveUtc, timeZone));

  const bookings = await p.booking.findMany({
    where: {
      professionalId,
      scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
      NOT: { status: "CANCELLED" },
    },
    select: {
      id: true,
      status: true,
      locationType: true,
      locationId: true,
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
      createdAt: true,
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  console.log("\nBOOKINGS IN THIS DAY WINDOW:", bookings.length);
  for (const b of bookings) {
    console.log({
      id: b.id,
      status: b.status,
      locationType: b.locationType,
      locationId: b.locationId,
      scheduledForUtc: b.scheduledFor.toISOString(),
      scheduledForLocal: formatInTz(new Date(b.scheduledFor), timeZone),
      totalDurationMinutes: b.totalDurationMinutes,
      bufferMinutes: b.bufferMinutes,
    });
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
