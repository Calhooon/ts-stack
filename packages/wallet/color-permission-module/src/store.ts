import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import { parseAttestation } from './attestation.js'
import type { ColorAttestation } from './profiles.js'
import type { JsonValue } from './strictJson.js'
import type { ColorModuleStore } from './types.js'

/** Every key the module writes starts with this prefix. */
export const STORE_PREFIX = 'color.v1.'

/**
 * The durable record of one transaction the module must be able to settle or hand over.
 * `atomicBEEF` is the exact BRC-95 bytes settle and resubmit send verbatim (contract §2.2-8): a
 * receipt tip keeps the internalize `args.tx`, a receipt ancestor
 * `receiptBeef.toBinaryAtomic(txid)` and an own hand-over the signAction `res.tx`. It is never
 * rebuilt from `rawTx`.
 */
export interface TxRecord {
  v: 1
  assetId: string
  /** Lowercase hex. */
  rawTx: string
  /** Lowercase hex AtomicBEEF whose subject is this record's txid. */
  atomicBEEF: string
  role: 'receipt' | 'handover' | 'ancestor'
  /** `staged`/`credited`: receipts; `aborted`: own hand-overs whose wallet action is gone. */
  state?: 'staged' | 'credited' | 'aborted'
  /** Hand-overs only: the createAction labels, used to find the action in listActions. */
  labels?: string[]
  /** Same-asset token input outpoints (`<txid>.<vout>`). */
  inputs: string[]
  /** Wallet-held outputs of this asset (`[]` for ancestors). */
  outputs: number[]
  /** Lowercase hex, `''` when none. */
  offChainValues: string
  /** Verified, qualifying attestations covering outputs of this transaction. */
  attestations: ColorAttestation[]
}

export interface SettledRecord {
  outputs: number[]
  signer: string
}

export interface RefusedRecord {
  code: string
  description: string
}

const TXID = /^[0-9a-f]{64}$/
const HEX = /^(?:[0-9a-f]{2})*$/
const ASSET_ID = /^[0-9a-f]{64}_(0|[1-9][0-9]{0,9})$/
const OUTPOINT = /^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/
const SIGNER = /^0[23][0-9a-f]{64}$/
/** The AtomicBEEF prefix `0x01010101` (the same bytes in either byte order). */
const ATOMIC_PREFIX = '01010101'
const ROLES = new Set(['receipt', 'handover', 'ancestor'])
const STATES = new Set(['staged', 'credited', 'aborted'])
const TX_MEMBERS = new Set([
  'v',
  'assetId',
  'rawTx',
  'atomicBEEF',
  'role',
  'state',
  'labels',
  'inputs',
  'outputs',
  'offChainValues',
  'attestations'
])

type Kind = 'tx' | 'settled' | 'refused' | 'intent' | 'unsent'

/**
 * Typed records over the host's `ColorModuleStore`, all under `color.v1.`. Only constructed
 * when profiles are registered. The layout is
 * `color.v1.{tx,deploy,settled,refused,intent,unsent}.<id>`, and nothing else writes the store.
 *
 * Reads fail safe: a record that does not parse, or whose shape is wrong, reads as absent. A tx
 * record whose `atomicBEEF` is not lowercase even-length hex or whose AtomicBEEF header names
 * another subject reads as absent too, so a torn or tampered write never reaches a submit. Only
 * the header is checked here, because settle enumerates every record; the full parse happens
 * once, right before a submit.
 */
export class ColorStore {
  constructor(protected readonly store: ColorModuleStore) {}

  /** The cached deploy transaction of an asset, as raw hex; the caller verifies it by hash. */
  async getDeploy(assetId: string): Promise<string | undefined> {
    return await this.store.get(deployKey(assetId))
  }

  async putDeploy(assetId: string, hex: string): Promise<void> {
    await this.store.set(deployKey(assetId), hex)
  }

  async deleteDeploy(assetId: string): Promise<void> {
    await this.store.delete(deployKey(assetId))
  }

  async getTx(txid: string): Promise<TxRecord | undefined> {
    return txRecord(await this.read('tx', txid), txid)
  }

  async putTx(txid: string, record: TxRecord): Promise<void> {
    await this.store.set(recordKey('tx', txid), JSON.stringify(record))
  }

  /** The txids that have a tx record key (readable or not), sorted. */
  async txids(): Promise<string[]> {
    return await this.ids('tx')
  }

  /** The settled record of `txid`, written only after a verified attestation covered it. */
  async settled(txid: string): Promise<SettledRecord | undefined> {
    return settledRecord(await this.read('settled', txid))
  }

  async markSettled(txid: string, value: SettledRecord): Promise<void> {
    const record = { outputs: value.outputs, signer: value.signer }
    await this.store.set(recordKey('settled', txid), JSON.stringify(record))
  }

  /** The final overlay refusal of `txid`. */
  async refused(txid: string): Promise<RefusedRecord | undefined> {
    return refusedRecord(await this.read('refused', txid))
  }

  async markRefused(txid: string, value: RefusedRecord): Promise<void> {
    const record = { code: value.code, description: value.description }
    await this.store.set(recordKey('refused', txid), JSON.stringify(record))
  }

  /** The txids the host asked to settle, sorted. */
  async intents(): Promise<string[]> {
    return await this.ids('intent')
  }

  async addIntent(txid: string): Promise<void> {
    await this.store.set(recordKey('intent', txid), '1')
  }

  async removeIntent(txid: string): Promise<void> {
    await this.store.delete(recordKey('intent', txid))
  }

  /** The txids of signed transactions not yet sent, sorted. */
  async unsent(): Promise<string[]> {
    return await this.ids('unsent')
  }

  async addUnsent(txid: string): Promise<void> {
    await this.store.set(recordKey('unsent', txid), '1')
  }

  async removeUnsent(txid: string): Promise<void> {
    await this.store.delete(recordKey('unsent', txid))
  }

  /** The txids with a readable settled record. A torn record does not count (fail safe). */
  async settledSet(): Promise<Set<string>> {
    return await this.readableIds('settled', async txid => await this.settled(txid))
  }

  /** The txids with a readable refused record. */
  async refusedSet(): Promise<Set<string>> {
    return await this.readableIds('refused', async txid => await this.refused(txid))
  }

  /** The parsed JSON of a record, or undefined when it is absent or does not parse. */
  protected async read(kind: Kind, txid: string): Promise<JsonValue | undefined> {
    const text = await this.store.get(recordKey(kind, txid))
    if (text === undefined) return undefined
    try {
      return JSON.parse(text) as JsonValue
    } catch {
      return undefined
    }
  }

  /** The txids of the `kind` keys, sorted; a key whose suffix is not a txid is ignored. */
  protected async ids(kind: Kind): Promise<string[]> {
    const prefix = `${STORE_PREFIX}${kind}.`
    return (await this.store.keys(prefix))
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
      .filter(id => TXID.test(id))
      .sort()
  }

  protected async readableIds(
    kind: Kind,
    read: (txid: string) => Promise<unknown>
  ): Promise<Set<string>> {
    const ids = await this.ids(kind)
    const records = await Promise.all(ids.map(read))
    return new Set(ids.filter((_, index) => records[index] !== undefined))
  }
}

function deployKey(assetId: string): string {
  return `${STORE_PREFIX}deploy.${assetId}`
}

function recordKey(kind: Kind, txid: string): string {
  if (typeof txid !== 'string' || !TXID.test(txid)) {
    throw new TypeError('BRC-207: a store record is keyed by a lowercase hex txid')
  }
  return `${STORE_PREFIX}${kind}.${txid}`
}

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOutputList(value: JsonValue | undefined): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      vout =>
        typeof vout === 'number' && Number.isSafeInteger(vout) && vout >= 0 && vout <= 0xffffffff
    )
  )
}

function isStringList(value: JsonValue | undefined, pattern?: RegExp): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(item => typeof item === 'string' && (pattern === undefined || pattern.test(item)))
  )
}

/** The AtomicBEEF header for `txid`: the prefix, then the subject txid in wire (reversed) order. */
function atomicHeader(txid: string): string {
  return ATOMIC_PREFIX + toHex(toArray(txid, 'hex').reverse())
}

function txRecord(value: JsonValue | undefined, txid: string): TxRecord | undefined {
  if (!isObject(value)) return undefined
  if (!Object.keys(value).every(key => TX_MEMBERS.has(key))) return undefined
  const { v, assetId, rawTx, atomicBEEF, role, state, labels, inputs, outputs } = value
  const { offChainValues, attestations } = value
  if (v !== 1) return undefined
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) return undefined
  if (typeof rawTx !== 'string' || rawTx === '' || !HEX.test(rawTx)) return undefined
  if (
    typeof atomicBEEF !== 'string' ||
    !HEX.test(atomicBEEF) ||
    !atomicBEEF.startsWith(atomicHeader(txid))
  ) {
    return undefined
  }
  if (typeof role !== 'string' || !ROLES.has(role)) return undefined
  if (state !== undefined && (typeof state !== 'string' || !STATES.has(state))) return undefined
  if (labels !== undefined && !isStringList(labels)) return undefined
  if (!isStringList(inputs, OUTPOINT) || !isOutputList(outputs)) return undefined
  if (typeof offChainValues !== 'string' || !HEX.test(offChainValues)) return undefined
  if (!Array.isArray(attestations)) return undefined
  const parsed: ColorAttestation[] = []
  for (const attestation of attestations) {
    try {
      parsed.push(parseAttestation(attestation))
    } catch {
      return undefined
    }
  }
  return {
    v: 1,
    assetId,
    rawTx,
    atomicBEEF,
    role: role as TxRecord['role'],
    ...(state === undefined ? {} : { state: state as NonNullable<TxRecord['state']> }),
    ...(labels === undefined ? {} : { labels: [...labels] }),
    inputs: [...inputs],
    outputs: [...outputs],
    offChainValues,
    attestations: parsed
  }
}

function settledRecord(value: JsonValue | undefined): SettledRecord | undefined {
  if (!isObject(value) || Object.keys(value).length !== 2) return undefined
  const { outputs, signer } = value
  if (!isOutputList(outputs) || typeof signer !== 'string' || !SIGNER.test(signer)) {
    return undefined
  }
  return { outputs: [...outputs], signer }
}

function refusedRecord(value: JsonValue | undefined): RefusedRecord | undefined {
  if (!isObject(value) || Object.keys(value).length !== 2) return undefined
  const { code, description } = value
  if (typeof code !== 'string' || typeof description !== 'string') return undefined
  return { code, description }
}
