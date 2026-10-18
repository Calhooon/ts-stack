import type { TrxToken } from '../sdk/WalletStorage.interfaces'

/** @internal A captured operation's restrictions, never a serialized authority.
 * No SQL transaction or manager ownership is retained between calls. Callers
 * prepare transport/proofs outside transaction(), then commit only SQL work.
 * A supported provider compares its actual durable primary epoch on every
 * transaction, including the final pre-commit check. Older providers retain
 * their existing serialized contract through the default implementation.
 */
export interface StorageActiveWrite {
  transaction: <T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken) => Promise<T>
  assertCurrent: () => Promise<void>
}
