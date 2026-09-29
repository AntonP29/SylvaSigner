import type { InstallMetadata, LitterboxExpiry, TemporaryInstallResult, UploadProvider } from '@/install-api'

export type IpaHistoryEntry = {
  id: string
  name: string
  signedAt: string
  metadata?: Partial<InstallMetadata>
  provider?: UploadProvider
  uploadExpiry?: LitterboxExpiry | 'permanent'
  uploadedAt?: string
  expiresAt?: string
  ipaUrl?: string
  manifestUrl?: string
  installUrl?: string
  iconDataUrl?: string
}

const historyKey = 'sylva-signer-ipa-history'
const maxHistoryEntries = 30

export function readIpaHistory(): IpaHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey)
    if (!raw) return []
    const entries = JSON.parse(raw) as IpaHistoryEntry[]
    if (!Array.isArray(entries)) return []
    return entries
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
      .slice(0, maxHistoryEntries)
  } catch {
    return []
  }
}

export function writeIpaHistory(entries: IpaHistoryEntry[]) {
  localStorage.setItem(historyKey, JSON.stringify(entries.slice(0, maxHistoryEntries)))
}

export function createLocalHistoryEntry(
  name: string,
  metadata: Partial<InstallMetadata>,
  iconDataUrl?: string,
): IpaHistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    signedAt: new Date().toISOString(),
    metadata,
    iconDataUrl,
  }
}

export function upsertIpaHistoryEntry(entry: IpaHistoryEntry) {
  const entries = readIpaHistory()
  const nextEntries = [entry, ...entries.filter((item) => item.id !== entry.id)]
  writeIpaHistory(nextEntries)
  return nextEntries
}

function expiryToMilliseconds(expiry: LitterboxExpiry) {
  if (expiry === '1h') return 60 * 60 * 1000
  if (expiry === '12h') return 12 * 60 * 60 * 1000
  if (expiry === '24h') return 24 * 60 * 60 * 1000
  return 72 * 60 * 60 * 1000
}

export function updateHistoryEntryUpload(
  id: string,
  result: TemporaryInstallResult,
  expiry?: LitterboxExpiry,
  provider: UploadProvider = 'litterbox',
): IpaHistoryEntry[] {
  const entries = readIpaHistory()
  const uploadedAt = Date.now()
  const nextEntries: IpaHistoryEntry[] = entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          provider,
          uploadExpiry: (provider === 'catbox' ? 'permanent' : (expiry ?? '1h')) as
            | LitterboxExpiry
            | 'permanent',
          uploadedAt: new Date(uploadedAt).toISOString(),
          expiresAt:
            provider === 'catbox'
              ? undefined
              : new Date(uploadedAt + expiryToMilliseconds(expiry ?? '1h')).toISOString(),
          ipaUrl: result.ipaUrl,
          manifestUrl: result.manifestUrl,
          installUrl: result.installUrl,
        }
      : entry,
  )
  writeIpaHistory(nextEntries)
  return nextEntries
}

export function clearIpaHistory() {
  localStorage.removeItem(historyKey)
}
