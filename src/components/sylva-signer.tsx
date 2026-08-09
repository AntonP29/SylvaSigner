'use client'

import * as React from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

import { FileDrop } from '@/components/file-drop'
import { InstallQrDialog } from '@/components/install-qr-dialog'
import {
  LogConsole,
  type ConsoleActivity,
  type LogEntry,
  type LogLevel,
} from '@/components/log-console'
import { ThemeToggle } from '@/components/theme-toggle'

import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Blocks } from '@/components/animate-ui/icons/blocks'
import { LockKeyhole } from '@/components/animate-ui/icons/lock-keyhole'
import { BadgeCheck } from '@/components/animate-ui/icons/badge-check'
import { Layers } from '@/components/animate-ui/icons/layers'
import { Key } from '@/components/animate-ui/icons/key'
import { Fingerprint } from '@/components/animate-ui/icons/fingerprint'
import { Trash2 } from '@/components/animate-ui/icons/trash-2'
import { Download } from '@/components/animate-ui/icons/download'
import { LoaderCircle } from '@/components/animate-ui/icons/loader-circle'
import { CircleCheckBig } from '@/components/animate-ui/icons/circle-check-big'
import { Send } from '@/components/animate-ui/icons/send'
import { Upload } from '@/components/animate-ui/icons/upload'
import { Copy } from '@/components/animate-ui/icons/copy'
import { Lock } from '@/components/animate-ui/icons/lock'
import { ClipboardList } from '@/components/animate-ui/icons/clipboard-list'
import { TriangleAlert } from '@/components/animate-ui/icons/triangle-alert'
import type { InstallMetadata } from '@/install-api'
import {
  extractAppMetadata,
  extractCertificateMetadata,
  extractDylibMetadata,
  extractProvisioningMetadata,
  type AppMetadata,
  type CertificateMetadata,
  type DylibMetadata,
  type ProvisioningMetadata,
} from '@/app-metadata'
import {
  clearIpaHistory,
  createLocalHistoryEntry,
  readIpaHistory,
  updateHistoryEntryUpload,
  upsertIpaHistoryEntry,
  type IpaHistoryEntry,
} from '@/history-api'
import {
  fetchNexCertFiles,
  fetchSignedNexCerts,
  type NexCertEntry,
} from '@/public-certs'
import { saveOutput, signIpa } from '@/zsign-api'
import { sylvaProxyBaseUrl } from '@/install-api'
import type { OutputFile, SignIpaOptions, ZsignProgress } from '@/types'
import { cn } from '@/lib/utils'
import { PrivacySummary, SigningGuideAndFaq } from '@/components/seo-content'

type SignState = 'idle' | 'signing' | 'done' | 'error'
export type SylvaRoute = 'app' | 'privacy' | 'legal'

type ProgressState = {
  value: number
  label: string
}

type CachedFileData = {
  name: string
  type: string
  lastModified: number
  data: ArrayBuffer
}

type CachedCertInfo = {
  p12?: CachedFileData
  profiles: CachedFileData[]
  password?: string
  savedAt: number
}

type GithubReleaseAsset = {
  name: string
  browser_download_url: string
}

type GithubRelease = {
  name: string | null
  tag_name: string
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  assets: GithubReleaseAsset[]
}

type SylvaIosRelease = {
  name: string
  version: string
  releaseUrl: string
  ipaUrl: string
}

let logCounter = 0

const certCacheDbName = 'zsign-wasm-cert-cache'
const certCacheStore = 'cert-info'
const certCacheKey = 'default'
const sylvaIosRepoUrl = 'https://github.com/AntonP29/Sylva-iOS-Releases'
const sylvaIosReleasesUrl = `${sylvaIosRepoUrl}/releases`
const sylvaIosFallbackIpaUrl =
  'https://github.com/AntonP29/Sylva-iOS-Releases/releases/latest'

function routeFromLocation(): SylvaRoute {
  if (typeof window === 'undefined') return 'app'
  const pathname = window.location.pathname.replace(/\/+$/, '')
  if (pathname === '/privacy' || window.location.hash === '#privacy') return 'privacy'
  if (pathname === '/legal' || window.location.hash === '#legal') return 'legal'
  return 'app'
}

function useRoute(initialRoute?: SylvaRoute) {
  const [route, setRoute] = React.useState<SylvaRoute>(() => initialRoute ?? routeFromLocation())

  React.useEffect(() => {
    const updateRoute = () => setRoute(routeFromLocation())
    window.addEventListener('hashchange', updateRoute)
    window.addEventListener('popstate', updateRoute)
    return () => {
      window.removeEventListener('hashchange', updateRoute)
      window.removeEventListener('popstate', updateRoute)
    }
  }, [initialRoute])

  return route
}

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0 0 12 .5Z" />
    </svg>
  )
}

function releaseApiUrlFromReleasesUrl(releasesUrl: string) {
  const url = new URL(releasesUrl)
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname !== 'github.com' || parts.length < 3 || parts[2] !== 'releases') {
    throw new Error('Expected a GitHub releases URL.')
  }
  return `https://api.github.com/repos/${parts[0]}/${parts[1]}/releases`
}

function parseSylvaVersion(value: string) {
  const match = value.match(/(?:sylva\s*)?v?(\d+(?:\.\d+)*)(?:\s*\((\d+)\))?/i)
  if (!match) return null

  const versionParts = match[1].split('.').map((part) => Number.parseInt(part, 10) || 0)
  const build = match[2] ? Number.parseInt(match[2], 10) || 0 : 0
  return { label: `${match[1]}${match[2] ? ` (${match[2]})` : ''}`, rank: [...versionParts, build] }
}

function compareVersionRank(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function latestSylvaIosReleaseFrom(releases: GithubRelease[]): SylvaIosRelease | null {
  const candidates = releases
    .filter((release) => !release.draft)
    .map((release) => {
      const ipa = release.assets.find((asset) => /\.ipa$/i.test(asset.name))
      if (!ipa) return null

      const version =
        parseSylvaVersion(`${release.name ?? ''} ${release.tag_name}`) ??
        parseSylvaVersion(release.body ?? '')

      return {
        release,
        ipa,
        version,
      }
    })
    .filter(
      (
        candidate,
      ): candidate is {
        release: GithubRelease
        ipa: GithubReleaseAsset
        version: { label: string; rank: number[] } | null
      } => candidate !== null,
    )

  candidates.sort((left, right) => {
    if (left.version && right.version) {
      const versionDiff = compareVersionRank(right.version.rank, left.version.rank)
      if (versionDiff !== 0) return versionDiff
    }
    if (left.version && !right.version) return -1
    if (!left.version && right.version) return 1
    return Date.parse(right.release.published_at ?? '') - Date.parse(left.release.published_at ?? '')
  })

  const latest = candidates[0]
  if (!latest) return null

  return {
    name: latest.release.name || latest.release.tag_name,
    version: latest.version?.label ?? latest.release.tag_name,
    releaseUrl: latest.release.html_url,
    ipaUrl: latest.ipa.browser_download_url,
  }
}

function useLatestSylvaIosRelease() {
  const [release, setRelease] = React.useState<SylvaIosRelease | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const response = await fetch(releaseApiUrlFromReleasesUrl(sylvaIosReleasesUrl), {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`GitHub releases failed with HTTP ${response.status}.`)
        const releases = (await response.json()) as GithubRelease[]
        if (!controller.signal.aborted) {
          setRelease(latestSylvaIosReleaseFrom(releases))
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setRelease(null)
        }
      }
    })()

    return () => controller.abort()
  }, [])

  return release
}

function openCertCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(certCacheDbName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(certCacheStore)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open cert cache.'))
  })
}

async function withCertCacheStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openCertCacheDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(certCacheStore, mode)
      const request = callback(transaction.objectStore(certCacheStore))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Cert cache request failed.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Cert cache transaction failed.'))
    })
  } finally {
    db.close()
  }
}

async function readCachedCertInfo() {
  return (await withCertCacheStore('readonly', (store) =>
    store.get(certCacheKey),
  )) as CachedCertInfo | null
}

async function writeCachedCertInfo(value: CachedCertInfo) {
  await withCertCacheStore('readwrite', (store) => store.put(value, certCacheKey))
}

async function deleteCachedCertInfo() {
  await withCertCacheStore('readwrite', (store) => store.delete(certCacheKey))
}

async function fileToCachedData(nextFile: File): Promise<CachedFileData> {
  return {
    name: nextFile.name,
    type: nextFile.type,
    lastModified: nextFile.lastModified,
    data: await nextFile.arrayBuffer(),
  }
}

function cachedDataToFile(nextFile: CachedFileData) {
  return new File([nextFile.data], nextFile.name, {
    type: nextFile.type,
    lastModified: nextFile.lastModified,
  })
}

function defaultOutputName(ipa?: File | null) {
  if (!ipa) return ''
  const base = ipa.name.replace(/\.(ipa|zip)$/i, '')
  return `${base || 'app'}_signed.ipa`
}

function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value)
    const pathName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    const cleanName = pathName.replace(/[\\/:*?"<>|]/g, '-').trim()
    if (/\.(ipa|zip)$/i.test(cleanName)) return cleanName
    if (cleanName) return `${cleanName}.ipa`
  } catch {
    // The caller validates the URL. Fall through to a stable fallback name.
  }
  return 'downloaded.ipa'
}

function readableDownloadError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Download canceled.'
  if (error instanceof TypeError) {
    return 'The browser could not download that URL. The host may block cross-origin downloads.'
  }
  return error instanceof Error ? error.message : String(error)
}

async function proxyErrorMessage(response: Response) {
  try {
    const body = await response.json() as { message?: string }
    return body.message || `Sylva proxy failed with HTTP ${response.status}.`
  } catch {
    return `Sylva proxy failed with HTTP ${response.status}.`
  }
}

function cleanLogLine(line: string) {
  return line.replace(/\x1b\[[0-9;]*m/g, '').trim()
}

function logLevelFor(line: string): LogLevel {
  const clean = cleanLogLine(line).toLowerCase()
  if (clean.includes('error') || clean.includes('trap') || clean.includes('failed')) return 'error'
  if (clean.includes('warn') || clean.includes('no enough')) return 'warn'
  if (clean.includes('ok') || clean.includes('success') || clean.includes('done')) return 'success'
  if (clean.startsWith('>>>')) return 'step'
  return 'info'
}

function parseInstallMetadataLine(line: string) {
  const match = cleanLogLine(line).match(/^>>>\s*(AppName|BundleId|Version):\s*(.+)$/i)
  if (!match) return null

  const [, key, value] = match
  if (key.toLowerCase() === 'appname') return { appName: value.trim() }
  if (key.toLowerCase() === 'bundleid') return { bundleId: value.trim() }
  if (key.toLowerCase() === 'version') return { version: value.trim() }
  return null
}

function signingProgressForLine(line: string, current: ProgressState): ProgressState {
  const clean = cleanLogLine(line).toLowerCase()
  if (clean.includes('storage: browser disk mode')) return { value: Math.max(current.value, 8), label: 'Preparing low-memory browser storage' }
  if (clean.includes('unzip:')) return { value: Math.max(current.value, 12), label: 'Unzipping IPA locally' }
  if (clean.includes('unzip ok')) return { value: Math.max(current.value, 25), label: 'IPA extracted' }
  if (clean.includes('signing:')) return { value: Math.max(current.value, 34), label: 'Preparing app signature' }
  if (clean.includes('signfile:')) return { value: Math.min(82, Math.max(current.value + 2, 42)), label: 'Signing app binaries' }
  if (clean.includes('signfolder:')) return { value: Math.min(88, Math.max(current.value + 3, 66)), label: 'Writing bundle signatures' }
  if (clean.includes('signed ok')) return { value: Math.max(current.value, 88), label: 'Signature complete' }
  if (clean.includes('archiving:')) return { value: Math.max(current.value, 94), label: 'Archiving signed IPA' }
  if (clean.includes('archive ok')) return { value: Math.max(current.value, 98), label: 'Archive complete' }
  return current
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{progress.label}</span>
        <span className="tabular-nums">{progress.value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress.value}%` }}
        />
      </div>
    </div>
  )
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function isExpired(entry: IpaHistoryEntry) {
  return Boolean(entry.expiresAt && Date.now() > new Date(entry.expiresAt).getTime())
}

function StatusTag({ children, tone }: { children: React.ReactNode; tone: 'local' | 'active' | 'expired' }) {
  const toneClass =
    tone === 'local'
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300'
      : tone === 'active'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-muted-foreground/20 bg-muted text-muted-foreground'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

function PreviousIpasDialog({
  entries,
  directInstall = false,
  onClose,
  onClear,
}: {
  entries: IpaHistoryEntry[]
  directInstall?: boolean
  onClose: () => void
  onClear: () => void
}) {
  const [copiedId, setCopiedId] = React.useState('')
  const [qrCodes, setQrCodes] = React.useState<Record<string, string>>({})
  const [, setExpiryClock] = React.useState(Date.now)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  React.useEffect(() => {
    const timer = window.setInterval(() => setExpiryClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    if (directInstall) {
      setQrCodes({})
      return
    }
    let cancelled = false
    const activeEntries = entries.filter(
      (entry) => entry.installUrl && !isExpired(entry),
    )
    void (async () => {
      const QRCode = await import('qrcode')
      const values = await Promise.all(
        activeEntries.map(async (entry) => [
          entry.id,
          await QRCode.toDataURL(entry.installUrl!, {
            errorCorrectionLevel: 'M',
            margin: 1,
            scale: 5,
            color: { dark: '#111827', light: '#ffffff' },
          }),
        ] as const),
      )
      if (!cancelled) setQrCodes(Object.fromEntries(values))
    })()
    return () => {
      cancelled = true
    }
  }, [directInstall, entries])

  const copyValue = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId(''), 1400)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="previous-ipas-title"
    >
      <div className="flex max-h-[min(92svh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <AnimateIcon animateOnHover>
              <ClipboardList size={24} className="text-muted-foreground transition-colors hover:text-blue-500" />
            </AnimateIcon>
            <div>
              <h2 id="previous-ipas-title" className="text-lg font-semibold">
                Previous IPAs
              </h2>
              <p className="text-sm text-muted-foreground">
                Local history of signed names and temporary install links.
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No signed IPA history yet.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const expired = isExpired(entry)
                const hasLinks = Boolean(entry.ipaUrl && entry.installUrl)

                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted text-muted-foreground">
                          {entry.iconDataUrl ? (
                            <img src={entry.iconDataUrl} alt="" className="size-full object-cover" />
                          ) : (
                            <Layers size={22} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {entry.metadata?.appName || entry.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{entry.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Signed {formatHistoryDate(entry.signedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!hasLinks ? (
                          <StatusTag tone="local">Fully Local</StatusTag>
                        ) : (
                          <>
                            <StatusTag tone={expired ? 'expired' : 'active'}>
                              {expired ? 'Expired' : 'Active'}
                            </StatusTag>
                            <StatusTag tone="local">
                              Litterbox {entry.uploadExpiry}
                            </StatusTag>
                          </>
                        )}
                      </div>
                    </div>

                    {entry.metadata?.bundleId && (
                      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                        {entry.metadata.bundleId}
                      </p>
                    )}

                    {hasLinks && (
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        {!directInstall && !expired && qrCodes[entry.id] && (
                          <div className="rounded-xl border border-border bg-white p-1.5">
                            <img
                              src={qrCodes[entry.id]}
                              alt={`Install ${entry.metadata?.appName || entry.name} QR code`}
                              className="size-24"
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                        <AnimateIcon animateOnHover asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyValue(`${entry.id}-ipa`, entry.ipaUrl ?? '')
                            }
                            className="gap-2"
                          >
                            <Copy size={14} />
                            {copiedId === `${entry.id}-ipa`
                              ? 'Copied URL'
                              : 'Copy Download URL'}
                          </Button>
                        </AnimateIcon>
                        {directInstall && !expired ? (
                          <a
                            href={entry.installUrl}
                            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            <Send size={14} />
                            Install on iPhone
                          </a>
                        ) : !directInstall ? (
                          <AnimateIcon animateOnHover asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                copyValue(`${entry.id}-install`, entry.installUrl ?? '')
                              }
                              className="gap-2"
                            >
                              <Copy size={14} />
                              {copiedId === `${entry.id}-install`
                                ? 'Copied Link'
                                : 'Copy iPhone Install Link'}
                            </Button>
                          </AnimateIcon>
                        ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="flex justify-end border-t border-border px-5 py-3">
            <AnimateIcon animateOnHover asChild>
              <Button
                type="button"
                variant="ghost"
                onClick={onClear}
                className="gap-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={16} />
                Clear History
              </Button>
            </AnimateIcon>
          </div>
        )}
      </div>
    </div>
  )
}

function WelcomeMark() {
  return (
    <div className="welcome-mark relative mx-auto size-24 md:size-28" aria-label="Sylva Signer">
      <img
        src="/icon-light.png"
        alt=""
        className="size-full object-contain drop-shadow-xl dark:hidden"
      />
      <img
        src="/icon-dark.png"
        alt=""
        className="hidden size-full object-contain drop-shadow-xl dark:block"
      />
    </div>
  )
}

function getFormattedDate() {
  const date = new Date()
  const day = date.getDate()
  const month = date.toLocaleDateString('en-US', { month: 'long' })
  const year = date.getFullYear()

  let suffix = 'th'
  if (day % 10 === 1 && day !== 11) suffix = 'st'
  else if (day % 10 === 2 && day !== 12) suffix = 'nd'
  else if (day % 10 === 3 && day !== 13) suffix = 'rd'

  return `${month} ${day}${suffix}, ${year}`
}

function WelcomeDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="px-6 py-8">
          <WelcomeMark />
        </div>

        <div className="space-y-4 px-6 pb-6 text-center">
          <div>
            <h2 id="welcome-title" className="text-2xl font-semibold tracking-tight">
              Hey there 👋
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Sylva Signer is a browser-based proof of concept for local IPA signing.
              Large files can take time because extraction, signing, and archiving happen
              on this device and may require several times the IPA size in available
              memory. Direct iPhone installation requires an
              HTTPS-hosted IPA, so the built-in installation flow uploads only the signed IPA to a
              temporary provider after your explicit agreement.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
            <a
              href="https://github.com/AntonP29"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <GithubIcon size={14} />
              AntonP29
            </a>
            <span>{getFormattedDate()}</span>
          </div>

          <Button type="button" onClick={onClose} className="w-full">
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function LegalFooter() {
  const sylvaIosRelease = useLatestSylvaIosRelease()

  return (
    <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
        <p className="italic leading-5">
          Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker. Your IPA,
          certificate, provisioning profile, password, and signed output remain on this device
          during signing; temporary installation uploads only the signed IPA after confirmation.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-y border-border/70 py-3 text-foreground/70">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            Powered by
            <a
              className="font-medium text-sky-300 transition-colors hover:text-sky-200 hover:underline"
              href="https://github.com/zhlynn/zsign"
              target="_blank"
              rel="noreferrer"
            >
              zsign
            </a>
            <span>(WASM port)</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="mr-2 font-semibold text-foreground/60" aria-hidden="true">
              |
            </span>
            Temporary hosting by
            <a
              className="font-medium text-sky-300 transition-colors hover:text-sky-200 hover:underline"
              href="https://litterbox.catbox.moe/"
              target="_blank"
              rel="noreferrer"
            >
              Litterbox
            </a>
          </span>
        </div>

        <div className="w-full max-w-md rounded-2xl border border-border bg-card/60 px-4 py-3 text-center">
          <p className="text-sm font-medium text-foreground">Try Sylva iOS</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Fully on-device native Swift app for importing, signing, organizing, and installing IPAs.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <a
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:border-sky-400/50 hover:text-sky-300"
              href={sylvaIosRepoUrl}
              target="_blank"
              rel="noreferrer"
            >
              <GithubIcon size={14} />
              GitHub
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
              href={sylvaIosRelease?.ipaUrl ?? sylvaIosFallbackIpaUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={14} />
              Latest IPA
              {sylvaIosRelease ? (
                <span className="text-muted-foreground">v{sylvaIosRelease.version}</span>
              ) : (
                <span className="text-muted-foreground">auto</span>
              )}
            </a>
            {sylvaIosRelease && (
              <a
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
                href={sylvaIosRelease.releaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                Release notes
              </a>
            )}
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a className="transition-colors hover:text-red-500" href="/privacy/">
            Privacy Policy
          </a>
          <a className="transition-colors hover:text-blue-500" href="/legal/">
            Legal
          </a>
          <a
            className="transition-colors hover:text-emerald-500"
            href="https://github.com/AntonP29/SylvaSigner/blob/master/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            MIT License
          </a>
          <a
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            href="https://github.com/AntonP29"
            target="_blank"
            rel="noreferrer"
          >
            <GithubIcon size={14} />
            AntonP29
          </a>
        </nav>
      </div>
    </footer>
  )
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  return (
    /Android|iPad|iPhone|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function isAppleMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function InfoPage({ route }: { route: Exclude<SylvaRoute, 'app'> }) {
  const isPrivacy = route === 'privacy'

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-3.5">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl shadow-sm md:size-14">
            <img
              src="/icon-light.png"
              alt="Sylva Signer logo"
              className="size-full scale-[1.18] object-cover dark:hidden"
            />
            <img
              src="/icon-dark.png"
              alt=""
              aria-hidden
              className="hidden size-full scale-[1.18] object-cover dark:block"
            />
          </div>
          <div>
            <h1 className="text-balance text-xl font-semibold tracking-tight md:text-2xl">
              Sylva Signer
            </h1>
            <p className="text-sm text-muted-foreground">Fully local IPA signing</p>
          </div>
        </a>
        <ThemeToggle />
      </header>

      <Separator className="my-8" />

      <section className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex items-center gap-3">
          <AnimateIcon animateOnHover>
            {isPrivacy ? (
              <Lock size={28} className="text-muted-foreground transition-colors hover:text-blue-500" />
            ) : (
              <ClipboardList
                size={28}
                className="text-muted-foreground transition-colors hover:text-emerald-500"
              />
            )}
          </AnimateIcon>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {isPrivacy ? 'Privacy Policy' : 'Legal Notice'}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              {isPrivacy ? 'Privacy Policy' : 'Legal'}
            </h2>
          </div>
        </div>

        <div className="space-y-4 text-sm leading-7 text-muted-foreground">
          {isPrivacy ? (
            <>
              <p>
                Sylva Signer is designed to sign IPA files locally in your browser. The app
                does not require a signing server and does not intentionally upload your IPA,
                P12/PFX certificate, provisioning profile, password, or dylibs. If you choose
                temporary installation after signing, only the signed IPA is uploaded so iOS can
                fetch it over HTTPS.
              </p>
              <p>
                Optional certificate caching stores selected signing material and password
                data in this browser&apos;s IndexedDB storage on this device. You can clear
                that cache from the signer interface.
              </p>
              <p>
                If you use a hosted copy, your browser still downloads the application code
                from that host. Use a build and domain you trust.
              </p>
            </>
          ) : (
            <>
              <p>
                Sylva Signer is provided as a browser-based signing tool for lawful workflows
                using certificates, provisioning profiles, and app files you are authorized to
                use.
              </p>
              <p>
                You are responsible for complying with Apple developer terms, software
                licenses, distribution rules, and all applicable laws. This project does not
                provide Apple certificates, provisioning profiles, entitlements, or third-party
                app assets.
              </p>
              <p>
                This project is made by AntonP29 and published for local, privacy-preserving
                IPA signing research and utility.
              </p>
              <p>
                Sylva Signer&apos;s original code is available under the MIT License. zsign,
                OpenSSL, Inter, JavaScript packages, and other third-party components remain
                under their own licenses and notices documented in the repository. Sylva
                Signer is independent and is not affiliated with or endorsed by Apple,
                Litterbox, Catbox, Palera, or the upstream zsign maintainers.
              </p>
            </>
          )}
        </div>

        <a
          href="https://github.com/AntonP29"
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground"
        >
          <GithubIcon size={16} />
          Visit AntonP29 on GitHub
        </a>
      </section>

      <LegalFooter />
    </main>
  )
}

function formatMetadataDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatMetadataSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function AppDetailsTile({
  ipa,
  dylibs,
  dylibMetadata,
  dylibMetadataLoading,
  dylibMetadataErrors,
  app,
  appLoading,
  appError,
  certificate,
  certificateFile,
  certificateMessage,
  profiles,
}: {
  ipa: File
  dylibs: File[]
  dylibMetadata: Record<string, DylibMetadata>
  dylibMetadataLoading: boolean
  dylibMetadataErrors: Record<string, string>
  app: AppMetadata | null
  appLoading: boolean
  appError: string
  certificate: CertificateMetadata | null
  certificateFile?: File
  certificateMessage: string
  profiles: ProvisioningMetadata[]
}) {
  const details = [
    { icon: Fingerprint, label: 'Bundle ID', value: app?.bundleId || 'Reading metadata...', wrap: true },
    { icon: Layers, label: 'Version', value: app?.version || 'Unknown' },
    { icon: Download, label: 'IPA size', value: formatMetadataSize(ipa.size) },
  ]

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-4 border-b border-border px-4 py-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted text-muted-foreground shadow-sm">
          {app?.iconDataUrl ? (
            <img
              src={app.iconDataUrl}
              alt={`${app.appName} icon`}
              className="size-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          ) : appLoading ? (
            <LoaderCircle size={24} animate loop />
          ) : (
            <Layers size={26} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">
              {app?.appName || (appLoading ? 'Reading app details...' : ipa.name)}
            </h2>
            {app && (
              <AnimateIcon animate>
                <CircleCheckBig size={16} className="shrink-0 text-emerald-500" />
              </AnimateIcon>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{ipa.name}</p>
          {appError && <p className="mt-1 text-xs text-destructive">{appError}</p>}
        </div>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        {details.map(({ icon: DetailIcon, label, value, wrap }) => (
          <div key={label} className="min-w-0 bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AnimateIcon animateOnHover>
                <DetailIcon size={14} className="transition-colors hover:text-blue-500" />
              </AnimateIcon>
              {label}
            </div>
            <p
              className={cn(
                'mt-1 text-sm font-medium',
                wrap ? 'break-all leading-snug' : 'truncate',
              )}
              title={value}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {dylibs.length > 0 && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <div className="flex items-start gap-3">
            <AnimateIcon animateOnHover>
              <Blocks size={19} className="mt-0.5 text-rose-500" />
            </AnimateIcon>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                Dylib injection
              </p>
              <p className="mt-0.5 text-sm font-medium">
                {dylibs.length} {dylibs.length === 1 ? 'dylib selected' : 'dylibs selected'}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {dylibs.map((dylib) => {
                  const key = `${dylib.name}-${dylib.size}-${dylib.lastModified}`
                  const metadata = dylibMetadata[key]
                  const primaryArchitecture = metadata?.architectures[0]
                  const architectures = metadata?.architectures.map((item) => item.architecture).join(', ')
                  const minOsValues = [
                    ...new Set(metadata?.architectures.map((item) => item.minOs).filter(Boolean)),
                  ]
                  const dependencyCount = metadata?.architectures.reduce(
                    (max, item) => Math.max(max, item.dependencyCount),
                    0,
                  )
                  const error = dylibMetadataErrors[key]

                  return (
                    <div
                      key={key}
                      className="min-w-0 rounded-lg border border-border bg-muted/25 px-2.5 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Blocks size={13} className="shrink-0 text-rose-500" />
                        <span className="min-w-0 flex-1 break-all font-medium text-foreground/90">
                          {dylib.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatMetadataSize(dylib.size)}
                        </span>
                      </div>
                      {metadata ? (
                        <div className="mt-1.5 grid gap-1 text-muted-foreground sm:grid-cols-2">
                          <span className="truncate">
                            {primaryArchitecture?.fileType ?? 'Mach-O'} · {architectures || 'Unknown arch'}
                          </span>
                          <span className="truncate">
                            {minOsValues.length ? `iOS ${minOsValues.join(', ')}+` : 'Minimum OS unavailable'}
                          </span>
                          <span className="truncate">
                            {typeof dependencyCount === 'number'
                              ? `${dependencyCount} linked ${dependencyCount === 1 ? 'library' : 'libraries'}`
                              : 'Dependencies unavailable'}
                          </span>
                          <span className="truncate" title={primaryArchitecture?.installName}>
                            {primaryArchitecture?.installName
                              ? primaryArchitecture.installName.split('/').at(-1)
                              : 'Install name unavailable'}
                          </span>
                        </div>
                      ) : error ? (
                        <p className="mt-1.5 text-muted-foreground">{error}</p>
                      ) : dylibMetadataLoading ? (
                        <p className="mt-1.5 text-muted-foreground">Reading Mach-O metadata...</p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {(certificateFile || certificateMessage || certificate || profiles.length > 0) && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <div className="flex items-start gap-3">
            <AnimateIcon animateOnHover>
              <BadgeCheck size={19} className="mt-0.5 text-emerald-500" />
            </AnimateIcon>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Signing certificate</p>
              <p className="truncate text-sm font-medium">
                {certificate?.name || certificateFile?.name || 'Signing certificate'}
              </p>
              {certificate && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Expires {formatMetadataDate(certificate.expiresAt)}
                </p>
              )}
              {!certificate && certificateMessage && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {certificateMessage}
                </p>
              )}
            </div>
          </div>

          {profiles.map((profile) => (
            <div key={`${profile.name}-${profile.expiresAt}`} className="flex items-start gap-3">
              <AnimateIcon animateOnHover>
                <LockKeyhole size={19} className="mt-0.5 text-amber-500" />
              </AnimateIcon>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Provisioning profile</p>
                <p className="truncate text-sm font-medium">{profile.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Expires {formatMetadataDate(profile.expiresAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SignerApp({ mobileMode = false }: { mobileMode?: boolean }) {
  const directInstallOnDevice = mobileMode && isAppleMobileBrowser()
  const [ipa, setIpa] = React.useState<File[]>([])
  const [p12, setP12] = React.useState<File[]>([])
  const [profiles, setProfiles] = React.useState<File[]>([])
  const [dylibs, setDylibs] = React.useState<File[]>([])

  const [ipaUrl, setIpaUrl] = React.useState('')
  const [ipaUrlDownloading, setIpaUrlDownloading] = React.useState(false)
  const [ipaUrlProgress, setIpaUrlProgress] = React.useState('')
  const [ipaUrlError, setIpaUrlError] = React.useState('')
  const [certPassword, setCertPassword] = React.useState('')
  const [outputName, setOutputName] = React.useState('')
  const [bundleId, setBundleId] = React.useState('')
  const [cacheCert, setCacheCert] = React.useState(false)
  const [cachedCertInfo, setCachedCertInfo] = React.useState<CachedCertInfo | null>(null)
  const [outputNameTouched, setOutputNameTouched] = React.useState(false)
  const [appMetadata, setAppMetadata] = React.useState<AppMetadata | null>(null)
  const [appMetadataLoading, setAppMetadataLoading] = React.useState(false)
  const [appMetadataError, setAppMetadataError] = React.useState('')
  const [certificateMetadata, setCertificateMetadata] = React.useState<CertificateMetadata | null>(null)
  const [certificateMessage, setCertificateMessage] = React.useState('')
  const [profileMetadata, setProfileMetadata] = React.useState<ProvisioningMetadata[]>([])
  const [dylibMetadata, setDylibMetadata] = React.useState<Record<string, DylibMetadata>>({})
  const [dylibMetadataLoading, setDylibMetadataLoading] = React.useState(false)
  const [dylibMetadataErrors, setDylibMetadataErrors] = React.useState<Record<string, string>>({})
  const [publicCerts, setPublicCerts] = React.useState<NexCertEntry[]>([])
  const [publicCertsLoading, setPublicCertsLoading] = React.useState(false)
  const [publicCertImportingId, setPublicCertImportingId] = React.useState('')
  const [publicCertMessage, setPublicCertMessage] = React.useState('')

  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [state, setState] = React.useState<SignState>('idle')
  const [outputs, setOutputs] = React.useState<OutputFile[]>([])
  const [installMetadata, setInstallMetadata] = React.useState<Partial<InstallMetadata>>({})
  const [installDialogOpen, setInstallDialogOpen] = React.useState(false)
  const [signProgress, setSignProgress] = React.useState<ProgressState>({
    value: 0,
    label: 'Waiting to sign',
  })
  const [consoleActivity, setConsoleActivity] = React.useState<ConsoleActivity | null>(null)
  const [historyEntries, setHistoryEntries] = React.useState<IpaHistoryEntry[]>([])
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false)
  const [welcomeOpen, setWelcomeOpen] = React.useState(false)
  const [currentHistoryId, setCurrentHistoryId] = React.useState('')
  const installMetadataRef = React.useRef<Partial<InstallMetadata>>({})
  const consoleRef = React.useRef<HTMLDivElement>(null)
  const publicCertAbortRef = React.useRef<AbortController | null>(null)
  const ipaUrlAbortRef = React.useRef<AbortController | null>(null)

  const canSign = Boolean(ipa[0] && (p12[0] || cachedCertInfo?.p12) && (profiles.length || cachedCertInfo?.profiles.length)) && state !== 'signing'
  const hasCache = Boolean(cachedCertInfo?.p12 || cachedCertInfo?.profiles.length || cachedCertInfo?.password)
  const firstOutput = outputs.find((output) => output.name.toLowerCase().endsWith('.ipa')) ?? outputs[0]

  React.useEffect(() => {
    setHistoryEntries(readIpaHistory())
  }, [])

  React.useEffect(() => {
    return () => {
      publicCertAbortRef.current?.abort()
      ipaUrlAbortRef.current?.abort()
    }
  }, [])

  const hydrateCachedFiles = React.useCallback((cached: CachedCertInfo | null) => {
    if (!cached) return
    setP12((current) => (current.length === 0 && cached.p12 ? [cachedDataToFile(cached.p12)] : current))
    setProfiles((current) =>
      current.length === 0 && cached.profiles.length > 0
        ? cached.profiles.map(cachedDataToFile)
        : current,
    )
    if (cached.password) setCertPassword((current) => current || cached.password || '')
  }, [])

  React.useEffect(() => {
    void readCachedCertInfo()
      .then((cached) => {
        setCachedCertInfo(cached)
        hydrateCachedFiles(cached)
        if (cached?.p12 || cached?.profiles.length || cached?.password) setCacheCert(true)
      })
      .catch(() => setCachedCertInfo(null))
  }, [hydrateCachedFiles])

  React.useEffect(() => {
    if (cacheCert) hydrateCachedFiles(cachedCertInfo)
  }, [cacheCert, cachedCertInfo, hydrateCachedFiles])

  React.useEffect(() => {
    if (!outputNameTouched) setOutputName(defaultOutputName(ipa[0]))
  }, [ipa, outputNameTouched])

  React.useEffect(() => {
    const file = ipa[0]
    let cancelled = false
    setAppMetadata(null)
    setAppMetadataError('')
    setAppMetadataLoading(Boolean(file))
    setBundleId('')
    if (!file) return

    void extractAppMetadata(file)
      .then((metadata) => {
        if (cancelled) return
        setAppMetadata(metadata)
        setBundleId(metadata.bundleId)
        const nextMetadata = {
          appName: metadata.appName,
          bundleId: metadata.bundleId,
          version: metadata.version,
        }
        installMetadataRef.current = nextMetadata
        setInstallMetadata(nextMetadata)
      })
      .catch((error) => {
        if (!cancelled) {
          setAppMetadataError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!cancelled) setAppMetadataLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ipa])

  React.useEffect(() => {
    setCertificateMetadata(null)
    setCertificateMessage(p12[0] ? 'Reading certificate...' : '')
  }, [p12])

  React.useEffect(() => {
    const file = p12[0]
    let cancelled = false
    if (!file) return

    const timer = window.setTimeout(() => {
      void extractCertificateMetadata(file, certPassword)
        .then((metadata) => {
          if (!cancelled) {
            setCertificateMetadata(metadata)
            setCertificateMessage('')
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCertificateMessage(
              certPassword
                ? 'Certificate details unavailable. Check the password.'
                : 'Enter the certificate password to view its details.',
            )
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [certPassword, p12])

  React.useEffect(() => {
    let cancelled = false
    if (profiles.length === 0) {
      setProfileMetadata([])
      return
    }
    void Promise.all(
      profiles.map(async (profile) => {
        try {
          return await extractProvisioningMetadata(profile)
        } catch {
          return { name: profile.name, expiresAt: '' }
        }
      }),
    ).then((metadata) => {
      if (!cancelled) setProfileMetadata(metadata)
    })
    return () => {
      cancelled = true
    }
  }, [profiles])

  React.useEffect(() => {
    let cancelled = false
    if (dylibs.length === 0) {
      setDylibMetadata({})
      setDylibMetadataErrors({})
      setDylibMetadataLoading(false)
      return
    }

    setDylibMetadataLoading(true)
    setDylibMetadataErrors({})
    type DylibMetadataResult =
      | { key: string; metadata: DylibMetadata }
      | { key: string; error: string }

    void Promise.all(
      dylibs.map(async (dylib): Promise<DylibMetadataResult> => {
        const key = `${dylib.name}-${dylib.size}-${dylib.lastModified}`
        try {
          return { key, metadata: await extractDylibMetadata(dylib) }
        } catch (error) {
          return {
            key,
            error: error instanceof Error ? error.message : 'Dylib metadata unavailable.',
          }
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const nextMetadata: Record<string, DylibMetadata> = {}
        const nextErrors: Record<string, string> = {}
        for (const result of results) {
          if ('error' in result) nextErrors[result.key] = result.error
          else nextMetadata[result.key] = result.metadata
        }
        setDylibMetadata(nextMetadata)
        setDylibMetadataErrors(nextErrors)
      })
      .finally(() => {
        if (!cancelled) setDylibMetadataLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dylibs])

  const addLog = React.useCallback((level: LogLevel, message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev, { id: ++logCounter, time, level, message }])
  }, [])

  const handleLoadPublicCerts = React.useCallback(async () => {
    publicCertAbortRef.current?.abort()
    const controller = new AbortController()
    publicCertAbortRef.current = controller
    setPublicCertsLoading(true)
    setPublicCertMessage('Loading signed public enterprise certificates from NexCerts...')

    try {
      const entries = await fetchSignedNexCerts(controller.signal)
      setPublicCerts(entries)
      setPublicCertMessage(
        entries.length
          ? `${entries.length} currently signed public enterprise certificate${entries.length === 1 ? '' : 's'} available.`
          : 'No signed public enterprise certificates are currently listed by NexCerts.',
      )
      addLog(
        entries.length ? 'info' : 'warn',
        `NexCerts signed public certificate list loaded (${entries.length} available)`,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : String(error)
      setPublicCertMessage(message)
      addLog('error', message)
    } finally {
      if (publicCertAbortRef.current === controller) {
        publicCertAbortRef.current = null
      }
      setPublicCertsLoading(false)
    }
  }, [addLog])

  const handleImportPublicCert = React.useCallback(
    async (entry: NexCertEntry) => {
      publicCertAbortRef.current?.abort()
      const controller = new AbortController()
      publicCertAbortRef.current = controller
      setPublicCertImportingId(entry.id)
      setPublicCertMessage(`Importing ${entry.company} from NexCerts...`)

      try {
        const files = await fetchNexCertFiles(entry, controller.signal)
        setP12([files.p12])
        setProfiles([files.profile])
        setCertPassword(files.password)
        setPublicCertMessage(`${entry.company} imported. Review the certificate details before signing.`)
        addLog('success', `Imported signed public enterprise certificate: ${entry.company}`)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const message = error instanceof Error ? error.message : String(error)
        setPublicCertMessage(message)
        addLog('error', message)
      } finally {
        if (publicCertAbortRef.current === controller) {
          publicCertAbortRef.current = null
        }
        setPublicCertImportingId('')
      }
    },
    [addLog],
  )

  const handleDownloadIpaUrl = React.useCallback(async () => {
    const value = ipaUrl.trim()
    let url: URL
    try {
      url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP and HTTPS IPA URLs are supported.')
      }
    } catch (error) {
      setIpaUrlError(error instanceof Error ? error.message : 'Enter a valid IPA URL.')
      return
    }

    ipaUrlAbortRef.current?.abort()
    const controller = new AbortController()
    ipaUrlAbortRef.current = controller
    const fileName = fileNameFromUrl(url.href)

    setIpaUrlDownloading(true)
    setIpaUrlError('')
    setIpaUrlProgress('Starting download...')
    addLog('info', `Downloading IPA through Sylva proxy: ${url.href}`)

    try {
      const proxiedUrl = new URL('/ipa', sylvaProxyBaseUrl)
      proxiedUrl.searchParams.set('url', url.href)
      let response = await fetch(proxiedUrl.href, { signal: controller.signal })
      if (response.status === 413) {
        addLog('warn', 'Remote IPA is over the proxy limit; using direct browser download path')
        setIpaUrlProgress('Proxy limit exceeded. Trying direct browser download...')
        response = await fetch(url.href, { signal: controller.signal })
      } else if (!response.ok) {
        throw new Error(await proxyErrorMessage(response))
      }

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}.`)
      }

      const type = response.headers.get('content-type') || 'application/octet-stream'
      const total = Number(response.headers.get('content-length') ?? 0)
      let blob: Blob

      if (response.body) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        while (true) {
          const { done, value: chunk } = await reader.read()
          if (done) break
          if (!chunk) continue
          chunks.push(chunk)
          received += chunk.byteLength
          setIpaUrlProgress(
            total > 0
              ? `Downloaded ${formatMetadataSize(received)} of ${formatMetadataSize(total)}`
              : `Downloaded ${formatMetadataSize(received)}`,
          )
        }
        blob = new Blob(
          chunks.map((chunk) => {
            const copy = new Uint8Array(chunk.byteLength)
            copy.set(chunk)
            return copy.buffer
          }),
          { type },
        )
      } else {
        blob = await response.blob()
      }

      if (blob.size === 0) throw new Error('The downloaded file is empty.')

      const file = new File([blob], fileName, {
        type: type || 'application/octet-stream',
        lastModified: Date.now(),
      })
      setIpa([file])
      setOutputs([])
      setState('idle')
      setConsoleActivity(null)
      setSignProgress({ value: 0, label: 'Waiting to sign' })
      setIpaUrlProgress(`Selected ${file.name} (${formatMetadataSize(file.size)})`)
      addLog('success', `Downloaded and selected IPA: ${file.name}`)
    } catch (error) {
      const message = readableDownloadError(error)
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setIpaUrlError(message)
        addLog('error', message)
      }
      setIpaUrlProgress('')
    } finally {
      if (ipaUrlAbortRef.current === controller) {
        ipaUrlAbortRef.current = null
      }
      setIpaUrlDownloading(false)
    }
  }, [addLog, ipaUrl])

  const handleCancelIpaUrlDownload = React.useCallback(() => {
    ipaUrlAbortRef.current?.abort()
  }, [])

  const addWorkerLog = React.useCallback(
    (line: string) => {
      const cleanLine = cleanLogLine(line).toLowerCase()
      if (cleanLine.includes('unzip ok') || cleanLine.includes('archive ok')) {
        setConsoleActivity(null)
      }
      if (cleanLine.includes('archiving:')) {
        setConsoleActivity({ label: 'Archiving signed IPA' })
      }
      const parsedMetadata = parseInstallMetadataLine(line)
      if (parsedMetadata) {
        installMetadataRef.current = { ...installMetadataRef.current, ...parsedMetadata }
        setInstallMetadata(installMetadataRef.current)
      }
      setSignProgress((current) => signingProgressForLine(line, current))
      addLog(logLevelFor(line), cleanLogLine(line))
    },
    [addLog],
  )

  const updateWorkerProgress = React.useCallback((progress: ZsignProgress) => {
    const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 1
    const percent = Math.round(ratio * 100)
    if (progress.phase === 'extract') {
      setConsoleActivity({ label: 'Unzipping IPA locally', percent })
      setSignProgress({ value: Math.round(10 + ratio * 15), label: 'Streaming IPA into browser storage' })
    } else {
      setConsoleActivity({ label: 'Compressing signed IPA', percent })
      setSignProgress({ value: Math.round(90 + ratio * 9), label: 'Compressing signed IPA' })
    }
  }, [])

  const saveCertCacheFromInputs = React.useCallback(async () => {
    const next: CachedCertInfo = {
      p12: p12[0] ? await fileToCachedData(p12[0]) : cachedCertInfo?.p12,
      profiles: profiles.length
        ? await Promise.all(profiles.map(fileToCachedData))
        : cachedCertInfo?.profiles ?? [],
      password: certPassword || cachedCertInfo?.password,
      savedAt: Date.now(),
    }

    if (!next.p12 && next.profiles.length === 0 && !next.password) return
    await writeCachedCertInfo(next)
    setCachedCertInfo(next)
  }, [cachedCertInfo, certPassword, p12, profiles])

  const handleClearCache = React.useCallback(async () => {
    await deleteCachedCertInfo()
    setCachedCertInfo(null)
    setCacheCert(false)
    setP12([])
    setProfiles([])
    setCertPassword('')
    addLog('success', 'Cached certificate information cleared')
  }, [addLog])

  const buildSignOptions = React.useCallback((): SignIpaOptions => {
    if (!ipa[0]) throw new Error('Choose an IPA before signing.')

    const cachedP12 = cachedCertInfo?.p12 ? cachedDataToFile(cachedCertInfo.p12) : undefined
    const cachedProfiles = cachedCertInfo?.profiles.map(cachedDataToFile) ?? []
    const selectedP12 = p12[0] ?? (cacheCert ? cachedP12 : undefined)
    const selectedProfiles = profiles.length > 0 ? profiles : cacheCert ? cachedProfiles : []

    if (!selectedP12) throw new Error('Choose a P12/PFX signing certificate.')
    if (selectedProfiles.length === 0) throw new Error('Choose at least one provisioning profile.')

    return {
      ipa: ipa[0],
      p12: selectedP12,
      profiles: selectedProfiles,
      dylibs,
      password: certPassword || (cacheCert ? cachedCertInfo?.password ?? '' : ''),
      outputName: outputName.trim() || defaultOutputName(ipa[0]),
      bundleId: bundleId.trim(),
      zipLevel: mobileMode ? 1 : 6,
      metadata: false,
    }
  }, [bundleId, cacheCert, cachedCertInfo, certPassword, dylibs, ipa, mobileMode, outputName, p12, profiles])

  const handleSign = async () => {
    if (!mobileMode) window.scrollTo({ top: 0, behavior: 'smooth' })
    setState('signing')
    setLogs([])
    setOutputs([])
    const initialMetadata = appMetadata
      ? {
          appName: appMetadata.appName,
          bundleId: bundleId.trim() || appMetadata.bundleId,
          version: appMetadata.version,
        }
      : {}
    setInstallMetadata(initialMetadata)
    installMetadataRef.current = initialMetadata
    setInstallDialogOpen(false)
    setCurrentHistoryId('')
    setConsoleActivity(null)
    setSignProgress({ value: 5, label: 'Starting local signing session' })

    addLog('step', 'Initializing local WebAssembly signing session')
    addLog('info', `Loaded payload: ${ipa[0]?.name ?? 'pending'}`)
    if (mobileMode) {
      addLog('warn', 'Mobile compatibility mode enabled: native archive operations may take longer')
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            consoleRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
            requestAnimationFrame(() => resolve())
          })
        })
      })
    }

    try {
      if (cacheCert) await saveCertCacheFromInputs()
      const result = await signIpa(buildSignOptions(), {
        onLog: addWorkerLog,
        onProgress: updateWorkerProgress,
        storageMode: mobileMode ? 'mobile-native' : 'memory',
      })

      setOutputs(result.outputs)
      if (result.exitCode === 0) {
        const signedOutput =
          result.outputs.find((output) => output.name.toLowerCase().endsWith('.ipa')) ??
          result.outputs[0]
        if (signedOutput) {
          const entry = createLocalHistoryEntry(
            signedOutput.name,
            installMetadataRef.current,
            appMetadata?.iconDataUrl && appMetadata.iconDataUrl.length <= 300_000
              ? appMetadata.iconDataUrl
              : undefined,
          )
          setCurrentHistoryId(entry.id)
          setHistoryEntries(upsertIpaHistoryEntry(entry))
        }
      }
      addLog(result.exitCode === 0 ? 'success' : 'error', `zsign exited with code ${result.exitCode}`)
      setSignProgress((current) => ({
        value: result.exitCode === 0 ? 100 : Math.max(current.value, 1),
        label: result.exitCode === 0 ? 'Signing complete' : 'Signing stopped',
      }))
      setState(result.exitCode === 0 ? 'done' : 'error')
      setConsoleActivity(null)
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : String(error))
      setSignProgress((current) => ({
        value: Math.max(current.value, 1),
        label: 'Signing failed',
      }))
      setState('error')
      setConsoleActivity(null)
    }
  }

  const handleDownload = () => {
    if (!firstOutput) return
    saveOutput(firstOutput)
    addLog('success', `Download started: ${firstOutput.name}`)
  }

  const handleClear = () => {
    setIpa([])
    setP12([])
    setProfiles([])
    setDylibs([])
    setOutputName('')
    setOutputNameTouched(false)
    setBundleId('')
    setOutputs([])
    setLogs([])
    setInstallMetadata({})
    installMetadataRef.current = {}
    setInstallDialogOpen(false)
    setCurrentHistoryId('')
    setSignProgress({ value: 0, label: 'Waiting to sign' })
    setConsoleActivity(null)
    if (!cacheCert) setCertPassword('')
    setState('idle')
  }

  return (
    <main className={`mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 py-8 md:px-8 md:py-12 ${mobileMode && state === 'signing' ? 'mobile-signing' : ''}`}>
      <header className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3.5">
          <div className="relative size-10 shrink-0 overflow-hidden rounded-xl shadow-sm sm:size-12 sm:rounded-2xl md:size-14">
            <img
              src="/icon-light.png"
              alt="Sylva Signer logo"
              className="size-full scale-[1.18] object-cover dark:hidden"
            />
            <img
              src="/icon-dark.png"
              alt=""
              aria-hidden
              className="hidden size-full scale-[1.18] object-cover dark:block"
            />
          </div>
          <div>
            <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight sm:text-xl md:text-2xl">
              Sylva Signer<span className="sr-only"> - Local iOS IPA Signer</span>
            </h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Fully local IPA signing in your browser
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setWelcomeOpen(true)}
            aria-label="About Sylva Signer"
            title="About Sylva Signer"
            className="size-9 px-0"
          >
            <Info size={16} />
          </Button>
          <AnimateIcon animateOnHover asChild>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHistoryEntries(readIpaHistory())
                setHistoryDialogOpen(true)
              }}
              aria-label="Previous IPAs"
              title="Previous IPAs"
              className="size-9 gap-2 px-0 sm:w-auto sm:px-2.5"
            >
              <ClipboardList size={16} />
              <span className="hidden sm:inline">Previous IPAs</span>
            </Button>
          </AnimateIcon>
          <a
            href="https://github.com/AntonP29/SylvaSigner"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Sylva Signer on GitHub"
            title="GitHub"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-muted hover:text-sky-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
          >
            <GithubIcon size={16} />
          </a>
          <ThemeToggle />
        </div>
      </header>

      <Separator className="my-8" />

      <PrivacySummary />

      {mobileMode && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-300">
          <AnimateIcon animate={state !== 'signing'} loop={state !== 'signing'} loopDelay={700}>
            <TriangleAlert size={19} className="mt-0.5 shrink-0" />
          </AnimateIcon>
          <div>
            <p className="text-sm font-medium">Mobile compatibility mode</p>
            <p className="mt-1 text-xs leading-5 opacity-80">
              Uses upstream zsign&apos;s slower native archive path to reduce browser memory
              duplication. Keep this tab active until signing and download finish.
            </p>
          </div>
        </div>
      )}

      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <AnimateIcon animateOnHover>
                <Layers
                  size={18}
                  className="text-muted-foreground transition-colors hover:text-blue-500"
                />
              </AnimateIcon>
              <h2 className="text-sm font-semibold tracking-tight">Inputs</h2>
            </div>

            <FileDrop
              id="ipa"
              label="IPA file"
              hint="Select or drop your .ipa"
              accept=".ipa,.zip"
              icon={Layers}
              hoverColor="group-hover:text-blue-500"
              files={ipa}
              onFiles={setIpa}
            />
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <Label htmlFor="ipa-url" className="text-xs font-medium text-foreground">
                IPA URL
              </Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="ipa-url"
                  type="url"
                  inputMode="url"
                  value={ipaUrl}
                  onChange={(event) => {
                    setIpaUrl(event.target.value)
                    setIpaUrlError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if (!ipaUrlDownloading && state !== 'signing') void handleDownloadIpaUrl()
                    }
                  }}
                  placeholder="https://example.com/app.ipa"
                  disabled={ipaUrlDownloading || state === 'signing'}
                  aria-invalid={Boolean(ipaUrlError)}
                />
                <Button
                  type="button"
                  variant={ipaUrlDownloading ? 'outline' : 'secondary'}
                  onClick={ipaUrlDownloading ? handleCancelIpaUrlDownload : handleDownloadIpaUrl}
                  disabled={state === 'signing' || (!ipaUrl.trim() && !ipaUrlDownloading)}
                  className="sm:w-32"
                >
                  {ipaUrlDownloading ? (
                    <LoaderCircle size={16} />
                  ) : (
                    <Download size={16} />
                  )}
                  {ipaUrlDownloading ? 'Cancel' : 'Import URL'}
                </Button>
              </div>
              {(ipaUrlProgress || ipaUrlError) && (
                <p
                  className={cn(
                    'mt-2 text-xs leading-5',
                    ipaUrlError ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {ipaUrlError || ipaUrlProgress}
                </p>
              )}
            </div>
            <FileDrop
              id="p12"
              label="Signing certificate (.p12)"
              hint="Select or drop your .p12"
              accept=".p12,.pfx"
              icon={BadgeCheck}
              hoverColor="group-hover:text-emerald-500"
              files={p12}
              onFiles={setP12}
            />
            <FileDrop
              id="profiles"
              label="Provisioning profile"
              hint="Select or drop .mobileprovision"
              accept=".mobileprovision,.provisionprofile"
              multiple
              icon={LockKeyhole}
              hoverColor="group-hover:text-amber-500"
              files={profiles}
              onFiles={setProfiles}
            />
            <FileDrop
              id="dylibs"
              label="Dylibs (optional)"
              hint="Select or drop .dylib files to inject"
              accept=".dylib"
              multiple
              icon={Blocks}
              hoverColor="group-hover:text-rose-500"
              files={dylibs}
              onFiles={setDylibs}
            />
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <AnimateIcon animateOnHover>
                <Key
                  size={18}
                  className="text-muted-foreground transition-colors hover:text-violet-500"
                />
              </AnimateIcon>
              <h2 className="text-sm font-semibold tracking-tight">
                Credentials &amp; Options
              </h2>
            </div>

            <div className="rounded-xl border border-border bg-muted/25 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AnimateIcon animateOnHover>
                      <BadgeCheck
                        size={18}
                        className="text-muted-foreground transition-colors hover:text-emerald-500"
                      />
                    </AnimateIcon>
                    <p className="text-sm font-medium">Public enterprise certificates</p>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Imports only NexCerts README entries currently marked signed. Public
                    enterprise certificates are third-party assets and may be revoked.
                  </p>
                </div>
                <AnimateIcon animate={publicCertsLoading} loop={publicCertsLoading} asChild>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadPublicCerts}
                    disabled={publicCertsLoading || Boolean(publicCertImportingId)}
                    className="gap-2 sm:self-start"
                  >
                    {publicCertsLoading ? <LoaderCircle size={16} /> : <Download size={16} />}
                    {publicCerts.length ? 'Refresh signed list' : 'Load signed list'}
                  </Button>
                </AnimateIcon>
              </div>

              {publicCertMessage && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{publicCertMessage}</p>
              )}

              {publicCerts.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {publicCerts.map((entry) => {
                    const importing = publicCertImportingId === entry.id
                    return (
                      <div
                        key={entry.id}
                        className="flex flex-col gap-3 rounded-lg border border-border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words text-sm font-medium">
                              {entry.company}
                            </p>
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-300">
                              Signed
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Valid {entry.validFrom} to {entry.validTo}
                          </p>
                          <a
                            href={entry.sourceTreeUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-xs text-sky-400 hover:text-sky-300 hover:underline"
                          >
                            View source files
                          </a>
                        </div>
                        <AnimateIcon animate={importing} loop={importing} asChild>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleImportPublicCert(entry)}
                            disabled={Boolean(publicCertImportingId) || publicCertsLoading}
                            className="gap-2 sm:self-center"
                          >
                            {importing ? <LoaderCircle size={16} /> : <Upload size={16} />}
                            {importing ? 'Importing...' : 'Import'}
                          </Button>
                        </AnimateIcon>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cert-password">Certificate password</Label>
              <Input
                id="cert-password"
                type="password"
                placeholder="Enter .p12 password"
                value={certPassword}
                onChange={(e) => setCertPassword(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="output-name">Output IPA name</Label>
                <Input
                  id="output-name"
                  placeholder="e.g. my-app-signed.ipa"
                  value={outputName}
                  onChange={(e) => {
                    setOutputNameTouched(true)
                    setOutputName(e.target.value)
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bundle-id" className="flex items-center gap-1.5">
                  <Fingerprint size={14} className="text-muted-foreground" />
                  Bundle ID
                </Label>
                <Input
                  id="bundle-id"
                  placeholder="Detected from IPA"
                  value={bundleId}
                  onChange={(e) => setBundleId(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <AnimateIcon animateOnHover asChild>
                <label
                  htmlFor="cache-cert"
                  className="group flex flex-1 cursor-pointer items-center gap-3"
                >
                  <Fingerprint
                    size={20}
                    className="text-muted-foreground transition-colors group-hover:text-cyan-500"
                  />
                  <div>
                    <p className="text-sm font-medium">Cache certificate locally</p>
                    <p className="text-xs text-muted-foreground">
                      Remember signing assets in this browser
                    </p>
                  </div>
                </label>
              </AnimateIcon>
              <Switch
                id="cache-cert"
                checked={cacheCert}
                onCheckedChange={setCacheCert}
              />
            </div>

            {hasCache && (
              <AnimateIcon animateOnHover asChild>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearCache}
                  className="w-fit gap-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={16} />
                  Forget cached certificate
                </Button>
              </AnimateIcon>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <AnimateIcon
              animate={state === 'signing' && !mobileMode}
              animateOnHover
              loop={state === 'signing' && !mobileMode}
              asChild
            >
              <Button
                id="sign-button"
                size="lg"
                onClick={handleSign}
                disabled={!canSign}
                className="h-11 gap-2 px-5"
              >
                {state === 'signing' ? (
                  <LoaderCircle size={18} animate={!mobileMode} loop={!mobileMode} />
                ) : (
                  <Send size={18} />
                )}
                {state === 'signing' ? 'Signing...' : 'Sign IPA'}
              </Button>
            </AnimateIcon>

            <AnimateIcon animateOnHover asChild>
              <Button
                size="lg"
                variant="outline"
                onClick={handleDownload}
                disabled={outputs.length === 0}
                className="h-11 gap-2 px-5"
              >
                <Download size={18} />
                Download
              </Button>
            </AnimateIcon>

            <AnimateIcon animateOnHover asChild>
              <Button
                size="lg"
                variant="ghost"
                onClick={handleClear}
                className="h-11 gap-2 px-5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={18} />
                Clear
              </Button>
            </AnimateIcon>
          </div>

          {(state === 'signing' || state === 'done' || state === 'error') && (
            <ProgressBar progress={signProgress} />
          )}

          <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Large IPAs can be slow because unzipping, signing, and re-archiving happen
            locally. Keep this tab open and ensure the device has several times the IPA
            size available as free memory. Installation hosting uploads the signed IPA
            only after you confirm.
          </p>
        </div>

        <div className="flex min-h-[420px] min-w-0 flex-col lg:min-h-0">
          {ipa[0] && (
            <AppDetailsTile
              ipa={ipa[0]}
              dylibs={dylibs}
              dylibMetadata={dylibMetadata}
              dylibMetadataLoading={dylibMetadataLoading}
              dylibMetadataErrors={dylibMetadataErrors}
              app={appMetadata}
              appLoading={appMetadataLoading}
              appError={appMetadataError}
              certificate={certificateMetadata}
              certificateFile={p12[0]}
              certificateMessage={certificateMessage}
              profiles={profileMetadata}
            />
          )}
          <div
            ref={consoleRef}
            data-testid="signing-console"
            className="h-[420px] max-h-[520px] scroll-mt-4 lg:h-[calc(100vh-12rem)] lg:max-h-[680px]"
          >
            <LogConsole
              logs={logs}
              active={state === 'signing' && !mobileMode}
              activity={consoleActivity}
            />
          </div>

          {state === 'done' && outputs.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
              <CircleCheckBig size={20} animate />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Signing complete</p>
                <p className="truncate text-xs opacity-80">
                  {outputs[0]?.name ?? outputName} is ready to download
                </p>
              </div>
              <AnimateIcon animateOnHover asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInstallDialogOpen(true)}
                  className="gap-2 border-emerald-500/30 bg-background/70 text-foreground hover:bg-background"
                >
                  <Send size={16} />
                  {directInstallOnDevice ? 'Install on iPhone' : 'Install QR'}
                </Button>
              </AnimateIcon>
            </div>
          )}

          {outputs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-sm font-medium">Signed output</p>
              {outputs.map((output) => (
                <button
                  key={output.path}
                  type="button"
                  onClick={() => saveOutput(output)}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 truncate">{output.name}</span>
                  <Download size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <SigningGuideAndFaq />

      {installDialogOpen && firstOutput && (
        <InstallQrDialog
          output={firstOutput}
          initialMetadata={installMetadata}
          directInstall={directInstallOnDevice}
          onClose={() => setInstallDialogOpen(false)}
          onLog={(message) => addLog(logLevelFor(message), message)}
          onUploaded={(result, expiry) => {
            if (!currentHistoryId) return
            setHistoryEntries(updateHistoryEntryUpload(currentHistoryId, result, expiry))
          }}
        />
      )}

      {historyDialogOpen && (
        <PreviousIpasDialog
          entries={historyEntries}
          directInstall={directInstallOnDevice}
          onClose={() => setHistoryDialogOpen(false)}
          onClear={() => {
            clearIpaHistory()
            setHistoryEntries([])
          }}
        />
      )}

      {welcomeOpen && (
        <WelcomeDialog onClose={() => setWelcomeOpen(false)} />
      )}

      <LegalFooter />
    </main>
  )
}

export function SylvaSigner({ initialRoute }: { initialRoute?: SylvaRoute } = {}) {
  const route = useRoute(initialRoute)
  const mobile = isMobileBrowser()

  if (route === 'privacy' || route === 'legal') {
    return <InfoPage route={route} />
  }

  return <SignerApp mobileMode={mobile} />
}
