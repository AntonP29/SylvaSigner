import { devices, expect, test, webkit } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import {
  catboxEndpoint,
  catboxHost,
  litterboxEndpoint,
  litterboxHost,
  sylvaProxyBaseUrl,
  sylvaProxyMaxFileSize,
  uploadSignedIpaToCatbox,
  uploadSignedIpaToLitterbox,
} from '../../src/install-api'
import type { OutputFile } from '../../src/types'

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest')
const originalFetch = globalThis.fetch

type Outcome = number | 'network' | 'abort'
let outcome: Outcome
let directOutcome: Outcome
let requests: Array<{ url: string; form: FormData; progress: boolean }>

test.beforeEach(() => {
  outcome = 200
  directOutcome = 200
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
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    url = ''
    open(method: string, url: string) {
      expect(method).toBe('POST')
      this.url = url
    }
    send(form: FormData) {
      requests.push({ url: this.url, form, progress: Boolean(this.upload.onprogress) })
      const result = this.url.startsWith(sylvaProxyBaseUrl) ? outcome : directOutcome
      queueMicrotask(() => {
        if (result === 'network') return this.onerror?.()
        if (result === 'abort') return this.onabort?.()
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
  const upload = (file = output, options = {}) => provider === 'catbox'
    ? uploadSignedIpaToCatbox(file, options)
    : uploadSignedIpaToLitterbox(file, '12h', options)

  test(`${provider}: Safari uploads avoid progress-triggered preflight`, async () => {
    await expect(upload(output, { onProgress: () => { throw new Error('Unexpected progress') } })).resolves.toBe(`${host}test.ipa`)
    expect(requests).toHaveLength(1)
    expect(requests[0].progress).toBe(false)
  })

  test(`${provider}: iPad desktop user agent also avoids upload listeners`, async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 },
    })
    await upload(output, { onProgress: () => { throw new Error('Unexpected progress') } })
    expect(requests[0].progress).toBe(false)
  })

  for (const failure of ['network', 0, 404, 413, 429, 502] as const) {
    test(`${provider}: retries proxy ${failure} directly with intact multipart fields`, async () => {
      outcome = failure
      let resets = 0
      await expect(upload(output, { onProgress: () => {}, onProgressReset: () => resets++ })).resolves.toBe(`${host}test.ipa`)
      expect(requests.map(request => request.url)).toEqual([`${sylvaProxyBaseUrl}/${provider}`, endpoint])
      expect(requests.every(request => !request.progress)).toBe(true)
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

  test(`${provider}: host validation errors do not retry`, async () => {
    outcome = 412
    await expect(upload()).rejects.toThrow('HTTP 412')
    expect(requests).toHaveLength(1)
  })

  test(`${provider}: both paths failing surfaces a host connection error`, async () => {
    outcome = 'network'
    directOutcome = 'network'
    await expect(upload()).rejects.toThrow(`Could not reach ${provider === 'catbox' ? 'Catbox' : 'Litterbox'}`)
    expect(requests).toHaveLength(2)
  })

  test(`${provider}: desktop preserves proxy progress and resets it before fallback`, async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 },
    })
    outcome = 502
    const events: string[] = []
    await upload(output, { onProgress: () => events.push('progress'), onProgressReset: () => events.push('reset') })
    expect(events).toEqual(['progress', 'reset'])
    expect(requests.map(request => request.progress)).toEqual([true, false])
    expect(requests[1].url).toBe(endpoint)
  })

  test(`${provider}: files at the proxy limit go directly to leave room for multipart`, async () => {
    const blob = new Blob(['test'])
    Object.defineProperty(blob, 'size', { value: sylvaProxyMaxFileSize })
    await upload({ ...output, data: blob })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(endpoint)
  })

  test(`${provider}: files exceeding the host limit are rejected before any request`, async () => {
    const blob = new Blob(['test'])
    Object.defineProperty(blob, 'size', { value: provider === 'catbox' ? 201 * 1024 * 1024 : 1024 * 1024 * 1024 + 1 })
    await expect(upload({ ...output, data: blob })).rejects.toThrow('accepts files up to')
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
      await page.route(endpoint, async route => {
        uploadRequests.push(`direct ${route.request().method()}`)
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
          const options = { onProgress: () => { throw new Error('Safari must not attach upload listeners') } }
          return provider === 'catbox'
            ? await api.uploadSignedIpaToCatbox(output, options)
            : await api.uploadSignedIpaToLitterbox(output, '12h', options)
        } finally {
          URL.revokeObjectURL(moduleUrl)
        }
      }, { source, provider })
      expect(result).toBe(`${host}webkit-test.ipa`)
      expect(uploadRequests).toEqual(['proxy POST', 'direct POST'])
    } finally {
      await browser.close()
    }
  })
}
