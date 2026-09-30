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

export type UploadTransfer = {
  transport: 'proxy' | 'direct'
  attempt: 1 | 2
  timeoutMs: number
}

export const litterboxEndpoint = 'https://litterbox.catbox.moe/resources/internals/api.php'
export const litterboxHost = 'https://litter.catbox.moe/'
export const litterboxMaxFileSize = 1024 * 1024 * 1024
export const catboxEndpoint = 'https://catbox.moe/user/api.php'
export const catboxHost = 'https://files.catbox.moe/'
const paleraManifestEndpoint = 'https://api.palera.in/genPlist'
export const sylvaProxyBaseUrl = 'https://sylvacors.antonp29.dev'
export const sylvaProxyRetryBaseUrl = 'https://sylva-worker.antonp29.workers.dev'
export const sylvaProxyMaxFileSize = 100 * 1024 * 1024
// The Worker's limit includes the multipart envelope, not only the IPA bytes.
const multipartSizeAllowance = 64 * 1024
export const catboxMaxFileSize = sylvaProxyMaxFileSize - multipartSizeAllowance
const catboxSizeError = 'Sylva limits Catbox uploads to 100 MB including upload overhead. Disable backup to use Litterbox (up to 1 GB) or choose a smaller signed IPA.'

type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void
  onProgressReset?: () => void
  onLog?: (message: string) => void
  onTransfer?: (transfer: UploadTransfer) => void
  signal?: AbortSignal
}

type UploadResponse = { ok: boolean; status: number; text: string }

class UploadCancelledError extends Error {}
class UploadTimeoutError extends Error {}

const uploadIdleTimeoutMs = 120 * 1000
const uploadTimeoutMs = 15 * 60 * 1000
const directUploadTimeoutMs = 5 * 60 * 1000

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
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const cleanup = () => {
      clearTimeout(idleTimer)
      clearTimeout(deadlineTimer)
      options.signal?.removeEventListener('abort', abort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    // Settle before aborting: WebKit need not dispatch another event for a
    // stalled request. The JS deadline must not depend on XHR timeout/abort events.
    const stop = (error: Error) => { fail(error); request.abort() }
    const abort = () => stop(new UploadCancelledError('The upload was cancelled.'))
    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => stop(new UploadTimeoutError('The upload stopped responding. Retry or download the signed IPA locally.')), uploadIdleTimeoutMs)
    }
    request.onload = () => {
      if (settled) return
      settled = true
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
    request.onabort = () => fail(new UploadCancelledError('The upload was cancelled.'))
    request.ontimeout = () => fail(new UploadTimeoutError('The upload timed out. Retry or download the signed IPA locally.'))
    // Register before open(): WebKit can miss upload events when registered later.
    if (options.attachProgress) {
      request.upload.onprogress = (event) => {
        if (settled) return
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
    const timeoutMs = options.attachProgress ? uploadTimeoutMs : directUploadTimeoutMs
    request.timeout = timeoutMs
    if (options.signal?.aborted) {
      fail(new UploadCancelledError('The upload was cancelled.'))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    deadlineTimer = setTimeout(() => stop(new UploadTimeoutError('The upload timed out. Retry or download the signed IPA locally.')), timeoutMs)
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
  }, directUploadTimeoutMs)
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
    const proxyBases = [sylvaProxyBaseUrl, sylvaProxyRetryBaseUrl]
    for (const [index, baseUrl] of proxyBases.entries()) {
      const lastAttempt = index === proxyBases.length - 1
      options.onTransfer?.({ transport: 'proxy', attempt: index === 0 ? 1 : 2, timeoutMs: uploadTimeoutMs })
      try {
        const response = await uploadFormWithXhr(form, `${baseUrl}/${provider}`, {
          attachProgress: true,
          onProgress: options.onProgress,
          signal: options.signal,
          errorMessage: `Could not reach the Sylva ${hostName} upload proxy.`,
        })
        const retryable = response.status === 0 || response.status === 404 ||
          response.status === 413 || response.status === 429 || response.status >= 500
        if (!retryable || lastAttempt) return response
      } catch (error) {
        if (lastAttempt || error instanceof UploadCancelledError || options.signal?.aborted) throw error
      }
      options.onProgressReset?.()
      options.onLog?.(`Retrying ${hostName} upload through Sylva's alternate Worker hostname.`)
    }
    throw new Error(`The Sylva ${hostName} upload proxy is unavailable.`)
  }

  // Catbox responses require the CORS-enabled Worker; never send them directly.
  if (provider === 'catbox') throw new Error(catboxSizeError)
  options.onTransfer?.({ transport: 'direct', attempt: 1, timeoutMs: directUploadTimeoutMs })
  // No upload listeners or custom headers: keep the direct Litterbox POST simple.
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
    throw new Error(catboxSizeError)
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
