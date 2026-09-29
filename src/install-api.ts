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
  },
) {
  return new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', endpoint)
    request.onload = () => {
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        text: request.responseText.trim(),
      })
    }
    request.onerror = () => {
      reject(new Error(options.errorMessage))
    }
    request.onabort = () => reject(new Error('The upload was cancelled.'))
    if (options.attachProgress && options.onProgress) {
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        options.onProgress?.({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      }
    }
    request.send(form)
  })
}

async function uploadFormWithFetch(form: FormData, endpoint: string = litterboxEndpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
  })
  return {
    ok: response.ok,
    status: response.status,
    text: (await response.text()).trim(),
  }
}

export async function uploadSignedIpaToLitterbox(
  output: OutputFile,
  expiry: LitterboxExpiry = '1h',
  options: { onProgress?: (progress: UploadProgress) => void } = {},
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

  const response = outputSize <= sylvaProxyMaxFileSize
    ? await uploadFormWithXhr(form, `${sylvaProxyBaseUrl}/litterbox`, {
        attachProgress: true,
        onProgress: options.onProgress,
        errorMessage: 'Sylva upload proxy could not connect to Litterbox. Retry, or download the signed IPA locally.',
      })
    : isAppleMobileBrowser()
      ? await uploadFormWithXhr(form, litterboxEndpoint, {
          errorMessage:
            'Mobile Safari could not connect to Litterbox. Check content blockers, Private Relay, or the current network and retry.',
        })
      : await uploadFormWithFetch(form, litterboxEndpoint)

  if (!response.ok) {
    throw new Error(`Litterbox upload failed with HTTP ${response.status}.`)
  }

  if (!response.text.startsWith(litterboxHost)) {
    throw new Error(response.text || 'Litterbox did not return a temporary file URL.')
  }

  return response.text
}

export async function uploadSignedIpaToCatbox(
  output: OutputFile,
  options: { onProgress?: (progress: UploadProgress) => void } = {},
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

  let response: { ok: boolean; status: number; text: string }

  if (outputSize <= sylvaProxyMaxFileSize) {
    try {
      response = await uploadFormWithXhr(form, `${sylvaProxyBaseUrl}/catbox`, {
        attachProgress: true,
        onProgress: options.onProgress,
        errorMessage: 'Sylva upload proxy could not connect to Catbox. Retry, or download the signed IPA locally.',
      })
      if (!response.ok && response.status === 404) {
        throw new Error('Proxy 404')
      }
    } catch {
      response = isAppleMobileBrowser()
        ? await uploadFormWithXhr(form, catboxEndpoint, {
            errorMessage:
              'Mobile Safari could not connect to Catbox. Check content blockers, Private Relay, or the current network and retry.',
          })
        : await uploadFormWithFetch(form, catboxEndpoint)
    }
  } else {
    response = isAppleMobileBrowser()
      ? await uploadFormWithXhr(form, catboxEndpoint, {
          errorMessage:
            'Mobile Safari could not connect to Catbox. Check content blockers, Private Relay, or the current network and retry.',
        })
      : await uploadFormWithFetch(form, catboxEndpoint)
  }

  if (!response.ok) {
    throw new Error(`Catbox upload failed with HTTP ${response.status}.`)
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
): Promise<TemporaryInstallResult> {
  const paleraResult = buildPaleraInstallUrls(metadata, ipaUrl)

  try {
    const response = await fetch(paleraResult.manifestUrl, {
      cache: 'no-store',
      mode: 'no-cors',
    })
    if (response.type !== 'opaque' && !response.ok) {
      throw new Error(`Palera manifest endpoint returned HTTP ${response.status}.`)
    }
    return paleraResult
  } catch {
    const sylvaResult = buildSylvaInstallUrls(metadata, ipaUrl)
    const response = await fetch(sylvaResult.manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'text/xml,application/xml' },
    })
    const contentType = response.headers.get('Content-Type')?.toLowerCase() || ''
    if (!response.ok || !contentType.includes('xml')) {
      throw new Error(`Sylva manifest endpoint returned HTTP ${response.status}.`)
    }
    return sylvaResult
  }
}
