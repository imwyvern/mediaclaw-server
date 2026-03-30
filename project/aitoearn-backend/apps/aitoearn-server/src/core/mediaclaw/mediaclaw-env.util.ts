export function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (value) {
    return value
  }

  if (process.env['NODE_ENV'] === 'test') {
    return `test-${name.toLowerCase()}`
  }

  throw new Error(`Missing required environment variable: ${name}`)
}
