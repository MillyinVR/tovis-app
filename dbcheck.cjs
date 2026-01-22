/**
 * dbcheck.cjs
 * Run: node .\dbcheck.cjs
 *
 * Prints:
 * - Which DB you're connected to (db/host/port/version)
 * - Professional locations for a given pro (id/type/isBookable/isPrimary/tz/workingHours)
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const PRO_ID = process.env.PRO_ID || "cmj4vhj620001tz0wkm6on714";

const prisma = new PrismaClient();

async function main() {
  console.log("ENV:");
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "(set)" : "(missing)");
  console.log("DIRECT_URL:", process.env.DIRECT_URL ? "(set)" : "(missing)");
  console.log("");

  console.log("DB INFO:");
  const dbInfo = await prisma.$queryRawUnsafe(
    "select current_database() as db, inet_server_addr() as host, inet_server_port() as port, version() as version"
  );
  console.dir(dbInfo, { depth: null });
  console.log("");

  console.log("LOCATIONS for pro:", PRO_ID);
  const locs = await prisma.professionalLocation.findMany({
    where: { professionalId: PRO_ID },
    select: {
      id: true,
      type: true,
      isBookable: true,
      isPrimary: true,
      timeZone: true,
      workingHours: true,
      bufferMinutes: true,
      stepMinutes: true,
      advanceNoticeMinutes: true,
      maxDaysAhead: true,
      createdAt: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  console.dir(locs, { depth: null });

  // Sanity check for "bad" ids
  const bad = locs.filter((l) => !String(l.id || "").trim());
  if (bad.length) {
    console.log("\n⚠️ Found location rows with missing/blank id:");
    console.dir(bad, { depth: null });
  } else {
    console.log("\n✅ All locations have valid ids.");
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
