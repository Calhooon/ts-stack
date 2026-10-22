import { Transaction, type WalletInterface } from '@bsv/sdk'
import { toArray } from '@bsv/sdk/primitives/utils'
import { attestationFromSteak, verifyAttestation } from './attestation.js'
import { isNamedError } from './errors.js'
import { colorTopic, outpointString, parseAssetId, parseOutpoint } from './identifiers.js'
import { readOutputList } from './overlay.js'
import type {
  ColorAttestation,
  ColorSettleReport,
  ColorSettleResult,
  ResolvedAsset
} from './profiles.js'
import type { ColorStore, TxRecord } from './store.js'

/** What `settle()` may be asked to do: named txids (host intent) and an asset filter. */
export interface ColorSettleRequest {
  txids?: string[]
  assetIds?: string[]
}

export interface ColorSettlerDeps {
  store: ColorStore
  /** The asset's authenticated resolution: its routed provider and profiles. */
  resolve: (assetId: string) => Promise<ResolvedAsset>
  /** Whether a signer's attestation counts for the asset (identity K, or the trust snapshot). */
  qualifies: (assetId: string) => Promise<(signer: string) => boolean>
  /** The underlying wallet (never the permissions manager). */
  wallet: WalletInterface
  /** True when the wallet's basket holds the outpoint as an output of the asset. */
  holds: (outpoint: string, assetId: string) => Promise<boolean>
  /** The vouts of `tx`'s token outputs of `assetId`, read with the module's reader. */
  tokenOutputs: (tx: Transaction, assetId: string) => number[]
}

/** A thrown `sendWith` error that means the transaction already reached the network (D24). */
const ALREADY_SENT =
  /already (?:been )?(?:broadcast|sent|known|mined|in (?:the )?mempool)|txn-already-known/i
const TXID = /^[0-9a-f]{64}$/
const ACTION_PAGE_LIMIT = 1000
const SEND_WITH_DESCRIPTION = 'Settle token hand-over'

interface ProviderFailure {
  code: string
  retryable: boolean
  transport: boolean
  message: string
}

function providerFailure(error: unknown): ProviderFailure | undefined {
  if (!isNamedError(error, 'ColorProviderError')) return undefined
  const { code, retryable, transport, message } = error as Partial<ProviderFailure>
  if (typeof code !== 'string') return undefined
  return {
    code,
    retryable: retryable !== false,
    transport: transport !== false,
    message: typeof message === 'string' ? message : code
  }
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : String(error)
}

function sameAttestation(a: ColorAttestation, b: ColorAttestation): boolean {
  return (
    a.txid === b.txid &&
    a.signer === b.signer &&
    a.signature === b.signature &&
    a.outputs.join(',') === b.outputs.join(',')
  )
}

/** Fails with a TypeError unless the request names lowercase txids and canonical asset ids. */
function checkRequest(request: unknown): ColorSettleRequest {
  if (request === undefined || request === null) return {}
  if (typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('BRC-207: a settle request must be an object')
  }
  const { txids, assetIds } = request as { txids?: unknown; assetIds?: unknown }
  if (
    txids !== undefined &&
    (!Array.isArray(txids) || txids.some(txid => typeof txid !== 'string' || !TXID.test(txid)))
  ) {
    throw new TypeError('BRC-207: settle txids must be lowercase hex transaction IDs')
  }
  if (assetIds !== undefined) {
    if (!Array.isArray(assetIds)) throw new TypeError('BRC-207: settle assetIds must be an array')
    for (const assetId of assetIds) {
      try {
        parseAssetId(assetId)
      } catch {
        throw new TypeError('BRC-207: settle assetIds must be canonical asset IDs')
      }
    }
  }
  return {
    ...(txids === undefined ? {} : { txids: [...(txids as string[])] }),
    ...(assetIds === undefined ? {} : { assetIds: [...(assetIds as string[])] })
  }
}

/**
 * Settles the module's offline state against the overlay (contract §2.3): every offline-credited
 * receipt, every own plain-noSend hand-over the overlay already admitted (D27) and every hand-over
 * the host named (its intent is persisted). Each transaction is submitted with its exact stored
 * AtomicBEEF and off-chain values, parents first, and is recorded settled only after a verified,
 * qualifying attestation covers it.
 *
 * Runs are single-flight per instance: a call made while another is running waits for it, then
 * reports what that run settled from the store. Every submit also passes a per-txid latch, which
 * `settleTx` (spending, Task 15) shares. Overlay refusals never throw; a store failure does.
 */
export class ColorSettler {
  protected readonly deps: ColorSettlerDeps
  /** The last queued run's report (undefined when it failed); never rejects. */
  protected last: Promise<ColorSettleReport | undefined> = Promise.resolve(undefined)
  /** Runs queued or running. */
  protected active = 0
  protected readonly latches = new Map<string, Promise<ColorSettleResult>>()
  protected disposed = false

  constructor(deps: ColorSettlerDeps) {
    this.deps = deps
  }

  async settle(request?: ColorSettleRequest, originator?: string): Promise<ColorSettleReport> {
    const req = checkRequest(request)
    const previous = this.last
    // A call that overlaps a run reports what that run settled, so a double click, a second tab
    // or a timer racing the `online` event all see the same outcome, and nothing is sent twice.
    const overlapping = this.active > 0
    this.active++
    const run = previous.then(
      async prior => await this.run(req, originator, overlapping ? prior : undefined)
    )
    this.last = run.then(
      report => report,
      () => undefined
    )
    try {
      return await run
    } finally {
      this.active--
    }
  }

  /** Submits one stored transaction through the per-txid latch, settled or not (no parents). */
  async settleTx(txid: string, originator?: string): Promise<ColorSettleResult> {
    if (typeof txid !== 'string' || !TXID.test(txid)) {
      throw new TypeError('BRC-207: settleTx takes a lowercase hex transaction ID')
    }
    return await this.latched(txid, async () => await this.submitTx(txid, originator))
  }

  /** Sync and idempotent: clears the latches; no new submit starts afterwards. */
  dispose(): void {
    this.disposed = true
    this.latches.clear()
  }

  protected async latched(
    txid: string,
    task: () => Promise<ColorSettleResult>
  ): Promise<ColorSettleResult> {
    const existing = this.latches.get(txid)
    if (existing !== undefined) return await existing
    const running = task()
    this.latches.set(txid, running)
    const clear = (): void => {
      if (this.latches.get(txid) === running) this.latches.delete(txid)
    }
    running.then(clear, clear)
    return await running
  }

  protected async run(
    req: ColorSettleRequest,
    originator: string | undefined,
    prior: ColorSettleReport | undefined
  ): Promise<ColorSettleReport> {
    if (this.disposed) return { results: [] }
    const { store } = this.deps
    const filter = req.assetIds === undefined ? undefined : new Set(req.assetIds)
    const records = new Map<string, TxRecord>()
    for (const txid of await store.txids()) {
      const record = await store.getTx(txid)
      if (record !== undefined) records.set(txid, record)
    }
    const inScope = (record: TxRecord): boolean => filter?.has(record.assetId) ?? true
    const settled = await store.settledSet()
    const refused = await store.refusedSet()
    const open = (txid: string): boolean => !settled.has(txid) && !refused.has(txid)
    const results: ColorSettleResult[] = []
    const reported = new Set<string>()
    const report = (result: ColorSettleResult): void => {
      results.push(result)
      reported.add(result.txid)
    }

    // 1. Promote staged receipts the wallet holds, or that a live own hand-over spends.
    const spentByHandovers = new Set(
      [...records.values()]
        .filter(record => record.role === 'handover' && record.state !== 'aborted')
        .flatMap(record => record.inputs)
    )
    for (const [txid, record] of records) {
      if (this.disposed) return { results }
      if (record.role !== 'receipt' || record.state !== 'staged') continue
      if (!inScope(record) || !open(txid)) continue
      if (!(await this.held(txid, record, spentByHandovers))) continue
      const credited: TxRecord = { ...record, state: 'credited' }
      await store.putTx(txid, credited)
      records.set(txid, credited)
    }

    // 2. Own hand-overs whose wallet action is gone are aborted (Decision 16).
    await this.detectAborted(records, inScope, open, originator)
    if (this.disposed) return { results }

    // 3. Retry sendWith for settled hand-overs not yet sent.
    for (const txid of await store.unsent()) {
      if (this.disposed) return { results }
      const record = records.get(txid)
      if (record?.role !== 'handover' || record.state === 'aborted' || !inScope(record)) continue
      if (await this.sendWith(txid, originator)) await store.removeUnsent(txid)
    }

    // 4. Candidates: named txids (their intent persisted first), persisted intents, credited
    //    receipts, and own hand-overs the overlay already admitted.
    const candidates: string[] = []
    const add = (txid: string): void => {
      if (!candidates.includes(txid)) candidates.push(txid)
    }
    for (const txid of req.txids ?? []) {
      const record = records.get(txid)
      if (record === undefined || !inScope(record) || reported.has(txid)) continue
      if (record.state === 'aborted') {
        await store.removeIntent(txid)
        report({
          txid,
          assetId: record.assetId,
          status: 'refused',
          code: 'ERR_ABORTED',
          description: 'BRC-207: the hand-over was aborted in the wallet'
        })
        continue
      }
      const done = await this.recorded(txid, record.assetId)
      if (done !== undefined) {
        await store.removeIntent(txid)
        report(done)
        continue
      }
      if (record.role === 'receipt' && record.state === 'staged') {
        report({
          txid,
          assetId: record.assetId,
          status: 'retry',
          code: 'ERR_NOT_HELD',
          description: 'BRC-207: the wallet does not hold this receipt'
        })
        continue
      }
      if (record.role === 'handover') await store.addIntent(txid)
      add(txid)
    }
    for (const txid of await store.intents()) {
      const record = records.get(txid)
      if (record !== undefined && !inScope(record)) continue
      if (record === undefined || record.state === 'aborted' || !open(txid)) {
        await store.removeIntent(txid)
        continue
      }
      add(txid)
    }
    for (const [txid, record] of records) {
      if (record.role === 'receipt' && record.state === 'credited' && inScope(record) && open(txid))
        add(txid)
    }
    for (const [txid, record] of records) {
      if (this.disposed) return { results }
      if (record.role !== 'handover' || record.state === 'aborted') continue
      if (!inScope(record) || !open(txid) || candidates.includes(txid)) continue
      if (await this.overlayAdmitted(txid, record)) add(txid)
    }

    // 5. Each candidate's unsettled ancestor closure, parents first, deduplicated.
    const order: string[] = []
    const parentsOf = new Map<string, string[]>()
    const visit = (txid: string): void => {
      if (parentsOf.has(txid)) return
      const record = records.get(txid)!
      const parents: string[] = []
      parentsOf.set(txid, parents)
      for (const input of record.inputs) {
        const { txid: parent, vout } = parseOutpoint(input)
        const source = records.get(parent)
        // No record: nothing to submit, the overlay decides. An attested output is an anchor.
        if (source === undefined || source.state === 'aborted') continue
        if (source.attestations.some(att => att.txid === parent && att.outputs.includes(vout)))
          continue
        if (settled.has(parent)) continue
        if (!parents.includes(parent)) parents.push(parent)
        if (!refused.has(parent)) visit(parent)
      }
      order.push(txid)
    }
    for (const txid of candidates) visit(txid)

    const outcome = new Map<string, ColorSettleResult>()
    for (const txid of order) {
      if (this.disposed) break
      const record = records.get(txid)!
      const parents = parentsOf.get(txid)!
      const refusedParent = parents.find(
        parent => refused.has(parent) || outcome.get(parent)?.status === 'refused'
      )
      let result: ColorSettleResult
      if (refusedParent !== undefined) {
        const description = `BRC-207: parent ${refusedParent} was refused`
        await store.markRefused(txid, { code: 'ERR_PARENT_REFUSED', description })
        await store.removeIntent(txid)
        result = {
          txid,
          assetId: record.assetId,
          status: 'refused',
          code: 'ERR_PARENT_REFUSED',
          description
        }
      } else {
        const waiting = parents
          .map(parent => outcome.get(parent))
          .find(o => o?.status !== 'admitted')
        if (waiting !== undefined || parents.some(parent => !outcome.has(parent))) {
          result = {
            txid,
            assetId: record.assetId,
            status: 'retry',
            code: waiting?.code ?? 'ERR_UNAVAILABLE',
            description: 'BRC-207: a parent transaction is not settled yet'
          }
        } else {
          result =
            (await this.recorded(txid, record.assetId)) ??
            (await this.latched(txid, async () => await this.submitTx(txid, originator)))
        }
      }
      outcome.set(txid, result)
      report(result)
    }

    // A call that overlapped the previous run reports that run's final outcomes too.
    for (const earlier of prior?.results ?? []) {
      if (reported.has(earlier.txid)) continue
      const record = records.get(earlier.txid)
      if (record === undefined || !inScope(record)) continue
      const done = await this.recorded(earlier.txid, record.assetId)
      if (done !== undefined) report(done)
    }
    return { results }
  }

  /** The stored outcome of a settled or refused transaction, or undefined while it is open. */
  protected async recorded(txid: string, assetId: string): Promise<ColorSettleResult | undefined> {
    const settled = await this.deps.store.settled(txid)
    if (settled !== undefined) {
      return { txid, assetId, status: 'admitted', outputs: [...settled.outputs] }
    }
    const refused = await this.deps.store.refused(txid)
    if (refused !== undefined) {
      return {
        txid,
        assetId,
        status: 'refused',
        code: refused.code,
        description: refused.description
      }
    }
    return undefined
  }

  /** A staged receipt counts as held when a live own hand-over spends it or the wallet lists it. */
  protected async held(
    txid: string,
    record: TxRecord,
    spentByHandovers: ReadonlySet<string>
  ): Promise<boolean> {
    for (const vout of record.outputs) {
      const outpoint = outpointString(txid, vout)
      if (spentByHandovers.has(outpoint)) return true
      try {
        if (await this.deps.holds(outpoint, record.assetId)) return true
      } catch {
        // An unreachable wallet proves nothing: the receipt stays staged.
      }
    }
    return false
  }

  /**
   * Marks `aborted` every open own hand-over whose wallet action the underlying `listActions`,
   * queried by its plan labels, no longer lists (the toolbox omits failed, aborted, actions).
   * A thrown or malformed listing changes nothing, so a wallet outage never drops a live one.
   */
  protected async detectAborted(
    records: Map<string, TxRecord>,
    inScope: (record: TxRecord) => boolean,
    open: (txid: string) => boolean,
    originator: string | undefined
  ): Promise<void> {
    const { store } = this.deps
    const groups = new Map<string, { labels: string[]; txids: string[] }>()
    for (const [txid, record] of records) {
      if (record.role !== 'handover' || record.state === 'aborted') continue
      if (!inScope(record) || !open(txid)) continue
      if (record.labels === undefined || record.labels.length === 0) continue
      const key = JSON.stringify(record.labels)
      const group = groups.get(key) ?? { labels: record.labels, txids: [] }
      group.txids.push(txid)
      groups.set(key, group)
    }
    for (const { labels, txids } of groups.values()) {
      if (this.disposed) return
      let live: Set<string>
      try {
        live = await this.liveActions(labels, originator)
      } catch {
        continue
      }
      for (const txid of txids) {
        if (live.has(txid)) continue
        const aborted: TxRecord = { ...records.get(txid)!, state: 'aborted' }
        await store.putTx(txid, aborted)
        await store.removeIntent(txid)
        await store.removeUnsent(txid)
        records.set(txid, aborted)
      }
    }
  }

  /** The txids of the wallet's listed actions carrying every one of `labels`, all pages. */
  protected async liveActions(
    labels: string[],
    originator: string | undefined
  ): Promise<Set<string>> {
    const txids = new Set<string>()
    for (let offset = 0; ;) {
      const page = await this.deps.wallet.listActions(
        { labels, labelQueryMode: 'all', limit: ACTION_PAGE_LIMIT, offset },
        originator
      )
      if (!Array.isArray(page?.actions)) throw new Error('BRC-207: listActions gave no actions')
      for (const action of page.actions)
        if (typeof action?.txid === 'string') txids.add(action.txid)
      offset += page.actions.length
      if (page.actions.length < ACTION_PAGE_LIMIT || offset >= page.totalActions) return txids
    }
  }

  /** True when the asset's overlay lists any of the hand-over's same-asset token outputs. */
  protected async overlayAdmitted(txid: string, record: TxRecord): Promise<boolean> {
    try {
      const tx = Transaction.fromHex(record.rawTx)
      if (tx.id('hex') !== txid) return false
      const outpoints = this.deps
        .tokenOutputs(tx, record.assetId)
        .map(vout => outpointString(txid, vout))
      if (outpoints.length === 0) return false
      const { provider } = await this.deps.resolve(record.assetId)
      return readOutputList(await provider.admission(record.assetId, outpoints), outpoints).size > 0
    } catch {
      return false // Unreachable or unreadable: try again on a later settle.
    }
  }

  /**
   * One submit: the stored AtomicBEEF and off-chain values verbatim to the asset's routed
   * provider. A verified, qualifying attestation that covers the record's outputs (an ancestor's:
   * every same-asset token output) is stored and the tx marked settled; an own hand-over is then
   * sent with `sendWith`. A typed final refusal of an unsettled tx is recorded; anything else,
   * including any refusal of an already settled tx, is `retry`.
   */
  protected async submitTx(
    txid: string,
    originator: string | undefined
  ): Promise<ColorSettleResult> {
    const { store } = this.deps
    const record = await store.getTx(txid)
    if (record === undefined) {
      return retry(txid, '', 'ERR_EVIDENCE', 'BRC-207: no stored record for the transaction')
    }
    const { assetId } = record
    if (record.state === 'aborted') {
      return {
        txid,
        assetId,
        status: 'refused',
        code: 'ERR_ABORTED',
        description: 'BRC-207: the hand-over was aborted in the wallet'
      }
    }
    if (this.disposed)
      return retry(txid, assetId, 'ERR_DISPOSED', 'BRC-207: the module is disposed')
    let tx: Transaction
    try {
      tx = Transaction.fromAtomicBEEF(toArray(record.atomicBEEF, 'hex'))
      if (tx.id('hex') !== txid) throw new Error('subject mismatch')
    } catch {
      return retry(txid, assetId, 'ERR_EVIDENCE', 'BRC-207: the stored AtomicBEEF does not parse')
    }
    let resolved: ResolvedAsset
    let qualifies: (signer: string) => boolean
    try {
      resolved = await this.deps.resolve(assetId)
      qualifies = await this.deps.qualifies(assetId)
    } catch (error) {
      return retry(
        txid,
        assetId,
        providerFailure(error)?.code ?? 'ERR_UNAVAILABLE',
        messageOf(error)
      )
    }
    const topic = colorTopic(assetId)
    let entry: unknown
    try {
      const steak = await resolved.provider.submit(
        [topic],
        toArray(record.atomicBEEF, 'hex'),
        toArray(record.offChainValues, 'hex')
      )
      entry = (steak as Record<string, unknown> | undefined)?.[topic]
    } catch (error) {
      const failure = providerFailure(error)
      // A resubmission of an already settled tx (spending's settleTx) never records a refusal:
      // its admission stands, and a refused record would lock every output of it for good.
      if (
        failure !== undefined &&
        !failure.transport &&
        !failure.retryable &&
        (await store.settled(txid)) === undefined
      ) {
        await store.markRefused(txid, { code: failure.code, description: failure.message })
        await store.removeIntent(txid)
        return {
          txid,
          assetId,
          status: 'refused',
          code: failure.code,
          description: failure.message
        }
      }
      return retry(txid, assetId, failure?.code ?? 'ERR_UNAVAILABLE', messageOf(error))
    }
    if (entry === undefined || entry === null) {
      return retry(txid, assetId, 'ERR_NO_ATTESTATION', 'BRC-207: the overlay gave no admission')
    }
    let att: ColorAttestation | undefined
    try {
      att = attestationFromSteak(txid, topic, entry as Parameters<typeof attestationFromSteak>[2])
    } catch (error) {
      return retry(txid, assetId, 'ERR_ATTESTATION', messageOf(error))
    }
    if (att === undefined) {
      return retry(txid, assetId, 'ERR_NO_ATTESTATION', 'BRC-207: the admission is not attested')
    }
    const required =
      record.role === 'ancestor' || record.outputs.length === 0
        ? this.deps.tokenOutputs(tx, assetId)
        : record.outputs
    if (
      !verifyAttestation(att, assetId) ||
      !qualifies(att.signer) ||
      !required.every(vout => att.outputs.includes(vout))
    ) {
      return retry(
        txid,
        assetId,
        'ERR_ATTESTATION',
        'BRC-207: the admission attestation does not qualify or cover the outputs'
      )
    }

    // Crash-safe order: the attestation, then the unsent marker of a hand-over (so a crash
    // before sendWith still sends it later), then the settled record, the send and the intent.
    const fresh = (await store.getTx(txid)) ?? record
    const verified = att
    if (!fresh.attestations.some(stored => sameAttestation(stored, verified))) {
      await store.putTx(txid, { ...fresh, attestations: [...fresh.attestations, verified] })
    }
    const handover = record.role === 'handover'
    if (handover) await store.addUnsent(txid)
    await store.markSettled(txid, { outputs: [...att.outputs], signer: att.signer })
    if (handover && (await this.sendWith(txid, originator))) await store.removeUnsent(txid)
    await store.removeIntent(txid)
    return { txid, assetId, status: 'admitted', outputs: [...att.outputs] }
  }

  /**
   * Moves an own noSend action out of `nosend` (D24): a resolved call is success unless its
   * entry for `txid` failed; a thrown "already broadcast/known/mined" is success too.
   */
  protected async sendWith(txid: string, originator: string | undefined): Promise<boolean> {
    try {
      const result = await this.deps.wallet.createAction(
        { description: SEND_WITH_DESCRIPTION, options: { sendWith: [txid] } },
        originator
      )
      return !(result?.sendWithResults ?? []).some(
        entry => entry?.txid === txid && entry.status === 'failed'
      )
    } catch (error) {
      return ALREADY_SENT.test(messageOf(error))
    }
  }
}

function retry(
  txid: string,
  assetId: string,
  code: string,
  description: string
): ColorSettleResult {
  return { txid, assetId, status: 'retry', code, description }
}
