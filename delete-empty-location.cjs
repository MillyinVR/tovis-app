require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();

(async () => {
  const r = await p.professionalLocation.deleteMany({ where: { id: "" } });
  console.log("deleteMany result:", r);

  const left = await p.professionalLocation.findMany({ where: { id: "" } });
  console.log("remaining rows with id='':", left);

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await p.$disconnect(); } catch {}
  process.exit(1);
});
