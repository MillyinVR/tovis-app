import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = 'C:/Users/milly/Dev/tovis-app'

// change this to wherever your downloaded top-10k txt actually is
const inputPath = 'C:/Users/milly/Downloads/breached-passwords-10k.txt'

const outputPath = path.join(repoRoot, 'lib/data/breached-passwords-10k.json')

async function main() {
  const raw = await readFile(inputPath, 'utf8')

  const passwords = Array.from(
    new Set(
      raw
        .split(/\r?\n/g)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean),
    ),
  )

  if (passwords.length < 10_000) {
    throw new Error(
      `Expected at least 10,000 passwords, got ${passwords.length}. Check the source file.`,
    )
  }

  for (const required of ['password123', 'iloveyou123', 'qwerty12345']) {
    if (!passwords.includes(required)) {
      throw new Error(`Source file is missing required password: ${required}`)
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(passwords, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${outputPath}`)
  console.log(`Entries: ${passwords.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})