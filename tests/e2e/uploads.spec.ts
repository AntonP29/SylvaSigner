import { devices, expect, test, webkit } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import {
  catboxEndpoint,
  catboxHost,
  catboxMaxFileSize,
  createInstallUrls,
  litterboxEndpoint,
  litterboxHost,
  sylvaProxyBaseUrl,
  sylvaProxyRetryBaseUrl,
  sylvaProxyMaxFileSize,
  uploadSignedIpaToCatbox,
  uploadSignedIpaToLitterbox,
} from '../../src/install-api'
import type { OutputFile } from '../../src/types'

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest')
const originalFetch = globalThis.fetch

type Outcome = number | 'network' | 'abort' | 'timeout' | 'pending'
let outcome: Outcome
let directOutcome: Outcome
let retryOutcome: Outcome
let silentAbort: boolean
let pendingSent: boolean
let requests: Array<{ url: string; form: FormData; progress: boolean }>

test.beforeEach(() => {
  outcome = 200
  directOutcome = 200
  retryOutcome = 200
  silentAbort = false
  pendingSent = false
  requests = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)', maxTouchPoints: 5 },
  })
  class FakeXhr {
    status = 200
    responseText = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    ontimeout: (() => void) | null = null
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    url = ''
    abort() { if (!silentAbort) this.onabort?.() }
    open(method: string, url: string) {
      expect(method).toBe('POST')
      this.url = url
    }
    send(form: FormData) {
      requests.push({ url: this.url, form, progress: Boolean(this.upload.onprogress) })
      const result = this.url.startsWith(sylvaProxyBaseUrl) ? outcome : this.url.startsWith(sylvaProxyRetryBaseUrl) ? retryOutcome : directOutcome
      queueMicrotask(() => {
        if (result === 'network') return this.onerror?.()
        if (result === 'abort') return this.onabort?.()
        if (result === 'timeout') return this.ontimeout?.()
        if (result === 'pending') {
          if (pendingSent) this.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 } as ProgressEvent)
          return
        }
        this.status = result
        this.responseText = result === 200
          ? `${this.url.includes('litterbox') ? litterboxHost : catboxHost}test.ipa\n`
          : 'Upload rejected'
        this.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 } as ProgressEvent)
        this.onload?.()
      })
    }
  }
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FakeXhr })
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, form: init?.body as FormData, progress: false })
    return new Response(`${url === litterboxEndpoint ? litterboxHost : catboxHost}test.ipa`)
  }
})

test.afterEach(() => {
  for (const [name, descriptor] of [['navigator', navigatorDescriptor], ['XMLHttpRequest', xhrDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  globalThis.fetch = originalFetch
})

const output: OutputFile = {
  path: '/output/test', name: 'test', type: 'application/zip', data: new Blob(['test']),
}

for (const provider of ['litterbox', 'catbox'] as const) {
  const endpoint = provider === 'catbox' ? catboxEndpoint : litterboxEndpoint
  const host = provider === 'catbox' ? catboxHost : litterboxHost
  const retryEndpoint = `${sylvaProxyRetryBaseUrl}/${provider}`
  const upload = (file = output, options = {}) => provider === 'catbox'
    ? uploadSignedIpaToCatbox(file, options)
    : uploadSignedIpaToLitterbox(file, '12h', options)

  test(`${provider}: Safari uploads report proxy progress`, async () => {
    let percent = 0
    await expect(upload(output, { onProgress: (progress: { percent: number }) => { percent = progress.percent } })).resolves.toBe(`${host}test.ipa`)
    expect(requests).toHaveLength(1)
    expect(requests[0].progress).toBe(true)
    expect(percent).toBe(100)
  })

  test(`${provider}: iPad desktop user agent also receives progress`, async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 },
    })
    await upload(output, { onProgress: () => {} })
    expect(requests[0].progress).toBe(true)
  })

  for (const failure of ['network', 'timeout', 0, 404, 413, 429, 502] as const) {
    test(`${provider}: retries proxy ${failure} with measured progress and intact multipart fields`, async () => {
      outcome = failure
      let resets = 0
      await expect(upload(output, { onProgress: () => {}, onProgressReset: () => resets++ })).resolves.toBe(`${host}test.ipa`)
      expect(requests.map(request => request.url)).toEqual([`${sylvaProxyBaseUrl}/${provider}`, retryEndpoint])
      expect(requests.map(request => request.progress)).toEqual([true, true])
      expect(requests[1].form).toBe(requests[0].form)
      expect(requests[1].form.get('reqtype')).toBe('fileupload')
      expect(requests[1].form.get('time')).toBe(provider === 'litterbox' ? '12h' : null)
      expect(requests[1].form.get('userhash')).toBeNull()
      const file = requests[1].form.get('fileToUpload') as File
      expect(file.name).toBe('test.ipa')
      expect(await file.text()).toBe('test')
      expect(resets).toBe(1)
    })
  }

  test(`${provider}: cancellation does not start a second upload`, async () => {
    outcome = 'abort'
    await expect(upload()).rejects.toThrow('cancelled')
    expect(requests).toHaveLength(1)
  })

  test(`${provider}: AbortSignal cancels an in-flight upload without fallback`, async () => {
    outcome = 'pending'
    const controller = new AbortController()
    const pending = upload(output, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
    expect(requests).toHaveLength(1)
  })

  if (provider === 'litterbox') test(`${provider}: direct-upload timeout rejects instead of spinning`, async () => {
    directOutcome = 'timeout'
    const blob = new Blob(['test'])
    Object.defineProperty(blob, 'size', { value: sylvaProxyMaxFileSize + 1 })
    await expect(upload({ ...output, data: blob })).rejects.toThrow('timed out')
    expect(requests).toHaveLength(1)
    expect(requests[0].progress).toBe(false)
  })

  test(`${provider}: stalled proxy triggers its idle deadline and falls back`, async () => {
    outcome = 'pending'
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (args[1] === 120_000) args[1] = 1
      return originalSetTimeout(...args)
    }) as typeof setTimeout
    try {
      await expect(upload()).resolves.toBe(`${host}test.ipa`)
      expect(requests.map(request => request.url)).toEqual([`${sylvaProxyBaseUrl}/${provider}`, retryEndpoint])
    } finally { globalThis.setTimeout = originalSetTimeout }
  })

  test(`${provider}: 100% without a response retries even if XHR never emits abort`, async () => {
    outcome = 'pending'
    pendingSent = true
    silentAbort = true
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (args[1] === 120_000) args[1] = 1
      return originalSetTimeout(...args)
    }) as typeof setTimeout
    const transfers: unknown[] = []
    try {
      await expect(upload(output, { onTransfer: (transfer: unknown) => transfers.push(transfer) })).resolves.toBe(`${host}test.ipa`)
      expect(transfers).toEqual([
        { transport: 'proxy', attempt: 1, timeoutMs: 900_000 },
        { transport: 'proxy', attempt: 2, timeoutMs: 900_000 },
      ])
      expect(requests).toHaveLength(2)
    } finally { globalThis.setTimeout = originalSetTimeout }
  })

  if (provider === 'litterbox') test(`${provider}: large direct upload stops even if native timeout and abort events never fire`, async () => {
    directOutcome = 'pending'
    silentAbort = true
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (args[1] === 300_000) args[1] = 1
      return originalSetTimeout(...args)
    }) as typeof setTimeout
    try {
      const blob = new Blob(['test'])
      Object.defineProperty(blob, 'size', { value: sylvaProxyMaxFileSize + 1 })
      await expect(upload({ ...output, data: blob })).rejects.toThrow('timed out')
      expect(requests).toHaveLength(1)
    } finally { globalThis.setTimeout = originalSetTimeout }
  })

  test(`${provider}: cancelling a silent XHR settles immediately without retry`, async () => {
    outcome = 'pending'
    silentAbort = true
    const controller = new AbortController()
    const pending = upload(output, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
    expect(requests).toHaveLength(1)
  })

  test(`${provider}: two stalled proxy attempts stop without a third upload`, async () => {
    outcome = 'pending'
    retryOutcome = 'pending'
    pendingSent = true
    silentAbort = true
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (args[1] === 120_000) args[1] = 1
      return originalSetTimeout(...args)
    }) as typeof setTimeout
    try {
      await expect(upload()).rejects.toThrow('stopped responding')
      expect(requests.map(request => request.url)).toEqual([`${sylvaProxyBaseUrl}/${provider}`, retryEndpoint])
      expect(requests.map(request => request.progress)).toEqual([true, true])
    } finally { globalThis.setTimeout = originalSetTimeout }
  })

  test(`${provider}: host validation errors do not retry`, async () => {
    outcome = 412
    await expect(upload()).rejects.toThrow('HTTP 412')
    await expect(upload()).rejects.toThrow('Upload rejected')
    expect(requests).toHaveLength(2)
  })

  test(`${provider}: both paths failing surfaces a host connection error`, async () => {
    outcome = 'network'
    retryOutcome = 'network'
    await expect(upload()).rejects.toThrow(`Could not reach the Sylva ${provider === 'catbox' ? 'Catbox' : 'Litterbox'}`)
    expect(requests).toHaveLength(2)
  })

  test(`${provider}: desktop preserves proxy progress and resets it before fallback`, async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 },
    })
    outcome = 502
    const events: string[] = []
    await upload(output, { onProgress: () => events.push('progress'), onProgressReset: () => events.push('reset') })
    expect(events).toEqual(['progress', 'reset', 'progress'])
    expect(requests.map(request => request.progress)).toEqual([true, true])
    expect(requests[1].url).toBe(retryEndpoint)
  })

  test(`${provider}: files at the proxy request limit leave room for multipart`, async () => {
    const blob = new Blob(['test'])
    Object.defineProperty(blob, 'size', { value: sylvaProxyMaxFileSize })
    if (provider === 'catbox') {
      await expect(upload({ ...output, data: blob })).rejects.toThrow('100 MB including upload overhead')
      expect(requests).toHaveLength(0)
    } else {
      await upload({ ...output, data: blob })
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(endpoint)
    }
  })

  test(`${provider}: files exceeding the host limit are rejected before any request`, async () => {
    const blob = new Blob(['test'])
    Object.defineProperty(blob, 'size', { value: provider === 'catbox' ? catboxMaxFileSize + 1 : 1024 * 1024 * 1024 + 1 })
    await expect(upload({ ...output, data: blob })).rejects.toThrow(provider === 'catbox' ? '100 MB' : 'accepts files up to')
    expect(requests).toHaveLength(0)
  })

  test(`${provider}: WebKit on iPhone recovers from an unreachable proxy`, async () => {
    const browser = await webkit.launch()
    try {
      const context = await browser.newContext({ ...devices['iPhone 13'] })
      const page = await context.newPage()
      const uploadRequests: string[] = []
      await page.route(`${sylvaProxyBaseUrl}/${provider}`, async route => {
        uploadRequests.push(`proxy ${route.request().method()}`)
        await route.abort('failed')
      })
      await page.route(retryEndpoint, async route => {
        uploadRequests.push(`retry ${route.request().method()}`)
        await route.fulfill({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' },
          body: `${host}webkit-test.ipa\n`,
        })
      })
      await page.goto('/')
      const source = ts.transpileModule(readFileSync('src/install-api.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText
      const result = await page.evaluate(async ({ source, provider }) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        try {
          const api = await import(moduleUrl)
          const output = { name: 'test.ipa', path: '/output/test.ipa', type: 'application/zip', data: new Blob(['test']) }
          const options = { onProgress: () => {} }
          return provider === 'catbox'
            ? await api.uploadSignedIpaToCatbox(output, options)
            : await api.uploadSignedIpaToLitterbox(output, '12h', options)
        } finally {
          URL.revokeObjectURL(moduleUrl)
        }
      }, { source, provider })
      expect(result).toBe(`${host}webkit-test.ipa`)
      expect(uploadRequests).toEqual(['proxy POST', 'retry POST'])
    } finally {
      await browser.close()
    }
  })
}

test('Catbox accepts its maximum safe file size only through the Worker', async () => {
  const blob = new Blob(['test'])
  Object.defineProperty(blob, 'size', { value: catboxMaxFileSize })
  await uploadSignedIpaToCatbox({ ...output, data: blob })
  expect(catboxMaxFileSize).toBe(sylvaProxyMaxFileSize - 64 * 1024)
  expect(requests.map(request => request.url)).toEqual([`${sylvaProxyBaseUrl}/catbox`])
  expect(requests[0].progress).toBe(true)
})

test('a stalled Palera probe is aborted before the Sylva manifest fallback', async () => {
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    if (args[1] === 15_000) args[1] = 1
    return originalSetTimeout(...args)
  }) as typeof setTimeout
  let paleraAborted = false
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.palera.in/')) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          paleraAborted = true
          reject(new Error('Palera probe aborted'))
        }, { once: true })
      })
    }
    return new Response('<?xml version="1.0"?><plist version="1.0"></plist>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }
  try {
    const result = await createInstallUrls({ appName: 'Test', bundleId: 'dev.sylva.test', version: '1' }, `${litterboxHost}test.ipa`)
    expect(paleraAborted).toBe(true)
    expect(result.manifestProvider).toBe('sylva')
  } finally { globalThis.setTimeout = originalSetTimeout }
})
