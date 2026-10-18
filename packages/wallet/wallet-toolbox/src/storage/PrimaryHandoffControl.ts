import type { AuthId } from '../sdk/WalletStorage.interfaces'

/** Comparison/control metadata only. These values never carry a SQL writer,
 * source actor, primary grant or financial acknowledgement across a wire. */
export interface PrimaryHandoffSource {
  storageIdentityKey: string
  epoch: string
}
export interface PrimaryHandoffPlan {
  version: 1
  operationId: string
  targetStorageIdentityKey: string
  sources: readonly PrimaryHandoffSource[]
}
export interface PrimaryHandoffStatus {
  version: 1
  operationId: string
  localStorageIdentityKey: string
  targetStorageIdentityKey: string
  side: 'source' | 'target'
  phase: 'prepared' | 'retired'
  localEpoch: string
  sourceEpoch?: string
  plan?: PrimaryHandoffPlan
}
/** Durable preparation/retirement. Target activation is deliberately a separate
 * integration: it must verify actual final target financial receipts, not DATA
 * claiming that a source retired or a copy completed. */
export interface PrimaryHandoffControl {
  status: (auth: AuthId) => Promise<PrimaryHandoffStatus | undefined>
  prepareSource: (auth: AuthId, operationId: string, targetStorageIdentityKey: string) => Promise<PrimaryHandoffSource>
  prepareTarget: (auth: AuthId, plan: PrimaryHandoffPlan) => Promise<PrimaryHandoffStatus>
  retireSource: (auth: AuthId, plan: PrimaryHandoffPlan) => Promise<PrimaryHandoffStatus>
}
