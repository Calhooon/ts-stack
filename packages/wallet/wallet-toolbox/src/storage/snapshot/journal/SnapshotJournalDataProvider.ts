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
export interface SnapshotJournalArchiveProvider {
  supportsSnapshotJournalArchive: () => Promise<boolean>
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
