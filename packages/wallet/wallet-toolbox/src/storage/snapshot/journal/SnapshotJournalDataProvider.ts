import type { SnapshotSyncContentRevision } from '../SnapshotSyncContentRevision'
import type { SnapshotJournalDataContentReceipt } from './SnapshotJournalDataContentReceipt'
import type {
  SnapshotJournalWriterAdmission,
  SnapshotJournalDestinationLimits,
  SnapshotJournalReconciliationSource
} from './SnapshotJournalProvider'
import type { SnapshotJournalArchiveBinding } from './SnapshotJournalArchiveBinding'
import type { SnapshotJournalArchivePosition } from './SnapshotJournalReceiptData'
import type { RemoteSnapshotJournalArchive } from './openRemoteSnapshotJournalArchive'
import type { SnapshotJournalDataStatus } from './SnapshotJournalDataProtocol'
import type { SnapshotJournalDataDestination } from './runSnapshotJournalArchiveReconciliation'
import type { WalletReadSnapshotOptions } from '../WalletReadSnapshot'

/** Local scheduling CODE is never serialized or accepted as a remote grant. */
export interface SnapshotJournalDataOptions {
  admission?: SnapshotJournalWriterAdmission
  signal?: AbortSignal
}
export interface SnapshotJournalDataProvider {
  readonly journalDataCommitOutsideManager?: true
  supportsSnapshotJournalDataSync: () => Promise<boolean>
  getSnapshotJournalDataStatus: (
    identityKey: string,
    sourceStorageIdentity: string,
    options?: SnapshotJournalDataOptions
  ) => Promise<SnapshotJournalDataStatus | undefined>
  openSnapshotJournalDataDestination: (
    identityKey: string,
    source: SnapshotJournalArchiveBinding,
    options?: SnapshotJournalDataOptions
  ) => Promise<SnapshotJournalDataDestination | undefined>
}
export interface SnapshotJournalDataContentProvider extends SnapshotJournalDataProvider {
  supportsSnapshotJournalDataContent: () => Promise<boolean>
  getSnapshotJournalDataContentReceipt: (
    identityKey: string,
    sourceStorageIdentity: string,
    options?: SnapshotJournalDataOptions
  ) => Promise<Readonly<SnapshotJournalDataContentReceipt> | undefined>
  confirmSnapshotJournalDataContentReceipt: (
    identityKey: string,
    sourceStorageIdentity: string,
    revision: SnapshotSyncContentRevision,
    options?: SnapshotJournalDataOptions
  ) => Promise<Readonly<SnapshotJournalDataContentReceipt> | undefined>
}
/** Optional actual-local primary-aware comparison. This is not an RPC
 * capability, primary grant or selection operation. */
export interface SnapshotJournalPrimaryContentProvider extends SnapshotJournalDataContentProvider {
  confirmSnapshotJournalPrimaryContentReceipt: (
    identityKey: string,
    sourceStorageIdentity: string,
    revision: SnapshotSyncContentRevision,
    activeStorage: string | null,
    options?: SnapshotJournalDataOptions
  ) => Promise<Readonly<SnapshotJournalDataContentReceipt> | undefined>
}
export function snapshotJournalPrimaryContentProvider(value: unknown): value is SnapshotJournalPrimaryContentProvider {
  return (
    snapshotJournalDataContentProvider(value) &&
    typeof (value as Partial<SnapshotJournalPrimaryContentProvider>).confirmSnapshotJournalPrimaryContentReceipt ===
      'function'
  )
}
export function snapshotJournalDataContentProvider(value: unknown): value is SnapshotJournalDataContentProvider {
  const provider = value as Partial<SnapshotJournalDataContentProvider> | null
  return (
    provider != null &&
    typeof provider.supportsSnapshotJournalDataContent === 'function' &&
    typeof provider.getSnapshotJournalDataContentReceipt === 'function' &&
    typeof provider.confirmSnapshotJournalDataContentReceipt === 'function'
  )
}
export interface SnapshotJournalArchiveProvider {
  supportsSnapshotJournalArchive: () => Promise<boolean>
  supportsSnapshotJournalArchiveContent?: () => Promise<boolean>
  openSnapshotJournalArchive: (
    identityKey: string,
    position?: SnapshotJournalArchivePosition,
    options?: WalletReadSnapshotOptions
  ) => Promise<RemoteSnapshotJournalArchive | undefined>
}
export function snapshotJournalDataProvider(value: unknown): value is SnapshotJournalDataProvider {
  const provider = value as Partial<SnapshotJournalDataProvider> | null
  return (
    provider != null &&
    typeof provider.supportsSnapshotJournalDataSync === 'function' &&
    typeof provider.getSnapshotJournalDataStatus === 'function' &&
    typeof provider.openSnapshotJournalDataDestination === 'function'
  )
}
export function snapshotJournalArchiveProvider(value: unknown): value is SnapshotJournalArchiveProvider {
  const provider = value as Partial<SnapshotJournalArchiveProvider> | null
  return (
    provider != null &&
    typeof provider.supportsSnapshotJournalArchive === 'function' &&
    typeof provider.openSnapshotJournalArchive === 'function'
  )
}
export type { SnapshotJournalDestinationLimits, SnapshotJournalReconciliationSource }
