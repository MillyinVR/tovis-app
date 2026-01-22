require("dotenv").config();
const { zonedTimeToUtc, getZonedParts } = require("./lib/timeZone");

const tz = "America/Los_Angeles";

const d = zonedTimeToUtc({ year: 2026, month: 1, day: 22, hour: 0, minute: 0, second: 0, timeZone: tz });
console.log("zonedTimeToUtc LA 2026-01-22 00:00 =>", d.toISOString());

const parts = getZonedParts(d, tz);
console.log("back to parts =>", parts);
