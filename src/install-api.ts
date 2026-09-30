import type { OutputFile } from '@/types'

export type InstallMetadata = {
  appName: string
  bundleId: string
  version: string
}

export type LitterboxExpiry = '1h' | '12h' | '24h' | '72h'
export type UploadProvider = 'litterbox' | 'catbox'

export type TemporaryInstallResult = {
  ipaUrl: string
  manifestUrl: string
  installUrl: string
  manifestProvider: 'sylva' | 'palera'
}

export type UploadProgress = {
  loaded: number
  total: number
  percent: number
}

export const litterboxEndpoint = 'https://litterbox.catbox.moe/resources/internals/api.php'
export const litterboxHost = 'https://litter.catbox.moe/'
export const litterboxMaxFileSize = 1024 * 1024 * 1024
export const catboxEndpoint = 'https://catbox.moe/user/api.php'
export const catboxHost = 'https://files.catbox.moe/'
export const catboxMaxFileSize = 200 * 1024 * 1024
const paleraManifestEndpoint = 'https://api.palera.in/genPlist'
export const sylvaProxyBaseUrl = 'https://sylvacors.antonp29.dev'
export const sylvaProxyMaxFileSize = 100 * 1024 * 1024
// The Worker's limit includes the multipart envelope, not only the IPA bytes.
const multipartSizeAllowance = 64 * 1024

type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void
  onProgressReset?: () => void
  onLog?: (message: string) => void
  signal?: AbortSignal
}

type UploadResponse = { ok: boolean; status: number; text: string }

class UploadCancelledError extends Error {}
class UploadTimeoutError extends Error {}

const uploadIdleTimeoutMs = 120 * 1000
const uploadTimeoutMs = 15 * 60 * 1000

async function fetchWithDeadline(endpoint: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  try {
    const response = await fetch(endpoint, { ...init, signal: controller.signal })
    return { response, text: await response.text() }
  } catch (error) {
    if (init.signal?.aborted) throw new UploadCancelledError('The upload was cancelled.')
    if (controller.signal.aborted) throw new UploadTimeoutError('The request timed out. Retry or download the signed IPA locally.')
    throw error
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}

function isAppleMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function uploadFormWithXhr(
  form: FormData,
  endpoint: string,
  options: {
    errorMessage: string
    onProgress?: (progress: UploadProgress) => void
    attachProgress?: boolean
    signal?: AbortSignal
  },
) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const request = new XMLHttpRequest()
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const abort = () => request.abort()
    const cleanup = () => {
      clearTimeout(idleTimer)
      options.signal?.removeEventListener('abort', abort)
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { timedOut = true; request.abort() }, uploadIdleTimeoutMs)
    }
    request.onload = () => {
      cleanup()
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        text: request.responseText.trim(),
      })
    }
    request.onerror = () => {
      fail(new Error(options.errorMessage))
    }
    request.onabort = () => fail(timedOut
      ? new UploadTimeoutError('The upload stopped responding. Retry or download the signed IPA locally.')
      : new UploadCancelledError('The upload was cancelled.'))
    request.ontimeout = () => fail(new UploadTimeoutError('The upload timed out. Retry or download the signed IPA locally.'))
    // Register before open(): WebKit can miss upload events when registered later.
    if (options.attachProgress) {
      request.upload.onprogress = (event) => {
        resetIdleTimer()
        if (!event.lengthComputable) return
        options.onProgress?.({
          loaded: event.loaded,
          total: event.total,
          percent: event.loaded >= event.total ? 100 : Math.min(99, Math.round((event.loaded / event.total) * 100)),
        })
      }
    }
    request.open('POST', endpoint)
    request.timeout = options.attachProgress ? uploadTimeoutMs : 5 * 60 * 1000
    if (options.signal?.aborted) {
      fail(new UploadCancelledError('The upload was cancelled.'))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.attachProgress) resetIdleTimer()
    try { request.send(form) } catch (error) {
      fail(error instanceof Error ? error : new Error(options.errorMessage))
    }
  })
}

async function uploadFormWithFetch(form: FormData, endpoint: string, signal?: AbortSignal) {
  const { response, text } = await fetchWithDeadline(endpoint, {
    method: 'POST',
    body: form,
    signal,
  }, 5 * 60 * 1000)
  return {
    ok: response.ok,
    status: response.status,
    text: text.trim(),
  }
}

async function uploadSignedIpaForm(
  form: FormData,
  outputSize: number,
  provider: UploadProvider,
  options: UploadOptions,
): Promise<UploadResponse> {
  const appleMobile = isAppleMobileBrowser()
  const hostName = provider === 'catbox' ? 'Catbox' : 'Litterbox'
  const endpoint = provider === 'catbox' ? catboxEndpoint : litterboxEndpoint

  if (outputSize <= sylvaProxyMaxFileSize - multipartSizeAllowance) {
    try {
      const response = await uploadFormWithXhr(form, `${sylvaProxyBaseUrl}/${provider}`, {
        // The Sylva Worker supports preflight; measure progress on mobile too.
        attachProgress: true,
        onProgress: options.onProgress,
        signal: options.signal,
        errorMessage: `Could not reach the Sylva ${hostName} upload proxy.`,
      })
      const canRetryDirect = response.status === 0 || response.status === 404 ||
        response.status === 413 || response.status === 429 || response.status >= 500
      if (!canRetryDirect) return response
    } catch (error) {
      if (error instanceof UploadCancelledError || options.signal?.aborted) throw error
      // Network/CORS failures can still succeed through the host's direct API.
    }
    options.onProgressReset?.()
    options.onLog?.(`Sylva proxy unavailable; trying the direct ${hostName} upload API.`)
  }

  // No upload listeners or custom headers: both hosts need a simple multipart POST.
  return appleMobile
    ? uploadFormWithXhr(form, endpoint, {
        signal: options.signal,
        errorMessage: `Could not reach ${hostName}. Check the network or content blockers and retry, or download the signed IPA locally.`,
      })
    : uploadFormWithFetch(form, endpoint, options.signal)
}

export async function uploadSignedIpaToLitterbox(
  output: OutputFile,
  expiry: LitterboxExpiry = '1h',
  options: UploadOptions = {},
) {
  const outputSize = output.data instanceof Blob ? output.data.size : output.data.byteLength
  if (outputSize > litterboxMaxFileSize) {
    throw new Error('Litterbox accepts files up to 1 GB. Choose a smaller signed IPA.')
  }

  const blob = output.data instanceof Blob
    ? output.data
    : new Blob([output.data], { type: output.type || 'application/octet-stream' })
  const fileName = output.name.toLowerCase().endsWith('.ipa')
    ? output.name
    : `${output.name}.ipa`

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', expiry)
  form.append('fileToUpload', blob, fileName)

  const response = await uploadSignedIpaForm(form, outputSize, 'litterbox', options)

  if (!response.ok) {
    throw new Error(`Litterbox upload failed with HTTP ${response.status}.${response.text ? ` ${response.text.slice(0, 300)}` : ''}`)
  }

  if (!response.text.startsWith(litterboxHost)) {
    throw new Error(response.text || 'Litterbox did not return a temporary file URL.')
  }

  return response.text
}

export async function uploadSignedIpaToCatbox(
  output: OutputFile,
  options: UploadOptions = {},
) {
  const outputSize = output.data instanceof Blob ? output.data.size : output.data.byteLength
  if (outputSize > catboxMaxFileSize) {
    throw new Error('Catbox accepts files up to 200 MB. Disable backup to use Litterbox (up to 1 GB) or choose a smaller signed IPA.')
  }

  const blob = output.data instanceof Blob
    ? output.data
    : new Blob([output.data], { type: output.type || 'application/octet-stream' })
  const fileName = output.name.toLowerCase().endsWith('.ipa')
    ? output.name
    : `${output.name}.ipa`

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', blob, fileName)

  const response = await uploadSignedIpaForm(form, outputSize, 'catbox', options)

  if (!response.ok) {
    throw new Error(`Catbox upload failed with HTTP ${response.status}.${response.text ? ` ${response.text.slice(0, 300)}` : ''}`)
  }

  if (!response.text.startsWith(catboxHost)) {
    throw new Error(response.text || 'Catbox did not return a permanent file URL.')
  }

  return response.text
}

export function buildPaleraInstallUrls(
  metadata: InstallMetadata,
  ipaUrl: string,
): TemporaryInstallResult {
  const manifest = new URL(paleraManifestEndpoint)
  manifest.searchParams.set('bundleid', metadata.bundleId)
  manifest.searchParams.set('name', metadata.appName)
  manifest.searchParams.set('version', metadata.version)
  manifest.searchParams.set('fetchurl', ipaUrl)

  const manifestUrl = manifest.toString()

  return {
    ipaUrl,
    manifestUrl,
    manifestProvider: 'palera',
    installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(
      manifestUrl,
    )}`,
  }
}

export function buildSylvaInstallUrls(
  metadata: InstallMetadata,
  ipaUrl: string,
): TemporaryInstallResult {
  const manifest = new URL(`${sylvaProxyBaseUrl}/manifest`)
  manifest.searchParams.set('bundleid', metadata.bundleId)
  manifest.searchParams.set('name', metadata.appName)
  manifest.searchParams.set('version', metadata.version)
  manifest.searchParams.set('fetchurl', ipaUrl)

  const manifestUrl = manifest.toString()

  return {
    ipaUrl,
    manifestUrl,
    manifestProvider: 'sylva',
    installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(
      manifestUrl,
    )}`,
  }
}

export async function createInstallUrls(
  metadata: InstallMetadata,
  ipaUrl: string,
  signal?: AbortSignal,
): Promise<TemporaryInstallResult> {
  const paleraResult = buildPaleraInstallUrls(metadata, ipaUrl)

  try {
    const { response } = await fetchWithDeadline(paleraResult.manifestUrl, {
      cache: 'no-store',
      mode: 'no-cors',
      signal,
    }, 15 * 1000)
    if (response.type !== 'opaque' && !response.ok) {
      throw new Error(`Palera manifest endpoint returned HTTP ${response.status}.`)
    }
    return paleraResult
  } catch {
    if (signal?.aborted) throw new UploadCancelledError('The upload was cancelled.')
    const sylvaResult = buildSylvaInstallUrls(metadata, ipaUrl)
    const { response } = await fetchWithDeadline(sylvaResult.manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'text/xml,application/xml' },
      signal,
    }, 15 * 1000)
    const contentType = response.headers.get('Content-Type')?.toLowerCase() || ''
    if (!response.ok || !contentType.includes('xml')) {
      throw new Error(`Sylva manifest endpoint returned HTTP ${response.status}.`)
    }
    return sylvaResult
  }
}
