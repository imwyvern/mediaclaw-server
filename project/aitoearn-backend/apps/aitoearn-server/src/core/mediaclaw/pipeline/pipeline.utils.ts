import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { get as httpGet, request as httpRequest } from 'node:http'
import { get as httpsGet, request as httpsRequest } from 'node:https'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

interface CommandResult {
  stdout: string
  stderr: string
}

interface JsonRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true })
}

export async function ensureParentDirectory(path: string) {
  await ensureDirectory(dirname(path))
}

export async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
}

export async function fileSize(path: string) {
  const fileStat = await stat(path)
  return fileStat.size
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            settled = true
            child.kill('SIGKILL')
            reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
          }
        }, options.timeoutMs)
      : null

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout)
      }
      if (settled) {
        return
      }
      settled = true
      reject(error)
    })

    child.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout)
      }
      if (settled) {
        return
      }
      if (code !== 0) {
        settled = true
        reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr}`))
        return
      }

      settled = true
      resolve({ stdout, stderr })
    })
  })
}

export async function requestJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: options.method || 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          const statusCode = response.statusCode || 0
          const bodyText = Buffer.concat(chunks).toString()
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${bodyText || target.toString()}`))
            return
          }

          try {
            resolve(JSON.parse(bodyText) as T)
          }
          catch (error) {
            reject(error)
          }
        })
      },
    )

    if (options.timeoutMs) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error(`Request timed out: ${url}`))
      })
    }

    request.on('error', reject)
    if (options.body) {
      request.write(options.body)
    }
    request.end()
  })
}

export async function downloadFile(url: string, outputPath: string, redirects = 0): Promise<void> {
  if (redirects > 5) {
    throw new Error(`Too many redirects while downloading ${url}`)
  }

  await ensureParentDirectory(outputPath)

  await new Promise<void>((resolve, reject) => {
    const client = url.startsWith('https://') ? httpsGet : httpGet
    const request = client(url, (response) => {
      const statusCode = response.statusCode || 0
      if ([301, 302, 307, 308].includes(statusCode)) {
        const location = response.headers.location
        response.resume()
        if (!location) {
          reject(new Error(`Redirect response missing location: ${url}`))
          return
        }
        downloadFile(new URL(location, url).toString(), outputPath, redirects + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`Download failed with status ${statusCode}: ${url}`))
        return
      }

      const fileStream = createWriteStream(outputPath)
      response.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close()
        resolve()
      })

      fileStream.on('error', async (error) => {
        fileStream.close()
        await unlink(outputPath).catch(() => undefined)
        reject(error)
      })
    })

    request.on('error', async (error) => {
      await unlink(outputPath).catch(() => undefined)
      reject(error)
    })
  })
}

export function resolveRenderSize(aspectRatio: string | undefined, resolution?: string) {
  const normalizedAspectRatio = aspectRatio?.trim() || '9:16'
  const normalizedResolution = resolution?.trim()

  if (normalizedResolution) {
    const match = normalizedResolution.match(/^(\d{2,5})x(\d{2,5})$/i)
    if (match) {
      return {
        width: Number(match[1]),
        height: Number(match[2]),
      }
    }
  }

  switch (normalizedAspectRatio) {
    case '16:9':
      return { width: 1920, height: 1080 }
    case '1:1':
      return { width: 1080, height: 1080 }
    case '4:5':
      return { width: 1080, height: 1350 }
    case '9:16':
    default:
      return { width: 1080, height: 1920 }
  }
}

export function buildPublicFileUrl(filePath: string) {
  const baseUrl = process.env['MEDIACLAW_PIPELINE_PUBLIC_BASE_URL']?.trim()
  if (!baseUrl) {
    return `file://${filePath}`
  }

  return `${baseUrl.replace(/\/+$/, '')}/${filePath.split('/').pop() || ''}`
}

export function hashToRange(seed: string, min: number, max: number, precision = 4) {
  let hash = 0
  for (const char of seed) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  }

  const normalized = (Math.abs(hash) % 10000) / 10000
  const value = min + normalized * (max - min)
  return Number(value.toFixed(precision))
}

export function escapeDrawtext(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
}

export function normalizeHexColor(value: string | undefined, fallback: string) {
  const normalized = value?.trim()
  if (!normalized) {
    return fallback
  }

  if (/^#?[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.startsWith('#') ? normalized : `#${normalized}`
  }

  return fallback
}
