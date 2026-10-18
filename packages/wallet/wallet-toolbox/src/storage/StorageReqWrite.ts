import type { StorageProvider } from './StorageProvider'
import type { StorageActiveWrite } from './StorageActiveWrite'
import type { TrxToken } from '../sdk/WalletStorage.interfaces'
import type { TransactionStatus } from '../sdk/types'
import { EntityProvenTxReq } from './schema/entities/EntityProvenTxReq'
import { WalletError } from '../sdk/WalletError'
import { WERR_NOT_ACTIVE, WERR_UNAUTHORIZED } from '../sdk/WERR_errors'
import { verifyOne } from '../utility/utilityHelpers'

/** @internal Captures real participating profiles before asynchronous work.
 * A request is shared cache data; its notification IDs never authorize another
 * user's financial writes. No SQL connection survives any callback here.
 */
export class StorageReqWrite {
  private readonly profiles = new Map<number, StorageActiveWrite | undefined>()
  private readonly transactions = new Map<string, Map<number, number[]>>()

  private constructor(
    private readonly storage: StorageProvider,
    private readonly actor?: { userId: number; write: StorageActiveWrite }
  ) {}

  static async capture(
    storage: StorageProvider,
    txids: string[],
    actor?: { userId: number; write: StorageActiveWrite }
  ): Promise<StorageReqWrite> {
    const captured = new StorageReqWrite(storage, actor)
    for (const txid of new Set(txids)) {
      const users = new Map<number, number[]>()
      const rows = await storage.findTransactions({ partial: { txid }, noRawTx: true })
      for (const row of rows) {
        const ids = users.get(row.userId) ?? []
        ids.push(row.transactionId)
        users.set(row.userId, ids)
        if (captured.profiles.has(row.userId)) continue
        if (row.userId === actor?.userId) {
          captured.profiles.set(row.userId, actor.write)
          continue
        }
        const user = verifyOne(await storage.findUsers({ partial: { userId: row.userId } }))
        try {
          captured.profiles.set(row.userId, await storage.activeWriteTransaction(user))
        } catch (error) {
          if (!isObsolete(error)) throw error
          // Keep the absent capture: an inactive profile cannot become eligible
          // by being freshly captured after an observation or network reply.
          captured.profiles.set(row.userId, undefined)
        }
      }
      captured.transactions.set(txid, users)
    }
    return captured
  }

  assertRequests(reqs: EntityProvenTxReq[]): void {
    if (this.actor == null) return
    for (const req of reqs) {
      if (!this.transactions.get(req.txid)?.has(this.actor.userId))
        throw new WERR_UNAUTHORIZED('The proof request does not belong to the authenticated wallet')
    }
  }

  async assertCurrent(): Promise<void> {
    if (this.actor != null) return await this.actor.write.assertCurrent()
    if (this.profiles.size === 0) return // Cache-only orphan; no financial owner.
    for (const write of this.profiles.values()) {
      if (write == null) continue
      try {
        await write.assertCurrent()
        return
      } catch (error) {
        if (!isObsolete(error)) throw error
      }
    }
    throw new WERR_NOT_ACTIVE('No captured participating wallet profile is still active')
  }

  async forUser(userId: number, apply: (trx: TrxToken) => Promise<void>): Promise<boolean> {
    const write = this.profiles.get(userId)
    if (write == null) return false
    try {
      await write.transaction(apply)
      return true
    } catch (error) {
      if (!isObsolete(error)) throw error
      return false
    }
  }

  /** Refresh under the actual writable row lock. Late history/notification
   * additions survive; callbacks must mutate this fresh entity, not a snapshot.
   * An authenticated operation can never borrow another profile's authority.
   */
  async request(
    req: EntityProvenTxReq,
    apply: (current: EntityProvenTxReq, trx: TrxToken) => Promise<void>
  ): Promise<boolean> {
    this.assertRequests([req])
    const run = async (trx: TrxToken) => {
      const current = await EntityProvenTxReq.fromStorageId(this.storage, req.id, trx)
      if (current.txid !== req.txid) throw new WERR_NOT_ACTIVE('The selected proof request changed')
      await apply(current, trx)
      await current.updateStorageDynamicProperties(this.storage, trx)
      req.api = current.api
      req.unpackApi()
    }
    if (this.actor != null) {
      await this.actor.write.transaction(run)
      return true
    }
    if (this.profiles.size === 0) {
      await this.storage.transaction(run)
      return true
    }
    for (const userId of this.profiles.keys()) if (await this.forUser(userId, run)) return true
    return false
  }

  async status(req: EntityProvenTxReq, status: TransactionStatus): Promise<void> {
    for (const [userId, ids] of this.transactions.get(req.txid) ?? []) {
      await this.forUser(userId, async trx => {
        const current = await EntityProvenTxReq.fromStorageId(this.storage, req.id, trx)
        if (current.status === 'completed') return
        const nextStatus = current.status === 'unmined' ? 'unproven' : status
        for (const transactionId of ids) {
          const rows = await this.storage.findTransactions({
            partial: { transactionId, userId, txid: req.txid },
            noRawTx: true,
            trx
          })
          // Recheck actual ownership and preserve already completed proofs. New
          // copies discovered after capture are left for a fresh monitor pass.
          if (
            rows.length !== 1 ||
            rows[0].status === 'completed' ||
            rows[0].provenTxId != null ||
            (rows[0].status === 'failed' && nextStatus !== 'failed')
          )
            continue
          await this.storage.updateTransactionStatus(nextStatus, transactionId, undefined, undefined, trx)
        }
      })
    }
  }
}

function isObsolete(error: unknown): boolean {
  return WalletError.fromUnknown(error).code === 'WERR_NOT_ACTIVE'
}
