function readArg(prefix) {
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
}

function readSecret() {
  const value =
    process.env.INTERNAL_JOB_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ''

  return value.length > 0 ? value : null
}

async function main() {
  const baseUrl =
    readArg('--url=') ||
    process.env.LOCAL_APP_URL?.trim() ||
    'http://localhost:3000'

  const takeArg = readArg('--take=')
  const take =
    takeArg === undefined ? undefined : Number.parseInt(takeArg, 10)

  if (
    takeArg !== undefined &&
    (!Number.isFinite(take) || take < 1)
  ) {
    throw new Error('--take must be a positive integer.')
  }

  const secret = readSecret()
  if (!secret) {
    throw new Error(
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET for local LooksSocial job processing.',
    )
  }

  const url = new URL('/api/internal/jobs/looks-social/process', baseUrl)

  if (take !== undefined) {
    url.searchParams.set('take', String(take))
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-internal-job-secret': secret,
    },
  })

  const text = await response.text()

  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  const failed =
    !response.ok ||
    (body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      body.ok === false)

  const output = {
    status: response.status,
    url: url.toString(),
    body,
  }

  if (failed) {
    console.error(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'Unknown error'

  console.error(message)
  process.exit(1)
})