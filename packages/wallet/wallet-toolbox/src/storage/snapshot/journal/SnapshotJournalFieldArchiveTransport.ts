import {
  validateSnapshotArchiveReaderOptions,
  type SnapshotArchiveReaderOptions
} from '../archive/SnapshotArchiveReaderRequest'
import {
  validateSnapshotArchiveOffer,
  validateSnapshotArchiveRequestReceipt,
  type SnapshotArchiveOffer
} from '../archive/SnapshotArchiveProtocol'
import { validateSnapshotArchiveCancellation } from '../archive/SnapshotArchiveCleanup'
import { verifySnapshotArchivePage } from '../archive/SnapshotArchiveDirectory'
import type { SnapshotArchiveAdmission } from '../archive/SnapshotArchiveAdmission'
import type { SnapshotArchiveRequestReceipt } from '../archive/SnapshotArchiveRequest'
import {
  parseSnapshotJournalFieldArchiveRpcInput,
  validateSnapshotJournalFieldArchiveCapabilities,
  type SnapshotJournalFieldArchiveCapabilities,
  type SnapshotJournalFieldArchiveMethod
} from './SnapshotJournalFieldArchiveProtocol'
import {
  parseSnapshotJournalFieldArchiveReaderRequest,
  validateSnapshotJournalFieldArchiveReaderRequest,
  type SnapshotJournalFieldArchiveReaderRequest
} from './SnapshotJournalArchiveReaderRequest'
import {
  parseSnapshotJournalArchivePosition,
  snapshotJournalDataRecord,
  type SnapshotJournalArchivePosition
} from './SnapshotJournalReceiptData'
import {
  verifySnapshotJournalFieldArchiveDirectory,
  type VerifiedSnapshotJournalFieldArchiveDirectory
} from './SnapshotJournalArchiveDirectory'

export type SnapshotJournalFieldArchiveRpcCall = (
  method: SnapshotJournalFieldArchiveMethod,
  params: unknown[],
  signal?: AbortSignal
) => Promise<unknown>
export type SnapshotJournalFieldArchiveOffer =
  | {
      readonly version: 1
      readonly outcome: 'offered'
      readonly offer: Readonly<SnapshotArchiveOffer>
      readonly request: Readonly<SnapshotJournalFieldArchiveReaderRequest>
    }
  | { readonly version: 1; readonly outcome: 'resource-limited' }

/** Authenticated bounded DATA transport. Neither its receipt nor its directory
 * implements a live SQL source or a destination writer. */
export class SnapshotJournalFieldArchiveTransport {
  readonly capabilities: Readonly<SnapshotJournalFieldArchiveCapabilities>
  constructor(
    private readonly rpc: SnapshotJournalFieldArchiveRpcCall,
    private readonly identityKey: string,
    private readonly storageIdentityKey: string,
    private readonly chain: 'main' | 'test',
    capabilities: SnapshotJournalFieldArchiveCapabilities
  ) {
    this.capabilities = validateSnapshotJournalFieldArchiveCapabilities(capabilities)
  }
  private async call(
    method: SnapshotJournalFieldArchiveMethod,
    fields: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const params = [{ version: 1, identityKey: this.identityKey, ...fields }]
    parseSnapshotJournalFieldArchiveRpcInput(method, params)
    return await this.rpc(method, params, signal)
  }
  async offer(
    input: SnapshotArchiveReaderOptions,
    inputPosition?: SnapshotJournalArchivePosition,
    signal?: AbortSignal
  ): Promise<SnapshotJournalFieldArchiveOffer> {
    const options = validateSnapshotArchiveReaderOptions(input),
      position = parseSnapshotJournalArchivePosition(inputPosition ?? null) ?? null
    if (options.lifetimeMs > this.capabilities.maxLifetimeMs)
      throw new TypeError('Journal archive offer exceeds negotiated lifetime')
    const value = await this.call('getSnapshotJournalFieldArchiveReaderOffer', { options, position }, signal)
    const outcome =
      value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'outcome')?.value : undefined
    const row = snapshotJournalDataRecord(
      value,
      outcome === 'offered' ? ['version', 'outcome', 'offer', 'request'] : ['version', 'outcome']
    )
    if (row.version !== 1) throw new TypeError('Invalid journal archive offer')
    if (row.outcome === 'resource-limited') return Object.freeze({ version: 1, outcome: 'resource-limited' })
    if (row.outcome !== 'offered') throw new TypeError('Invalid journal archive offer')
    const offer = validateSnapshotArchiveOffer(row.offer, this.storageIdentityKey, this.chain),
      request = validateSnapshotJournalFieldArchiveReaderRequest(row.request, offer.serverTime)
    if (
      request.notAfter !== offer.serverTime + options.lifetimeMs ||
      request.maxBytes !== options.maxBytes ||
      JSON.stringify(request.position) !== JSON.stringify(position)
    )
      throw new TypeError('Journal archive offer changed requested bounds')
    return Object.freeze({ version: 1, outcome: 'offered', offer, request })
  }
  async admit(
    input: SnapshotJournalFieldArchiveReaderRequest,
    signal?: AbortSignal
  ): Promise<Readonly<SnapshotArchiveAdmission>> {
    const request = parseSnapshotJournalFieldArchiveReaderRequest(input),
      value = await this.call('admitSnapshotJournalFieldArchive', { request }, signal)
    const outcome =
      value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'outcome')?.value : undefined
    const row = snapshotJournalDataRecord(
      value,
      outcome === 'accepted' ? ['version', 'outcome', 'receipt'] : ['version', 'outcome', 'requestId', 'expiresAt']
    )
    if (row.version !== 1) throw new TypeError('Invalid journal archive admission')
    if (row.outcome === 'accepted')
      return Object.freeze({
        version: 1,
        outcome: 'accepted',
        receipt: validateSnapshotArchiveRequestReceipt(row.receipt, request)
      })
    if (row.outcome !== 'resource-limited' || row.requestId !== request.requestId || row.expiresAt !== request.notAfter)
      throw new TypeError('Invalid journal archive admission')
    return Object.freeze({
      version: 1,
      outcome: 'resource-limited',
      requestId: request.requestId,
      expiresAt: request.notAfter
    })
  }
  async status(
    input: SnapshotJournalFieldArchiveReaderRequest,
    signal?: AbortSignal
  ): Promise<Readonly<SnapshotArchiveRequestReceipt>> {
    const request = parseSnapshotJournalFieldArchiveReaderRequest(input)
    return validateSnapshotArchiveRequestReceipt(
      await this.call('getSnapshotJournalFieldArchiveStatus', { request }, signal),
      request
    )
  }
  async cancelRequest(input: SnapshotJournalFieldArchiveReaderRequest, signal?: AbortSignal): Promise<void> {
    const request = parseSnapshotJournalFieldArchiveReaderRequest(input)
    validateSnapshotArchiveCancellation(
      await this.call('cancelSnapshotJournalFieldArchiveRequest', { request }, signal),
      request.requestId
    )
  }
  async directory(
    input: SnapshotJournalFieldArchiveReaderRequest,
    receipt: SnapshotArchiveRequestReceipt,
    offer: SnapshotArchiveOffer,
    now: number,
    signal?: AbortSignal
  ): Promise<VerifiedSnapshotJournalFieldArchiveDirectory> {
    const request = parseSnapshotJournalFieldArchiveReaderRequest(input),
      ready = validateSnapshotArchiveRequestReceipt(receipt, request)
    if (ready.state !== 'ready' || ready.archiveId === undefined || ready.digest === undefined)
      throw new TypeError('Journal archive is not ready')
    return verifySnapshotJournalFieldArchiveDirectory(
      await this.call('getSnapshotJournalFieldArchiveDirectory', { request, archiveId: ready.archiveId }, signal),
      {
        identityKey: this.identityKey,
        chain: this.chain,
        sourceStorageIdentityKey: this.storageIdentityKey,
        sourceSchema: offer.sourceSchema,
        archiveId: ready.archiveId,
        digest: ready.digest,
        expiresAt: ready.expiresAt,
        ...(request.position === null ? {} : { position: request.position })
      },
      now
    )
  }
  async page(
    input: SnapshotJournalFieldArchiveReaderRequest,
    directory: VerifiedSnapshotJournalFieldArchiveDirectory,
    sequence: number,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= directory.receipts.length)
      throw new TypeError('Invalid journal archive packet sequence')
    const request = parseSnapshotJournalFieldArchiveReaderRequest(input)
    return verifySnapshotArchivePage(
      await this.call(
        'readSnapshotJournalFieldArchivePage',
        { request, archiveId: directory.manifest.archiveId, sequence },
        signal
      ),
      directory.receipts[sequence]
    )
  }
}
