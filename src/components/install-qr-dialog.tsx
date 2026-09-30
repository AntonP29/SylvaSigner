'use client'

import * as React from 'react'

import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { CircleCheckBig } from '@/components/animate-ui/icons/circle-check-big'
import { Download } from '@/components/animate-ui/icons/download'
import { LoaderCircle } from '@/components/animate-ui/icons/loader-circle'
import { Send } from '@/components/animate-ui/icons/send'
import { TriangleAlert } from '@/components/animate-ui/icons/triangle-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  createInstallUrls,
  catboxMaxFileSize,
  litterboxMaxFileSize,
  type InstallMetadata,
  type LitterboxExpiry,
  type TemporaryInstallResult,
  type UploadProgress,
  type UploadProvider,
  type UploadTransfer,
  uploadSignedIpaToCatbox,
  uploadSignedIpaToLitterbox,
} from '@/install-api'
import type { OutputFile } from '@/types'

type InstallQrDialogProps = {
  output: OutputFile
  initialMetadata: Partial<InstallMetadata>
  onClose: () => void
  directInstall?: boolean
  onLog?: (message: string) => void
  onUploaded?: (
    result: TemporaryInstallResult,
    expiry?: LitterboxExpiry,
    provider?: UploadProvider,
  ) => void
}

type UploadState = 'idle' | 'uploading' | 'preparing' | 'ready' | 'error'

function metadataValue(value: string | undefined, fallback: string) {
  return value?.trim() || fallback
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function InstallQrDialog({
  output,
  initialMetadata,
  onClose,
  directInstall = false,
  onLog,
  onUploaded,
}: InstallQrDialogProps) {
  const [appName, setAppName] = React.useState(() =>
    metadataValue(initialMetadata.appName, output.name.replace(/\.ipa$/i, '')),
  )
  const [bundleId, setBundleId] = React.useState(() =>
    metadataValue(initialMetadata.bundleId, ''),
  )
  const [version, setVersion] = React.useState(() =>
    metadataValue(initialMetadata.version, '1'),
  )
  const [expiry, setExpiry] = React.useState<LitterboxExpiry>('1h')
  const [useCatbox, setUseCatbox] = React.useState(false)
  const [showLimitations, setShowLimitations] = React.useState(false)
  const [state, setState] = React.useState<UploadState>('idle')
  const [error, setError] = React.useState('')
  const [result, setResult] = React.useState<TemporaryInstallResult | null>(null)
  const [qrDataUrl, setQrDataUrl] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState<UploadProgress | null>(null)
  const [uploadTransfer, setUploadTransfer] = React.useState<UploadTransfer | null>(null)
  const uploadController = React.useRef<AbortController | null>(null)
  const busy = state === 'uploading' || state === 'preparing'

  React.useEffect(() => () => uploadController.current?.abort(), [])

  const outputSize = output.data instanceof Blob ? output.data.size : output.data.byteLength
  const exceedsCatboxLimit = useCatbox && outputSize > catboxMaxFileSize
  const exceedsLitterboxLimit = !useCatbox && outputSize > litterboxMaxFileSize

  const canUpload = Boolean(
    !busy &&
      appName.trim() &&
      bundleId.trim() &&
      version.trim() &&
      !exceedsCatboxLimit &&
      !exceedsLitterboxLimit,
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handlePrepareInstall = async () => {
    const controller = new AbortController()
    uploadController.current = controller
    setState('uploading')
    setError('')
    setCopied(false)
    setResult(null)
    setQrDataUrl('')
    setUploadProgress(null)
    setUploadTransfer(null)

    const startTransfer = (transfer: UploadTransfer) => {
      setUploadTransfer(transfer)
      setUploadProgress(transfer.transport === 'proxy'
        ? { loaded: 0, total: outputSize, percent: 0 }
        : null)
    }

    try {
      await waitForPaint()
      let ipaUrl: string
      if (useCatbox) {
        onLog?.('Uploading signed IPA to Catbox (permanent backup)...')
        ipaUrl = await uploadSignedIpaToCatbox(output, {
          onProgress: setUploadProgress,
          onProgressReset: () => setUploadProgress(null),
          onTransfer: startTransfer,
          onLog,
          signal: controller.signal,
        })
      } else {
        onLog?.(`Uploading signed IPA to Litterbox for ${expiry}`)
        ipaUrl = await uploadSignedIpaToLitterbox(output, expiry, {
          onProgress: setUploadProgress,
          onProgressReset: () => setUploadProgress(null),
          onTransfer: startTransfer,
          onLog,
          signal: controller.signal,
        })
      }
      setState('preparing')
      setUploadProgress(null)
      onLog?.('Signed IPA uploaded successfully. Preparing the installation manifest...')
      const nextResult = await createInstallUrls(
        {
          appName: appName.trim(),
          bundleId: bundleId.trim(),
          version: version.trim(),
        },
        ipaUrl,
        controller.signal,
      )
      onLog?.(
        nextResult.manifestProvider === 'palera'
          ? 'Palera installation manifest is ready'
          : 'Palera unavailable; using Sylva backup manifest',
      )
      let nextQr = ''
      if (!directInstall) {
        const QRCode = await import('qrcode')
        nextQr = await QRCode.toDataURL(nextResult.installUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            scale: 8,
            color: {
              dark: '#111827',
              light: '#ffffff',
            },
          })
      }

      if (controller.signal.aborted) throw new Error('Installation preparation was cancelled.')
      setResult(nextResult)
      setQrDataUrl(nextQr)
      setState('ready')
      onUploaded?.(
        nextResult,
        useCatbox ? undefined : expiry,
        useCatbox ? 'catbox' : 'litterbox',
      )
      onLog?.(
        directInstall
          ? 'Direct iPhone installation link is ready'
          : `Install QR generated from ${useCatbox ? 'permanent Catbox' : 'temporary Litterbox'} HTTPS IPA URL`,
      )
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError)
      setError(message)
      setState('error')
      onLog?.(`Installation preparation failed: ${message}`)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.installUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
    >
      <div
        className={`flex max-h-[min(92svh,760px)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${directInstall ? 'max-w-lg' : 'max-w-2xl'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <AnimateIcon animate loop loopDelay={350}>
              <TriangleAlert size={28} className="text-yellow-500" />
            </AnimateIcon>
            <div>
              <h2 id="install-title" className="text-lg font-semibold">
                {directInstall ? 'Install on iPhone' : 'Install with QR'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {useCatbox
                  ? 'Permanently host the signed IPA on Catbox so iOS can fetch it over HTTPS.'
                  : 'Temporarily host the signed IPA so iOS can fetch it over HTTPS.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div
          className={`grid min-h-0 gap-5 overflow-y-auto p-5 ${directInstall ? '' : 'md:grid-cols-[minmax(0,1fr)_240px]'}`}
        >
          <div className={`min-w-0 space-y-4 ${directInstall && result ? 'hidden' : ''}`}>
            <button
              type="button"
              onClick={() => setShowLimitations((value) => !value)}
              className="w-full rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-left text-sm text-yellow-700 transition-colors hover:bg-yellow-500/15 dark:text-yellow-300"
            >
              <span className="font-medium">
                {useCatbox
                  ? 'The signed IPA will be permanently backed up to Catbox.'
                  : 'Only the signed IPA is uploaded for temporary install.'}
              </span>{' '}
              <span className="underline underline-offset-4">
                {showLimitations ? 'Hide limitations' : 'View limitations'}
              </span>
            </button>

            <p className="text-xs leading-5 text-muted-foreground">
              {useCatbox
                ? 'Large signed IPAs may take a while to upload. Keep this tab open until the installation link is ready. Catbox accepts files up to 200 MB.'
                : 'Large signed IPAs may take a while to upload. Keep this tab open until the installation link is ready. Litterbox accepts files up to 1 GB.'}
            </p>

            {showLimitations && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm leading-6 text-muted-foreground">
                <p>
                  {directInstall ? 'Direct installation' : 'QR installation'} is not fully
                  local. Your certificate, provisioning
                  profile, and password stay in this browser, but the signed IPA
                  is uploaded to {useCatbox ? 'Catbox (permanent public link)' : 'Litterbox (public until it expires)'}.
                </p>
                <p className="mt-2">
                  Install success depends on {useCatbox ? 'Catbox' : 'Litterbox'}, Palera&apos;s manifest generator
                  (with the Sylva Worker as backup), Apple OTA behavior, and a certificate trusted
                  by the iPhone. Catbox accepts files up to 200 MB and stores them permanently;
                  Litterbox accepts files up to 1 GB and deletes them after the chosen duration.
                  Some networks or regions may block Catbox/Litterbox.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="install-app-name">App name</Label>
                <Input
                  id="install-app-name"
                  value={appName}
                  onChange={(event) => setAppName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="install-version">Version</Label>
                <Input
                  id="install-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="install-bundle-id">Bundle ID</Label>
              <Input
                id="install-bundle-id"
                placeholder="com.example.app"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3.5">
              <div className="space-y-0.5 pr-2">
                <label
                  htmlFor="install-backup-toggle"
                  className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2"
                >
                  <span>Permanent backup (Catbox)</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  {useCatbox
                    ? 'Permanent hosting via Catbox — link never expires (max 200 MB)'
                    : 'Temporary hosting via Litterbox — expires automatically (max 1 GB)'}
                </p>
              </div>
              <Switch
                id="install-backup-toggle"
                checked={useCatbox}
                onCheckedChange={setUseCatbox}
              />
            </div>

            {exceedsCatboxLimit && (
              <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs leading-5 text-yellow-700 dark:text-yellow-300">
                This signed IPA ({(outputSize / (1024 * 1024)).toFixed(1)} MB) exceeds Catbox&apos;s 200 MB limit. Toggle backup off to use Litterbox (up to 1 GB).
              </p>
            )}

            {exceedsLitterboxLimit && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs leading-5 text-destructive">
                This signed IPA ({(outputSize / (1024 * 1024)).toFixed(1)} MB) exceeds Litterbox&apos;s 1 GB limit. Choose a smaller IPA.
              </p>
            )}

            {busy && (
              <div
                className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3"
                role="status"
                aria-live="polite"
                data-testid="install-upload-progress"
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{state === 'preparing' ? 'Preparing installation link'
                    : uploadTransfer?.attempt === 2 ? `Retrying upload to ${useCatbox ? 'Catbox' : 'Litterbox'}`
                    : uploadProgress?.percent === 100 ? `Waiting for ${useCatbox ? 'Catbox' : 'Litterbox'} to finish`
                    : useCatbox ? 'Backing up signed IPA to Catbox' : 'Uploading signed IPA'}</span>
                  {uploadProgress && <span>{uploadProgress.percent}%</span>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div
                    key={`${uploadTransfer?.transport}-${uploadTransfer?.attempt}-${state}`}
                    className={
                      uploadProgress
                        ? 'h-full rounded-full bg-yellow-500 transition-[width]'
                        : 'upload-progress-indeterminate h-full w-1/3 rounded-full bg-yellow-500'
                    }
                    style={uploadProgress ? { width: `${uploadProgress.percent}%` } : undefined}
                  />
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {state === 'preparing' ? 'Upload complete. Preparing the installation link...'
                    : uploadTransfer?.attempt === 2
                    ? 'The first attempt failed. Uploading the file again.'
                    : uploadProgress
                    ? uploadProgress.percent === 100
                      ? `File sent. Waiting for ${useCatbox ? 'Catbox' : 'Litterbox'} to return the download link.`
                      : `Keep this tab open while the file is sent to ${useCatbox ? 'Catbox' : 'Litterbox'}.`
                    : 'Keep Sylva open until the upload finishes.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => uploadController.current?.abort()}
                >
                  {state === 'preparing' ? 'Cancel preparation' : 'Cancel upload'}
                </Button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-2">
                <Label htmlFor="install-expiry">
                  {useCatbox ? 'Host retention' : 'Temporary host duration'}
                </Label>
                {useCatbox ? (
                  <div
                    id="install-expiry"
                    className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm"
                  >
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      Permanent (Catbox)
                    </span>
                  </div>
                ) : (
                  <select
                    id="install-expiry"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value as LitterboxExpiry)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="1h">1 hour</option>
                    <option value="12h">12 hours</option>
                    <option value="24h">24 hours</option>
                    <option value="72h">72 hours</option>
                  </select>
                )}
              </div>

              {directInstall ? (
                <Button
                  type="button"
                  onClick={handlePrepareInstall}
                  disabled={!canUpload}
                  aria-busy={busy}
                  className="mt-auto h-11 w-full gap-2 sm:w-auto"
                >
                  {busy ? (
                    <LoaderCircle size={16} animate loop />
                  ) : (
                    <Send size={16} />
                  )}
                  {state === 'preparing' ? 'Preparing installation link...'
                    : state === 'uploading'
                    ? useCatbox
                      ? 'Backing up to Catbox...'
                      : 'Uploading signed IPA...'
                    : useCatbox
                      ? 'Backup & Install'
                      : 'Prepare Installation'}
                </Button>
              ) : (
                <AnimateIcon
                  animate={busy}
                  loop={busy}
                  animateOnHover
                  asChild
                >
                  <Button
                    type="button"
                    onClick={handlePrepareInstall}
                    disabled={!canUpload}
                    className="mt-auto h-9 gap-2"
                  >
                    {busy ? (
                      <LoaderCircle size={16} animate loop />
                    ) : (
                      <Send size={16} />
                    )}
                    {state === 'preparing' ? 'Preparing installation link...'
                      : state === 'uploading'
                      ? useCatbox
                        ? 'Backing up...'
                        : 'Uploading...'
                      : useCatbox
                        ? 'Backup & Create QR'
                        : 'Create QR'}
                  </Button>
                </AnimateIcon>
              )}
            </div>

            {error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            {result && !directInstall && (
              <div className="min-w-0 space-y-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                <div className="min-w-0">
                  <p className="font-medium text-foreground/80">IPA URL</p>
                  <div className="mt-1 max-w-full overflow-x-auto rounded-lg bg-background px-2 py-1 font-mono">
                    <span className="whitespace-nowrap">{result.ipaUrl}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground/80">Manifest</p>
                  <div className="mt-1 max-w-full overflow-x-auto rounded-lg bg-background px-2 py-1 font-mono">
                    <span className="whitespace-nowrap">{result.manifestUrl}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {directInstall && result && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <CircleCheckBig size={30} animate className="text-emerald-500" />
              <div>
                <p className="font-medium text-foreground">Installation is ready</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Tap below to hand the temporary HTTPS manifest to iOS.
                </p>
              </div>
              <a
                href={result.installUrl}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Send size={17} />
                Install on iPhone
              </a>
              <p className="text-xs leading-5 text-muted-foreground">
                iOS may ask you to confirm installation. Keep Sylva open until that prompt
                appears.
              </p>
            </div>
          )}

          {!directInstall && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background p-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Install QR code"
                className="size-52 rounded-lg bg-white p-2"
              />
            ) : (
              <div className="flex size-52 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center text-sm text-muted-foreground">
                QR appears after upload
              </div>
            )}

            <div className="flex w-full flex-col gap-2">
              <AnimateIcon animateOnHover asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!result}
                  onClick={handleCopy}
                  className="w-full gap-2"
                >
                  <Download size={16} />
                  {copied ? 'Copied' : 'Copy Install Link'}
                </Button>
              </AnimateIcon>

              <AnimateIcon animateOnHover asChild>
                <a
                  href={result?.installUrl ?? '#'}
                  className={
                    result
                      ? 'inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
                      : 'pointer-events-none inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium text-primary-foreground opacity-50'
                  }
                >
                  <Send size={16} />
                  Open on iPhone
                </a>
              </AnimateIcon>
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
