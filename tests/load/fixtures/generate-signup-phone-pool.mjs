import { writeFileSync } from 'node:fs'

const areaCode = process.argv[2] ?? '202'
const count = Number.parseInt(process.argv[3] ?? '100', 10)

if (!/^\d{3}$/.test(areaCode)) {
  throw new Error('areaCode must be a 3-digit US area code, for example 202')
}

if (!Number.isInteger(count) || count <= 0 || count > 100) {
  throw new Error('count must be a positive integer up to 100')
}

const lines = Array.from({ length: count }, (_, index) => {
  const lastTwo = String(index).padStart(2, '0')
  return `+1${areaCode}55501${lastTwo}`
})

writeFileSync(
  'tests/load/fixtures/signup-phone-pool.txt',
  `${lines.join('\n')}\n`,
)