import {
  Beef,
  LockingScript,
  Signature,
  Spend,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  type AtomicBEEF,
  type BasketInsertion,
  type CreateActionArgs,
  type CreateActionInput,
  type CreateActionOutput,
  type CreateSignatureArgs,
  type InternalizeActionArgs,
  type ListActionsArgs,
  type ListOutputsArgs,
  type ListOutputsResult,
  type SignActionArgs,
  type SignActionResult,
  type WalletCounterparty,
  type WalletInterface,
  type WalletOutput
} from '@bsv/sdk'
import { hash160, hash256 } from '@bsv/sdk/primitives/Hash'
import Random from '@bsv/sdk/primitives/Random'
import { toArray, toBase64, toHex } from '@bsv/sdk/primitives/utils'
import { OneColor, readOneColorAttributes, reqMatchesDeploy } from '@bsv/templates'
import {
  encryptMetadata,
  maybeDecryptMetadata,
  sdk as toolbox,
  type PermissionsModule,
  type PermissionsModuleAction,
  type PermissionsModuleNext,
  type PermissionsModuleRequest
} from '@bsv/wallet-toolbox-client'
import {
  ColorPlan,
  type ColorOperationName,
  parseProfileData,
  parseRemittances,
  type ColorRemittance,
  COLOR_PLAN_LABEL_PREFIX
} from './ColorPlan.js'
import {
  ASSETS_SELECTOR,
  assetBasket,
  COLOR_BASKET_NAMESPACE,
  COLOR_KEY_ID,
  colorProtocolID,
  colorTopic,
  DISCOVERY_TOPIC,
  ISSUE,
  outpointString,
  parseAssetBasket,
  parseAssetId,
  parseAssetSelector,
  parseBalanceSelector,
  parseColorProtocolID,
  parseOutpoint,
  validateIdentityKey,
  validateRemittanceString,
  type TokenRole
} from './identifiers.js'
import { eachInOrder, mapInOrder } from './inOrder.js'
import { readOutputList } from './overlay.js'
import {
  exactMembers,
  jsonByteArray,
  jsonObject,
  jsonUint32,
  parseStrictJsonBytes,
  type JsonValue
} from './strictJson.js'
import {
  isDeployOutput,
  readAnyTokenOutput,
  readJsonTokenOutput,
  readProfiledTokenOutput,
  readTokenOutput,
  assertWellFormedProfileMaps,
  type TokenOutput,
  type TokenReader
} from './tokenOutputs.js'
import type {
  AttestedSTEAK,
  ColorModuleStore,
  ColorOverlayProvider,
  ColorPermissionModuleOptions,
  ColorTokenAccessHandler,
  ProfileData
} from './types.js'
import {
  AttestationEvidenceError,
  ColorConsentDeclinedError,
  isNamedError,
  ProfileDataError,
  ProfileParamsError
} from './errors.js'
import {
  assertOwnExtEntries,
  resolveRequirements,
  routeProvider,
  validateProfileHandlers,
  type ColorAttestation,
  type ColorHandoffResult,
  type ColorSettleReport,
  type ProfileAssetContext,
  type ProfileDescriptor,
  type ProfileTxView,
  type ReceiptGraph,
  type RequiredProfileHandler,
  type ResolvedAsset
} from './profiles.js'
import { ColorStore, type SettledRecord, type TxRecord } from './store.js'
import { ColorSettler, type ColorSettleRequest } from './settle.js'
import {
  ATTESTED_PROFILE_ID,
  attestationFromSteak,
  COLOR_OFFLINE_TAG,
  parseAttestation,
  verifyAttestation
} from './attestation.js'
import {
  assertCoverage,
  parseAttestedLeaf,
  parseAttestedParams,
  qualifyingSigner,
  trustSnapshot,
  type AttestedLeaf
} from './attested.js'
import { validateFrontier } from './frontier.js'

const UNLOCKING_SCRIPT_LENGTH = 108
const TOKEN_CARRIER_SATOSHIS = 1
const DEFAULT_SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024
const MAX_RECEIPT_INSTRUCTION_BYTES = 1000
/** The largest receipt customInstructions the module parses at all, each and in aggregate (0207:1442-1448). */
const MAX_PARSED_RECEIPT_BYTES = 16_777_216
/** Tags with this prefix are the module's; callers' are stripped from receipts when profiles are registered. */
const COLOR_TAG_PREFIX = 'color_'
const LIST_PAGE_LIMIT = 10_000
const SUBMIT_ATTEMPTS = 3
const NOSEND_EXPIRY_LABEL_PREFIX = 'p nosend expiry '
const STATE_TAG_PREFIX = 'color_state_'
const UTF8_ENCODER = new TextEncoder()
const NO_REQUIREMENTS: ReadonlyMap<string, ProfileDescriptor> = new Map()
/** The attributes of a deploy that declares nothing, for a BRC-161 JSON deploy. */
const ABSENT_ATTRIBUTES = readOneColorAttributes(undefined)
const LOWER_HEX = /^(?:[0-9a-f]{2})+$/
const TXID_PATTERN = /^[0-9a-f]{64}$/

/** The transaction `hex` encodes, when it is lowercase canonical hex of a transaction with id `txid`. */
function canonicalTransaction(hex: unknown, txid: string): Transaction | undefined {
  if (typeof hex !== 'string' || !LOWER_HEX.test(hex)) return undefined
  try {
    const tx = Transaction.fromHex(hex)
    return tx.id('hex') === txid && tx.toHex() === hex ? tx : undefined
  } catch {
    return undefined
  }
}

/** The derivation tuple a managed output's key was created with; `assetId` is `ISSUE` for a deploy. */
export interface Custody {
  assetId: string
  derivationPrefix: string
  derivationSuffix: string
  senderIdentityKey: string
}

export interface SourceOutput {
  outpoint: string
  lockingScript: LockingScript
  satoshis: number
}

/** A basket output that may be selected, read from its locking script before any custody is read. */
interface Candidate extends SourceOutput {
  token: TokenOutput
  amount: bigint
  customInstructions: string
}

export interface ManagedInput extends SourceOutput {
  assetId: string
  role: TokenRole
  amount: bigint
  custody: Custody
}

/** `restricted` occurs only with profiles registered: a final overlay refusal (C55). */
type InventoryState = 'available' | 'reserved' | 'restricted'

/**
 * The settled and refused txids, loaded once per listing from the `color.v1.` store, and only
 * when profiles are registered.
 */
interface SettlementState {
  settled: ReadonlySet<string>
  refused: ReadonlySet<string>
}

/** Runs an SDK parser on untrusted input, prefixing its failure as a BRC-207 error. */
function parsed<T>(label: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    throw new Error(`BRC-207: ${label} is invalid (${(error as Error).message})`)
  }
}

function sumAmounts(inputs: ReadonlyArray<{ amount: bigint }>): bigint {
  return inputs.reduce((total, input) => total + input.amount, 0n)
}

function inputOutpoint(input: Transaction['inputs'][number]): string {
  const txid = input.sourceTXID ?? input.sourceTransaction?.id('hex')
  if (txid === undefined) throw new Error('BRC-207: transaction input has no source transaction ID')
  return outpointString(txid, input.sourceOutputIndex)
}

function custodyOf(remittance: ColorRemittance): Custody {
  const { assetId, derivationPrefix, derivationSuffix, senderIdentityKey } = remittance
  return { assetId, derivationPrefix, derivationSuffix, senderIdentityKey }
}

function tokenInputs(inputs: readonly ManagedInput[]): CreateActionInput[] {
  return inputs.map(input => ({
    outpoint: input.outpoint,
    unlockingScriptLength: UNLOCKING_SCRIPT_LENGTH,
    inputDescription: 'BRC-207 token input'
  }))
}

function custodyInstructions(custody: Custody): string {
  return JSON.stringify({ version: 1, ...custody })
}

/** The output without caller tags in the module's `color_` namespace (contract §2.2-6). */
function withoutColorTags(output: CreateActionOutput): CreateActionOutput {
  if (output.tags?.some(tag => tag.startsWith(COLOR_TAG_PREFIX)) !== true) return output
  const tags = output.tags.filter(tag => !tag.startsWith(COLOR_TAG_PREFIX))
  const { tags: _tags, ...rest } = output
  return tags.length === 0 ? rest : { ...rest, tags }
}

/**
 * The UTF-8 length of `text`, or a throw when it exceeds `maxBytes`. A string longer than
 * `maxBytes` UTF-16 units always exceeds it, so a huge string is refused before it is encoded.
 */
function boundedUtf8Length(text: string, maxBytes: number, label: string): number {
  const length = text.length > maxBytes ? Infinity : UTF8_ENCODER.encode(text).length
  if (length > maxBytes) throw new Error(`BRC-207: ${label} exceeds ${maxBytes} bytes`)
  return length
}

/**
 * Parses the receipt-format custody JSON stored in, or supplied as, an output's custom
 * instructions. Non-empty `profileData` fails unless `allowProfileData`, which returns it
 * structurally parsed for the caller to validate against the asset's requirements.
 */
function parseCustody(
  text: string,
  maxBytes: number | undefined,
  label: string,
  allowProfileData = false
): Custody & { profileData?: ProfileData } {
  if (maxBytes !== undefined) boundedUtf8Length(text, maxBytes, label)
  const bytes = UTF8_ENCODER.encode(text)
  const object = jsonObject(parseStrictJsonBytes(bytes, label), label)
  exactMembers(
    object,
    ['version', 'assetId', 'derivationPrefix', 'derivationSuffix', 'senderIdentityKey'],
    ['profileData'],
    label
  )
  if (object.version !== 1) throw new Error(`BRC-207: ${label} version must be 1`)
  const profileData = parseProfileData(object.profileData, `${label}.profileData`)
  const hasProfileData = profileData !== undefined && Object.keys(profileData).length > 0
  if (hasProfileData && !allowProfileData) {
    throw new Error(`BRC-207: ${label}.profileData names a profile the asset does not require`)
  }
  return {
    ...(hasProfileData ? { profileData } : {}),
    assetId: parseAssetSelector(object.assetId),
    derivationPrefix: validateRemittanceString(
      object.derivationPrefix,
      `${label}.derivationPrefix`
    ),
    derivationSuffix: validateRemittanceString(
      object.derivationSuffix,
      `${label}.derivationSuffix`
    ),
    senderIdentityKey: validateIdentityKey(object.senderIdentityKey, `${label}.senderIdentityKey`)
  }
}

/** The `p color` basket insertions of an internalizeAction, in order. */
function colorReceipts(
  args: InternalizeActionArgs
): Array<{ outputIndex: number; remittance: BasketInsertion }> {
  return args.outputs.flatMap(output => {
    const remittance = output.insertionRemittance
    return output.protocol === 'basket insertion' &&
      remittance?.basket.startsWith(`${COLOR_BASKET_NAMESPACE} `) === true
      ? [{ outputIndex: output.outputIndex, remittance }]
      : []
  })
}

/** What one receipt forwards to the wallet, and what the module stores for it. */
export interface ReceiptDecision {
  outputIndex: number
  /** The insertion forwarded to the wallet. */
  insertion: BasketInsertion
  /** Tx records to write, in order, before the wallet sees the receipt. */
  records: Array<[string, TxRecord]>
  /** Written after the records, only after a verified attestation covered the outputs. */
  settled?: SettledRecord
}

/** A receipt on the profiled path, after its structural parse. */
interface ProfiledReceipt {
  outputIndex: number
  remittance: BasketInsertion
  /** The UTF-8 length of its customInstructions. */
  bytes: number
  custody: Custody & { profileData?: ProfileData }
  /** The structurally parsed attested leaf for the custody's asset, with its JSON as carried. */
  attested?: { json: string; leaf: AttestedLeaf }
}

/** A profiled receipt once its output and asset are known. */
interface CheckedReceipt extends ProfiledReceipt {
  token: TokenOutput
  source: SourceOutput
  resolved: ResolvedAsset
}

/** The outcome of one attested asset's receipts in one transaction. */
interface AttestedOutcome {
  assetId: string
  outputIndexes: number[]
  /** Records in write order: anchors, pending ancestors, then the tip. */
  records: Array<[string, TxRecord]>
  /** Set when every receipt output of the tip is covered by a qualifying attestation. */
  settled?: SettledRecord
  /** The deploy to cache with the records. */
  declarationTx: Transaction
  /** The trust snapshot the decision used, rechecked before anything is written. */
  snapshot?: { handler: RequiredProfileHandler; value: string }
}

/** One attestation per (signer, txid, outputs), first kept, in order. */
function distinctAttestations(attestations: readonly ColorAttestation[]): ColorAttestation[] {
  const seen = new Set<string>()
  return attestations.filter(att => {
    const key = `${att.signer}:${att.txid}:${att.outputs.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * A stored tx record merged with a new one for the same txid, so a retry or a later receipt never
 * loses state: the stored bytes, role, state, labels and inputs are kept (an ancestor becomes a
 * receipt once this wallet holds its outputs), outputs and attestations are unions, and stored
 * off-chain values are kept unless empty.
 */
function mergeTxRecords(stored: TxRecord, incoming: TxRecord): TxRecord {
  const role = stored.role === 'ancestor' && incoming.role === 'receipt' ? 'receipt' : stored.role
  const state =
    role === 'receipt' ? (stored.role === 'receipt' ? stored.state : incoming.state) : stored.state
  return {
    v: 1,
    assetId: stored.assetId,
    rawTx: stored.rawTx,
    atomicBEEF: stored.atomicBEEF,
    role,
    ...(state === undefined ? {} : { state }),
    ...(stored.labels === undefined ? {} : { labels: stored.labels }),
    inputs: stored.inputs.length > 0 ? stored.inputs : incoming.inputs,
    outputs: [...new Set([...stored.outputs, ...incoming.outputs])].sort((a, b) => a - b),
    offChainValues: stored.offChainValues !== '' ? stored.offChainValues : incoming.offChainValues,
    attestations: distinctAttestations([...stored.attestations, ...incoming.attestations])
  }
}

/** A stored record's transaction when its raw bytes parse and hash to `txid`, else undefined. */
function storedTransaction(record: TxRecord, txid: string): Transaction | undefined {
  try {
    const tx = Transaction.fromHex(record.rawTx)
    return tx.id('hex') === txid ? tx : undefined
  } catch {
    return undefined
  }
}

/**
 * True when a stored record vouches for `output` as one of the wallet's own outputs of `assetId`:
 * a live (not aborted) receipt or hand-over record that lists the output as held, whose stored
 * transaction carries exactly this output's script and satoshis.
 */
function holdsStoredOutput(
  record: TxRecord | undefined,
  tx: Transaction | undefined,
  assetId: string,
  vout: number,
  output: SourceOutput
): boolean {
  if (record === undefined || tx === undefined) return false
  if (record.assetId !== assetId || record.role === 'ancestor' || record.state === 'aborted') {
    return false
  }
  if (!record.outputs.includes(vout)) return false
  const stored = tx.outputs[vout]
  return (
    stored !== undefined &&
    stored.satoshis === output.satoshis &&
    stored.lockingScript.toHex() === output.lockingScript.toHex()
  )
}

/**
 * What signAction keeps for `onResponse` of a profile action, by action reference: per profile
 * asset its submission data, same-asset inputs and wallet-owned outputs, and the plan labels.
 */
/**
 * How `spendable` decides an attested asset's held, unsettled (offline) outputs. Only a plain-noSend
 * hand-over (`offline`) spends them with no overlay contact: its recipient submits their
 * ancestors first. Every other action is published by this wallet (or, for a BRC-177 handoff,
 * its split is), so their acceptance is established first (pinned brc-0207: parents first).
 */
interface SpendContext {
  offline: boolean
  originator?: string
}

const PUBLISHED_SPEND: SpendContext = { offline: false }

/** True for a plain-noSend hand-over's arguments: `options.noSend` and no BRC-177 label. */
function plainNoSendArgs(args: Pick<CreateActionArgs, 'options' | 'labels'>): boolean {
  return (
    args.options?.noSend === true &&
    !(args.labels ?? []).some(label => label.startsWith(NOSEND_EXPIRY_LABEL_PREFIX))
  )
}

interface PendingHandoff {
  /** True for a plain-noSend hand-over (B2), which onResponse records and evidences. */
  plain: boolean
  /** The action's `p color plan` labels, as forwarded to the underlying createAction. */
  labels: string[]
  assets: Array<{
    assetId: string
    offChainValues: number[]
    /** Same-asset token input outpoints, in input order. */
    inputs: string[]
    /** Wallet-owned token outputs of the asset: plan ownedOutputs and token change. */
    outputs: number[]
  }>
}

/** True when a custody selector names the output's asset: `ISSUE` exactly for its deploy. */
function selectsAsset(selector: string, token: TokenOutput): boolean {
  return selector === ISSUE ? token.deploy : !token.deploy && selector === token.assetId
}

/** One asset's token units and authority outputs on one side of a transaction. */
export interface Holding {
  value: bigint
  authority: number
  /** The part of `value` in BRC-161 transfer outputs, which only value inputs can fund. */
  jsonValue?: bigint
}

/** What the caller's explicit inputs contribute to one asset, and how much of it is foreign. */
interface ExplicitHolding extends Holding {
  foreignValue: bigint
  foreignAuthority: number
}

/** The caller's explicit inputs and what they contribute per asset. */
interface ExplicitInputs {
  inputs: CreateActionInput[]
  managed: ManagedInput[]
  holdings: Map<string, ExplicitHolding>
  /** The tokens of the managed and readable foreign token inputs, as read. */
  tokens: TokenOutput[]
}

/** The requested outputs' token totals per existing asset, the deploy, and the outputs that leave the wallet. */
interface PlannedOutputs {
  holdings: Map<string, Holding>
  /** The tokens of the requested outputs other than a deploy (BRC-161 JSON included), as read. */
  tokens: TokenOutput[]
  deploy?: { operation: ColorOperationName }
  destinations: Array<{
    outputIndex: number
    assetId: string
    role: TokenRole
    amount: string
    lockingScript: string
  }>
}

/** A token change output the module adds, with the custody its key was derived with. */
interface TokenChange {
  assetId: string
  output: CreateActionOutput
  custody: Custody
}

/** One existing asset's funding: its selected inputs, token change and resulting outputs. */
interface AssetFunding {
  assetId: string
  selected: ManagedInput[]
  change: bigint
  outputs: Holding
}

const AUTHORITY_OPERATIONS: readonly ColorOperationName[] = [
  'authority-split',
  'authority-combine',
  'authority-transfer',
  'authority-end'
]

function holding<T extends Holding>(totals: Map<string, T>, assetId: string, empty: () => T): T {
  let entry = totals.get(assetId)
  if (entry === undefined) {
    entry = empty()
    totals.set(assetId, entry)
  }
  return entry
}

function emptyHolding(): Holding {
  return { value: 0n, authority: 0 }
}

function emptyExplicitHolding(): ExplicitHolding {
  return { value: 0n, authority: 0, foreignValue: 0n, foreignAuthority: 0 }
}

/** The BRC-207 authority operation for a transaction's authority input and output counts. */
export function authorityOperation(inputs: number, outputs: number): ColorOperationName {
  if (outputs === 0) return 'authority-end'
  if (outputs < inputs) return 'authority-combine'
  return outputs === inputs ? 'authority-transfer' : 'authority-split'
}

/** Authority inputs to select for a declared authority operation when the caller supplies none. */
function authorityInputsFor(operation: ColorOperationName, outputs: number): number {
  if (operation === 'authority-transfer') return outputs
  if (operation === 'authority-combine') return outputs + 1
  return 1
}

/**
 * The operations BRC-207 requires for one existing asset: value inputs fund value outputs
 * first, the rest of the inputs is burned and the rest of the outputs is minted.
 */
export function requiredOperations(inputs: Holding, outputs: Holding): ColorOperationName[] {
  if (inputs.authority === 0 && outputs.authority > 0)
    throw new Error('BRC-207: an authority output needs an authority input of the same asset')
  if ((outputs.jsonValue ?? 0n) > inputs.value)
    throw new Error(
      'BRC-207: BRC-161 transfer outputs exceed the value inputs; an authority cannot fund them'
    )
  const { transferred, burned, minted } = supplyChange(inputs, outputs)
  if (minted > 0n && inputs.authority === 0)
    throw new Error('BRC-207: token outputs exceed the authenticated input balance')
  const operations: ColorOperationName[] = []
  if (transferred > 0n) operations.push('transfer')
  if (burned > 0n) operations.push('burn')
  if (minted > 0n) operations.push('mint')
  if (inputs.authority > 0) operations.push(authorityOperation(inputs.authority, outputs.authority))
  return operations
}

function declaredOperations(plan: ColorPlan, assetId: string): Set<ColorOperationName> {
  return new Set(
    plan.operations.filter(operation => operation.assetId === assetId).map(op => op.operation)
  )
}

/** Fails unless the plan declares exactly the operations the asset's transaction requires. */
function assertOperations(plan: ColorPlan, assetId: string, required: ColorOperationName[]): void {
  const declared = declaredOperations(plan, assetId)
  if (declared.size !== required.length || required.some(operation => !declared.has(operation))) {
    throw new Error(
      `BRC-207: ${assetId} requires the operations [${required.join(', ')}] but the plan declares [${[...declared].join(', ')}]`
    )
  }
}

/** Supply accounting: value inputs fund value outputs first; the rest is burned or minted. */
export function supplyChange(
  inputs: Holding,
  outputs: Holding
): { transferred: bigint; burned: bigint; minted: bigint } {
  const transferred = outputs.value < inputs.value ? outputs.value : inputs.value
  return {
    transferred,
    burned: inputs.value - transferred,
    minted: outputs.value - transferred
  }
}

/**
 * What the user approves for a funded action: whether it is a hand-over the recipient completes
 * (`handoff`: a BRC-177 label, or `true` for a plain-noSend hand-over), the caller's
 * `seekPermission`, every asset leg, with this wallet's and foreign inputs, kept and outgoing
 * outputs and the supply change; satoshi totals and fee; the signatures the module releases; and
 * the lock time. BRC-100 `CreateActionArgs` declare no `seekPermission`, so it is read as an
 * untyped host extension and is `true` unless that member is `false` (contract §2.5). `read` is
 * the BRC-162 reader.
 */
export function actionConsent(
  plan: ColorPlan,
  createArgs: CreateActionArgs,
  tx: Transaction,
  tokens: TransactionTokens,
  managed: readonly ManagedInput[],
  scopes: ReadonlyMap<string, number>,
  handoff?: boolean,
  read: TokenReader = readTokenOutput
): Record<string, unknown> {
  const requested = createArgs.outputs ?? []
  const kept = (index: number): boolean =>
    requested[index]?.basket?.startsWith(`${COLOR_BASKET_NAMESPACE} `) === true ||
    plan.ownedOutputs.some(remittance => remittance.outputIndex === index)
  return {
    type: 'color_send',
    handoff:
      handoff === true ||
      (createArgs.labels ?? []).some(label => label.startsWith(NOSEND_EXPIRY_LABEL_PREFIX)),
    seekPermission: (createArgs as { seekPermission?: unknown }).seekPermission !== false,
    ...transactionConsent(
      tx,
      tokens,
      managed,
      kept,
      vout => vout < requested.length && !kept(vout),
      managed.map(input => ({
        outpoint: input.outpoint,
        inputIndex: tx.inputs.findIndex(candidate => inputOutpoint(candidate) === input.outpoint),
        sighashType: scopes.get(input.outpoint) ?? DEFAULT_SIGHASH
      })),
      plan.ownedOutputs.some(remittance => remittance.outputIndex === 0),
      read
    )
  }
}

export interface ReleasedSignature {
  outpoint: string
  inputIndex: number
  sighashType: number
}

/**
 * The facts the user approves for any transaction this wallet signs token inputs of, whether the
 * wallet funded it or an app built it: every asset leg with this wallet's (`own`) and foreign
 * inputs, kept and outgoing outputs and the supply change; the destinations; satoshi totals and
 * fee; the signatures released; and the lock time. `read` is the BRC-162 reader.
 */
export function transactionConsent(
  tx: Transaction,
  tokens: TransactionTokens,
  own: ReadonlyArray<{ assetId: string; role: TokenRole; amount: bigint }>,
  kept: (vout: number) => boolean,
  destination: (vout: number) => boolean,
  signatures: ReleasedSignature[],
  deployOwned: boolean,
  read: TokenReader = readTokenOutput
): Record<string, unknown> {
  const txid = tx.id('hex')
  const outputs = tx.outputs.map((output, vout) => ({
    vout,
    token: readSentToken(output.lockingScript, { txid, vout }, read),
    satoshis: output.satoshis ?? 0
  }))
  const assets = [...new Set([...tokens.inputs.keys(), ...tokens.outputs.keys()])].map(assetId => {
    const ownInputs = own.filter(input => input.assetId === assetId)
    const inputs = tokens.inputs.get(assetId) ?? emptyHolding()
    const all = tokens.outputs.get(assetId) ?? emptyHolding()
    const keptOutputs = outputs.filter(
      output => output.token?.assetId === assetId && !output.token.deploy && kept(output.vout)
    )
    const { transferred, burned, minted } = supplyChange(inputs, all)
    return {
      assetId,
      operations: requiredOperations(inputs, all),
      inputAmount: sumAmounts(ownInputs).toString(),
      foreignAmount: (inputs.value - sumAmounts(ownInputs)).toString(),
      authorityInputs: ownInputs.filter(input => input.role === 'authority').length,
      foreignAuthorityInputs:
        inputs.authority - ownInputs.filter(input => input.role === 'authority').length,
      keptAmount: sumAmounts(keptOutputs.map(output => output.token!)).toString(),
      keptAuthorities: keptOutputs.filter(output => output.token!.role === 'authority').length,
      outgoingAmount: (all.value - sumAmounts(keptOutputs.map(output => output.token!))).toString(),
      outgoingAuthorities:
        all.authority - keptOutputs.filter(output => output.token!.role === 'authority').length,
      transferred: transferred.toString(),
      burned: burned.toString(),
      minted: minted.toString()
    }
  })
  const inputSatoshis = tx.inputs.reduce(
    (total, input) =>
      total + (input.sourceTransaction!.outputs[input.sourceOutputIndex].satoshis ?? 0),
    0
  )
  const outputSatoshis = outputs.reduce((total, output) => total + output.satoshis, 0)
  return {
    ...(tokens.deploy === undefined
      ? {}
      : {
          deploy: {
            operation: deployOperation(tokens.deploy),
            amount: tokens.deploy.amount.toString(),
            owned: deployOwned
          }
        }),
    assets,
    destinations: outputs
      .filter(output => destination(output.vout))
      .map(output => ({
        outputIndex: output.vout,
        satoshis: output.satoshis,
        lockingScript: tx.outputs[output.vout].lockingScript.toHex(),
        ...(output.token === undefined
          ? {}
          : {
              assetId: output.token.deploy ? ISSUE : output.token.assetId,
              role: output.token.role,
              amount: output.token.amount.toString()
            })
      })),
    satoshis: {
      inputs: inputSatoshis,
      outputs: outputSatoshis,
      fee: inputSatoshis - outputSatoshis
    },
    signatures,
    lockTime: tx.lockTime
  }
}

/** Explicit inputs in their final places, with the module's token inputs in the remaining slots. */
function orderInputs(
  explicit: readonly CreateActionInput[],
  added: readonly CreateActionInput[],
  positions: ColorPlan['inputPositions']
): CreateActionInput[] {
  const all = [...explicit, ...added]
  if (positions.length === 0) return all
  const slots = new Map<number, CreateActionInput>()
  for (const { outpoint, index } of positions) {
    const input = explicit.find(candidate => candidate.outpoint === outpoint)
    if (input === undefined)
      throw new Error(
        'BRC-207: plan.inputPositions names an outpoint that is not an explicit input'
      )
    if (index >= all.length || slots.has(index))
      throw new Error('BRC-207: plan.inputPositions cannot be satisfied')
    slots.set(index, input)
  }
  const placed = new Set(slots.values())
  const rest = all.filter(input => !placed.has(input))
  return Array.from({ length: all.length }, (_, index) => slots.get(index) ?? rest.shift()!)
}

/**
 * Requested outputs at their own indices, then token change, each asset's change at its pinned
 * index if it has one. A change position cannot displace a requested output.
 */
function placeChange(
  outputs: readonly CreateActionOutput[],
  changes: ReadonlyArray<{ assetId: string; output: CreateActionOutput }>,
  positions: ColorPlan['changePositions']
): CreateActionOutput[] {
  const slots = new Map<number, CreateActionOutput>()
  for (const { assetId, index } of positions) {
    if (index < outputs.length)
      throw new Error('BRC-207: plan.changePositions conflict with the requested outputs')
    const change = changes.find(candidate => candidate.assetId === assetId)
    if (change === undefined || index >= outputs.length + changes.length)
      throw new Error('BRC-207: plan.changePositions cannot be satisfied')
    slots.set(index, change.output)
  }
  const placed = new Set(slots.values())
  const rest = changes.map(change => change.output).filter(output => !placed.has(output))
  return [
    ...outputs,
    ...Array.from(
      { length: changes.length },
      (_, offset) => slots.get(outputs.length + offset) ?? rest.shift()!
    )
  ]
}

/**
 * Reads a token in a transaction the wallet sends: BRC-162 first, then BRC-161 JSON, which the
 * module accounts for but never holds or creates. `read` is the BRC-162 reader.
 */
export function readSentToken(
  lockingScript: LockingScript,
  outpoint: ReturnType<typeof parseOutpoint>,
  read: TokenReader = readTokenOutput
): TokenOutput | undefined {
  return (
    tryReadTokenOutput(lockingScript, outpoint, read) ??
    readJsonTokenOutput(lockingScript, outpoint)
  )
}

/**
 * Token inputs of `tx` other than those in `except`, read from their source transactions. With
 * `json`, BRC-161 JSON inputs are read too. `read` is the BRC-162 reader.
 */
export function tokenSources(
  tx: Transaction,
  managed: ReadonlySet<string>,
  json = false,
  read: TokenReader = readTokenOutput
): Array<SourceOutput & { assetId: string; token: TokenOutput }> {
  const readSource = json ? readSentToken : tryReadTokenOutput
  return tx.inputs.flatMap(input => {
    const outpoint = inputOutpoint(input)
    const source = input.sourceTransaction?.outputs[input.sourceOutputIndex]
    if (managed.has(outpoint) || source?.satoshis === undefined) return []
    const token = readSource(source.lockingScript, parseOutpoint(outpoint), read)
    if (token === undefined) return []
    return [
      {
        outpoint,
        lockingScript: source.lockingScript,
        satoshis: source.satoshis,
        assetId: token.assetId,
        token
      }
    ]
  })
}

/**
 * The existing assets among a transaction's token inputs (read from `inputs`, which carries their
 * sources) and outputs, and whether output 0 is a deploy: the topics it is submitted to.
 */
export function submissionAssets(
  tx: Transaction,
  inputs: Transaction = tx,
  read: TokenReader = readTokenOutput
): { assetIds: string[]; deploy: boolean } {
  const txid = tx.id('hex')
  const outputs = tx.outputs.map((output, vout) =>
    readSentToken(output.lockingScript, { txid, vout }, read)
  )
  const assetIds = new Set([
    ...tokenSources(inputs, new Set(), true, read).map(input => input.assetId),
    ...outputs.flatMap(token => (token === undefined || token.deploy ? [] : [token.assetId]))
  ])
  return { assetIds: [...assetIds], deploy: outputs[0]?.deploy === true }
}

/** Runs one input's unlocking script against its source output; throws when it does not unlock. */
export function assertUnlocks(tx: Transaction, inputIndex: number): void {
  const input = tx.inputs[inputIndex]
  const source = input.sourceTransaction?.outputs[input.sourceOutputIndex]
  if (source?.satoshis === undefined || input.unlockingScript === undefined)
    throw new Error(`BRC-207: transaction input ${inputIndex} lacks its source or unlocking script`)
  new Spend({
    sourceTXID: input.sourceTransaction!.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: source.satoshis,
    lockingScript: source.lockingScript,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, index) => index !== inputIndex),
    outputs: tx.outputs,
    inputIndex,
    unlockingScript: input.unlockingScript,
    inputSequence: input.sequence ?? 0xffffffff,
    lockTime: tx.lockTime
  }).validate()
}

function addToken(totals: Map<string, Holding>, token: TokenOutput): void {
  const entry = holding(totals, token.assetId, emptyHolding)
  if (token.role === 'value') entry.value += token.amount
  else entry.authority += 1
  if (token.encoding === 'brc161' && token.jsonOperation !== 'mint')
    entry.jsonValue = (entry.jsonValue ?? 0n) + token.amount
}

/** A foreign input's source output from the caller's inputBEEF, if it is there. */
function foreignSource(beef: Beef | undefined, outpoint: string): SourceOutput | undefined {
  const { txid, vout } = parseOutpoint(outpoint)
  const output = beef?.findTxid(txid)?.tx?.outputs[vout]
  if (output?.satoshis === undefined) return undefined
  return { outpoint, lockingScript: output.lockingScript, satoshis: output.satoshis }
}

/** A transaction's token inputs and outputs per existing asset, and its deploy output. */
export interface TransactionTokens {
  consumed: Array<SourceOutput & { assetId: string; token: TokenOutput }>
  inputs: Map<string, Holding>
  outputs: Map<string, Holding>
  deploy?: TokenOutput
}

/**
 * Reads every input's source and every output; an input without its source fails. With `json`,
 * for a transaction the wallet sends, BRC-161 JSON inputs and outputs are read too. `read` is the
 * BRC-162 reader.
 */
export function transactionTokens(
  tx: Transaction,
  json = false,
  read: TokenReader = readTokenOutput
): TransactionTokens {
  tx.inputs.forEach((input, index) => {
    if (input.sourceTransaction === undefined)
      throw new Error(`BRC-207: input ${index} has no source transaction to authenticate`)
  })
  const txid = tx.id('hex')
  const consumed = tokenSources(tx, new Set(), json, read)
  const inputs = new Map<string, Holding>()
  for (const source of consumed) addToken(inputs, source.token)
  const outputs = new Map<string, Holding>()
  let deploy: TokenOutput | undefined
  tx.outputs.forEach((output, vout) => {
    const token = json
      ? readAnyTokenOutput(output.lockingScript, { txid, vout }, read)
      : read(output.lockingScript, { txid, vout })
    if (token?.deploy === true && token.encoding === 'brc161')
      throw new Error('BRC-207: a new issuance must use BRC-162')
    if (token?.deploy === true) deploy = token
    else if (token !== undefined) addToken(outputs, token)
  })
  return { consumed, inputs, outputs, deploy }
}

export function deployOperation(token: TokenOutput): ColorOperationName {
  return token.amount > 0n ? 'deploy-fixed' : 'deploy-authority'
}

/** Fails unless the plan's operations and assets are exactly what the transaction performs. */
export function assertTransactionOperations(plan: ColorPlan, tokens: TransactionTokens): void {
  const assetIds = new Set([...tokens.inputs.keys(), ...tokens.outputs.keys()])
  assertPlanAssets(plan, new Set([...assetIds, ...(tokens.deploy === undefined ? [] : [ISSUE])]))
  if (tokens.deploy !== undefined) assertOperations(plan, ISSUE, [deployOperation(tokens.deploy)])
  for (const assetId of assetIds)
    assertOperations(
      plan,
      assetId,
      requiredOperations(
        tokens.inputs.get(assetId) ?? emptyHolding(),
        tokens.outputs.get(assetId) ?? emptyHolding()
      )
    )
}

/** The sighash type for each managed input; an override must name one the module signs. */
export function sighashScopes(plan: ColorPlan, managed: ReadonlySet<string>): Map<string, number> {
  const scopes = new Map<string, number>()
  for (const { outpoint, sighashType } of plan.sighashTypes) {
    if (!managed.has(outpoint))
      throw new Error('BRC-207: plan.sighashTypes names an input this wallet does not sign')
    scopes.set(outpoint, sighashType)
  }
  return scopes
}

/** The plan names exactly the assets among the action's token inputs and outputs. */
export function assertPlanAssets(plan: ColorPlan, involved: ReadonlySet<string>): void {
  if (plan.assets.length !== involved.size || plan.assets.some(assetId => !involved.has(assetId)))
    throw new Error('BRC-207: plan.assets must name exactly the assets the action moves')
}

/** Largest amount first. */
/**
 * Chooses unrejected candidates, in their order, until they cover `target`: units for value, a count
 * for authority. Undefined when they cannot.
 */
function chooseCandidates(
  candidates: readonly Candidate[],
  rejected: ReadonlySet<string>,
  role: TokenRole,
  target: bigint
): Candidate[] | undefined {
  const chosen: Candidate[] = []
  let total = 0n
  for (const candidate of candidates) {
    if (total >= target) break
    if (rejected.has(candidate.outpoint)) continue
    chosen.push(candidate)
    total += role === 'value' ? candidate.amount : 1n
  }
  return total < target ? undefined : chosen
}

function byAmountDescending(a: { amount: bigint }, b: { amount: bigint }): number {
  if (a.amount === b.amount) return 0
  return a.amount > b.amount ? -1 : 1
}

interface InventoryRecord {
  output: WalletOutput
  assetId: string
  source: SourceOutput
}

interface InventoryView {
  record: InventoryRecord
  state: InventoryState
  tags: string[]
}

/** The token outputs of a namespace listing, read with `read`. */
function inventoryRecords(
  outputs: WalletOutput[],
  beef: Beef | undefined,
  read: TokenReader
): InventoryRecord[] {
  const records: InventoryRecord[] = []
  for (const output of outputs) {
    const outpoint = parseOutpoint(output.outpoint)
    const lockingScript =
      beef === undefined
        ? LockingScript.fromHex(output.lockingScript ?? '')
        : beef.findTxid(outpoint.txid)?.tx?.outputs[outpoint.vout]?.lockingScript
    if (lockingScript === undefined) continue
    let token: TokenOutput | undefined
    try {
      token = tryReadTokenOutput(lockingScript, outpoint, read)
    } catch {
      continue // an unsupported asset's outputs are left out of the inventory
    }
    if (token === undefined) continue
    records.push({
      output,
      assetId: token.assetId,
      source: { outpoint: output.outpoint, lockingScript, satoshis: output.satoshis }
    })
  }
  return records
}

/**
 * Restricted when the overlay finally refused the output's transaction, else reserved by a pending
 * action, else available. Wallet and store state only; the overlay is not consulted.
 */
function inventoryState(record: InventoryRecord, status?: SettlementState): InventoryState {
  if (status?.refused.has(parseOutpoint(record.output.outpoint).txid) === true) return 'restricted'
  return record.output.spendable ? 'available' : 'reserved'
}

/**
 * An output's stored tags without state tags. With profiles registered, the stored
 * `color_offline` tag is dropped once its transaction has a settled record (contract §2.2-6), so a
 * lost store shows the coin offline again (fail safe).
 */
function storedViewTags(output: WalletOutput, status?: SettlementState): string[] {
  const settled =
    status?.settled.has(parseOutpoint(output.outpoint).txid) === true
      ? COLOR_OFFLINE_TAG
      : undefined
  return (output.tags ?? []).filter(tag => !tag.startsWith(STATE_TAG_PREFIX) && tag !== settled)
}

/**
 * A BRC-162 token output, or undefined for a script that is not one. A token-shaped script that
 * does not decode is an ordinary satoshi output; a valid output of an asset that requires
 * processing profiles is a token this wallet cannot evaluate, and fails (BRC-207 L92-95), as
 * does a malformed `req` or `ext` under the profile-aware reader (0207:88-91). Errors are
 * matched by name, never `instanceof` (D22). `read` is the BRC-162 reader.
 */
export function tryReadTokenOutput(
  lockingScript: LockingScript,
  outpoint: ReturnType<typeof parseOutpoint>,
  read: TokenReader = readTokenOutput
): TokenOutput | undefined {
  try {
    return read(lockingScript, outpoint)
  } catch (error) {
    if (
      isNamedError(error, 'UnsupportedProfileError') ||
      isNamedError(error, 'ProfileParamsError')
    ) {
      throw error
    }
    return undefined
  }
}

/** A record with its stored tags and the computed state tag in place of any stored one. */
function inventoryView(record: InventoryRecord, status?: SettlementState): InventoryView {
  const state = inventoryState(record, status)
  const tags = [...storedViewTags(record.output, status), `${STATE_TAG_PREFIX}${state}`]
  return { record, state, tags }
}

/** A BEEF holding only the transactions of the returned page. */
function pageBeef(beef: Beef, page: readonly InventoryView[]): number[] {
  const result = new Beef()
  for (const txid of new Set(page.map(view => parseOutpoint(view.record.output.outpoint).txid))) {
    const tx = beef.findAtomicTransaction(txid)
    if (tx !== undefined) result.mergeTransaction(tx)
  }
  return result.toBinary()
}

function matchesTags(
  tags: readonly string[],
  filter: readonly string[],
  mode: ListOutputsArgs['tagQueryMode']
): boolean {
  if (filter.length === 0) return true
  return mode === 'all'
    ? filter.every(tag => tags.includes(tag))
    : filter.some(tag => tags.includes(tag))
}

/**
 * BRC-207 `color` wallet module for BRC-162 fungible tokens.
 *
 * Register it as `permissionModules: { color }` on a WalletPermissionsManager. It
 * verifies and accepts receipts, funds token sends from its per-asset baskets and
 * signs their inputs during `signAction`, signs app-built transactions through
 * `createSignature`, and answers the `p color assets` and `p color balance` views.
 */
export class ColorPermissionModule implements PermissionsModule {
  protected readonly wallet: WalletInterface
  protected readonly provider: ColorOverlayProvider
  protected readonly requestTokenAccess: ColorTokenAccessHandler
  /** Registered required-profile handlers by profile id; empty when the host registers none. */
  protected readonly profiles: ReadonlyMap<string, RequiredProfileHandler>
  /** The host's durable store; never used when no profiles are registered. */
  protected readonly store?: ColorModuleStore
  /** Typed records over `store`; constructed only when profiles are registered. */
  protected readonly colorStore?: ColorStore
  /** The BRC-162 reader: `readTokenOutput` without profiles, else the profile-aware reader. */
  protected readonly read: TokenReader
  /**
   * BRC-205 attributes for BRC-207's Discovery section: this module implements revision 4, and
   * `brc207-color-attested` 1 when the attested profile is registered (0207:1501-1506).
   */
  readonly capabilities: Readonly<Record<string, string>>
  /** Outputs a send in progress has selected, so a concurrent send does not select them too. */
  protected readonly selected = new Set<string>()
  /** Asset resolutions by asset id, in flight or done; a failed one is forgotten. */
  protected readonly supportedAssets = new Map<string, Promise<ResolvedAsset>>()
  /** Profile actions signed here and not yet answered, by action reference. */
  protected readonly pendingHandoffs = new Map<string, PendingHandoff>()
  /** Single-flight settlement (contract §2.3); constructed only when profiles are registered. */
  protected readonly settler?: ColorSettler
  protected identityKey?: Promise<string>

  constructor(options: ColorPermissionModuleOptions) {
    if (options?.wallet == null) throw new TypeError('BRC-207: wallet is required')
    if (options.provider == null) throw new TypeError('BRC-207: provider is required')
    if (typeof options.requestTokenAccess !== 'function') {
      throw new TypeError('BRC-207: requestTokenAccess is required')
    }
    this.profiles = validateProfileHandlers(options.profiles)
    if (this.profiles.size > 0 && options.store == null) {
      throw new TypeError('BRC-207: a store is required when profiles are registered')
    }
    if (
      this.profiles.size > 0 &&
      !(['get', 'set', 'delete', 'keys'] as const).every(
        method => typeof options.store?.[method] === 'function'
      )
    ) {
      throw new TypeError('BRC-207: the store must implement get, set, delete and keys')
    }
    this.wallet = options.wallet
    this.provider = options.provider
    this.requestTokenAccess = options.requestTokenAccess
    this.store = options.store ?? undefined
    const capabilities: Record<string, string> = { 'brc207-color': '4' }
    if (this.profiles.has(ATTESTED_PROFILE_ID)) capabilities['brc207-color-attested'] = '1'
    this.capabilities = Object.freeze(capabilities)
    if (this.profiles.size > 0) {
      this.colorStore = new ColorStore(options.store!)
      this.read = readProfiledTokenOutput
      this.settler = new ColorSettler({
        store: this.colorStore,
        resolve: async assetId => await this.resolveAsset(assetId),
        qualifies: async assetId => await this.qualifiesFor(assetId),
        wallet: this.wallet,
        holds: async (outpoint, assetId) => await this.holds(outpoint, assetId),
        tokenOutputs: (tx, assetId) => this.tokenVouts(tx, assetId)
      })
    } else {
      this.read = readTokenOutput
    }
  }

  /**
   * Sync and idempotent: clears in-memory selections, asset checks, pending hand-overs and the
   * settler's latches. An in-flight `settle()` resolves, but no new submit starts afterwards.
   */
  dispose(): void {
    this.selected.clear()
    this.supportedAssets.clear()
    this.pendingHandoffs.clear()
    this.identityKey = undefined
    this.settler?.dispose()
  }

  /**
   * Settles offline state against the overlay (contract §2.3): every offline-credited receipt,
   * every own plain-noSend hand-over its overlay already admitted, and the hand-overs named in
   * `txids` (whose intent is kept until they settle). Single-flight; overlay refusals are
   * reported, never thrown. Without profiles there is nothing to settle.
   */
  async settle(request?: ColorSettleRequest, originator?: string): Promise<ColorSettleReport> {
    if (this.settler === undefined) return { results: [] }
    return await this.settler.settle(request, originator)
  }

  /** True iff a verified attestation settled `txid` (its `color.v1.settled.` record exists). */
  async isSettled(txid: string): Promise<boolean> {
    if (this.colorStore === undefined || typeof txid !== 'string' || !TXID_PATTERN.test(txid)) {
      return false
    }
    return (await this.colorStore.settled(txid)) !== undefined
  }

  /** Protocol- and basket-routed calls: key and signature operations and the read views. */
  async handleRequest(
    req: PermissionsModuleRequest,
    next: PermissionsModuleNext
  ): Promise<unknown> {
    switch (req.method) {
      case 'getPublicKey':
      case 'verifySignature':
        this.parseKeyArgs(req.args as { protocolID?: unknown; keyID?: unknown })
        return await next(req.args)
      case 'createSignature':
        return await this.createSignature(req.args as CreateSignatureArgs, req.originator, next)
      case 'listOutputs':
        return await this.listOutputs(req.args as ListOutputsArgs, req.originator, next)
      case 'relinquishOutput': {
        // RelinquishOutputArgs declare no seekPermission: it is read as a host extension.
        const { basket, output, seekPermission } = req.args as {
          basket: string
          output: string
          seekPermission?: unknown
        }
        const target = parseAssetBasket(basket)
        if (target === undefined) {
          throw new Error('BRC-207: only per-asset baskets hold outputs that can be relinquished')
        }
        await this.approve(req.originator, {
          type: 'color_relinquish',
          assetId: target.assetId,
          role: target.role,
          outpoint: output,
          seekPermission: seekPermission !== false
        })
        return await next(req.args)
      }
      default:
        throw new Error(`BRC-207: ${req.method} is not available in the p color namespace`)
    }
  }

  /** Label- and basket-routed actions. */
  async onRequest(req: PermissionsModuleRequest): Promise<{ args: object }> {
    switch (req.method) {
      case 'createAction':
        return { args: await this.createAction(req.args as CreateActionArgs, req.originator) }
      case 'signAction':
        return {
          args: await this.signAction(req.args as SignActionArgs, req.action, req.originator)
        }
      case 'internalizeAction':
        return {
          args: await this.internalizeAction(req.args as InternalizeActionArgs, req.originator)
        }
      case 'listActions': {
        const args = req.args as ListActionsArgs
        await this.authorizeRead(req.originator, {
          labels: (args.labels ?? []).filter(label => label.startsWith(COLOR_BASKET_NAMESPACE)),
          seekPermission: args.seekPermission !== false
        })
        return { args }
      }
      default:
        throw new Error(`BRC-207: ${req.method} is not available in the p color namespace`)
    }
  }

  async onResponse(
    res: unknown,
    context: { method: string; originator: string; action?: PermissionsModuleAction }
  ): Promise<unknown> {
    if (context.method === 'signAction' && context.action !== undefined) {
      const pending = this.pendingHandoffs.get(context.action.reference)
      this.pendingHandoffs.delete(context.action.reference)
      await this.fileDeploy(res as SignActionResult, context.action, context.originator)
      // A plain-noSend hand-over is never sent here, whatever noSend the host derived for the
      // action (signAction fixed its send mode): its recipient submits it, parents first.
      if (pending?.plain === true) {
        const colorHandoff = await this.recordHandoff(res as SignActionResult, pending)
        return { ...(res as SignActionResult), colorHandoff }
      }
      // Any other noSend action is a BRC-177 handoff (createAction refuses the rest): its receiver
      // submits it.
      if (!context.action.noSend)
        await this.submitSigned(res as SignActionResult, context.action.transaction, pending)
    }
    return res
  }

  /**
   * The receipt-ready evidence of an own plain-noSend hand-over, rebuilt from the store: the same
   * object its signAction result carried as `colorHandoff`, for a resend after a lost ACK (C51).
   * Undefined without profiles, for a txid that is not a stored hand-over, and for an aborted one.
   */
  async handoffEvidence(txid: string): Promise<ColorHandoffResult | undefined> {
    if (this.profiles.size === 0) return undefined
    const record = await this.colorStore!.getTx(txid)
    if (record?.role !== 'handover' || record.state === 'aborted') return undefined
    return await this.handoffResult(txid, record)
  }

  /**
   * Records a signed plain-noSend hand-over durably, then returns its evidence (contract
   * §2.2-8/9). The signed transaction must be the one the result names and spend the inputs it
   * was planned with; nothing is written otherwise. The record keeps the exact AtomicBEEF the
   * wallet returned, which settle later submits verbatim.
   */
  protected async recordHandoff(
    result: SignActionResult,
    pending: PendingHandoff
  ): Promise<ColorHandoffResult> {
    if (result?.tx === undefined) {
      throw new Error('BRC-207: the signed hand-over returned no transaction')
    }
    const tx = parsed('the signed hand-over', () => Transaction.fromAtomicBEEF(result.tx!))
    const txid = tx.id('hex')
    if (result.txid !== txid) {
      throw new Error('BRC-207: the signed hand-over does not match its txid')
    }
    const spent = new Set(tx.inputs.map(input => inputOutpoint(input)))
    if (pending.assets.some(asset => asset.inputs.some(outpoint => !spent.has(outpoint)))) {
      throw new Error('BRC-207: the signed hand-over does not spend its planned inputs')
    }
    const [asset] = pending.assets
    const record: TxRecord = {
      v: 1,
      assetId: asset.assetId,
      rawTx: tx.toHex(),
      atomicBEEF: toHex(Array.from(result.tx)),
      role: 'handover',
      labels: pending.labels,
      inputs: asset.inputs,
      outputs: asset.outputs,
      offChainValues: toHex(asset.offChainValues),
      attestations: []
    }
    await this.putTxRecord(txid, record)
    return await this.handoffResult(txid, (await this.colorStore!.getTx(txid)) ?? record)
  }

  /** A hand-over's `ColorHandoffResult`: the full attested leaf for an attested asset, else none. */
  protected async handoffResult(txid: string, record: TxRecord): Promise<ColorHandoffResult> {
    const resolved = await this.resolveAsset(record.assetId)
    const profileData: ProfileData = {}
    if (resolved.attested !== undefined) {
      profileData[ATTESTED_PROFILE_ID] = {
        [record.assetId]: await this.buildAttestedLeaf(record.assetId, txid)
      }
    }
    return { version: 1, txid, profileData }
  }

  /**
   * The attested leaf (contract §7.1) for a stored transaction of `assetId`: its declarationTx,
   * the unattested ancestors behind its inputs (parents first, without the tip), the attestations
   * of the anchors they reach, and a submission per unattested transaction including the tip.
   */
  protected async buildAttestedLeaf(assetId: string, tipTxid: string): Promise<JsonValue> {
    const tip = await this.colorStore!.getTx(tipTxid)
    if (tip?.assetId !== assetId) {
      throw new AttestationEvidenceError(`evidence for ${tipTxid} is unavailable`)
    }
    const resolved = await this.resolveAsset(assetId)
    const { records, attestations } = await this.attestedEvidence(assetId, tip.inputs)
    return {
      declarationTx: resolved.declarationTx!.toHex(),
      transactions: records.map(([, record]) => record.rawTx),
      attestations: attestations.map(({ txid, outputs, signer, signature }) => ({
        txid,
        outputs: [...outputs],
        signer,
        signature
      })),
      submissions: [
        ...records.map(([txid, record]) => ({ txid, offChainValues: record.offChainValues })),
        { txid: tipTxid, offChainValues: tip.offChainValues }
      ]
    }
  }

  /**
   * Walks stored records back from `outpoints`, deduplicated and parents first. An outpoint that
   * its record's attestations cover is an anchor; any other record is an unattested ancestor
   * whose inputs are walked in turn. A missing record, one of another asset, or an aborted one
   * (its outputs no longer exist) fails: there is no evidence for that input.
   */
  protected async attestedEvidence(
    assetId: string,
    outpoints: readonly string[]
  ): Promise<{ records: Array<[string, TxRecord]>; attestations: ColorAttestation[] }> {
    const store = this.colorStore!
    const records: Array<[string, TxRecord]> = []
    const anchors: ColorAttestation[] = []
    const visited = new Set<string>()
    const visit = async (outpoint: string): Promise<void> => {
      const { txid, vout } = parseOutpoint(outpoint)
      const record = await store.getTx(txid)
      if (record === undefined || record.assetId !== assetId || record.state === 'aborted') {
        throw new AttestationEvidenceError(`evidence for input ${outpoint} is unavailable`)
      }
      const covering = record.attestations.filter(
        att => att.txid === txid && att.outputs.includes(vout)
      )
      if (covering.length > 0) {
        anchors.push(...covering)
        return
      }
      if (visited.has(txid)) return
      visited.add(txid)
      for (const input of record.inputs) await visit(input)
      records.push([txid, record])
    }
    for (const outpoint of outpoints) await visit(outpoint)
    return { records, attestations: distinctAttestations(anchors) }
  }

  /**
   * Files a signed deploy this wallet keeps in its asset's value or authority basket, now that
   * the asset ID is final. The deploy keeps its `ISSUE` key; its asset overlay must admit it
   * before it can be spent.
   */
  protected async fileDeploy(
    result: SignActionResult,
    action: PermissionsModuleAction,
    originator: string
  ): Promise<void> {
    if (result?.tx === undefined) return
    const tx = Transaction.fromAtomicBEEF(result.tx)
    const txid = tx.id('hex')
    const deploy = tryReadTokenOutput(
      tx.outputs[0]?.lockingScript ?? new LockingScript(),
      { txid, vout: 0 },
      this.read
    )
    const owned = ColorPlan.fromLabels(action.createArgs?.labels)?.ownedOutputs.some(
      remittance => remittance.outputIndex === 0 && remittance.assetId === ISSUE
    )
    if (deploy?.deploy !== true || owned !== true) return
    // The underlying wallet merges the insertion into its own signed transaction: the basket and
    // the custody (encrypted at createAction) are assigned and the transaction's status is kept.
    const customInstructions = action.createArgs?.outputs?.[0]?.customInstructions
    await this.wallet.internalizeAction(
      {
        tx: result.tx,
        description: 'File the deployed asset',
        outputs: [
          {
            outputIndex: 0,
            protocol: 'basket insertion',
            insertionRemittance: {
              basket: assetBasket(deploy.assetId, deploy.role),
              ...(customInstructions === undefined ? {} : { customInstructions })
            }
          }
        ]
      },
      originator
    )
  }

  /* ----------------------------------------------------------------------
   * Receive
   * ---------------------------------------------------------------------- */

  /**
   * Verifies every `p color` receipt and returns the arguments to forward to the wallet. Without
   * profiles the caller must already have submitted the transaction, and `args` is returned
   * unchanged. With profiles, see `internalizeProfiled`.
   */
  protected async internalizeAction(
    args: InternalizeActionArgs,
    originator: string
  ): Promise<InternalizeActionArgs> {
    if ((args.labels ?? []).some(label => label.startsWith(`${COLOR_BASKET_NAMESPACE} `))) {
      throw new Error('BRC-207: p color labels have no meaning in internalizeAction')
    }
    const tx = parsed('the received transaction', () => Transaction.fromAtomicBEEF(args.tx))
    const receipts = colorReceipts(args)
    if (receipts.length === 0) return args
    if (this.profiles.size > 0)
      return await this.internalizeProfiled(args, tx, receipts, originator)
    await this.assertCompletedTransaction(tx)
    await eachInOrder(receipts, async ({ outputIndex, remittance }) => {
      await this.verifyReceipt(tx, outputIndex, remittance, originator)
    })
    return args
  }

  /**
   * Checks a received transaction: every input unlocks its source and every asset it involves is
   * supported. Token amounts are not re-evaluated: the received output must be admitted and
   * unspent, and its overlay admits it only after applying the amount and authority rules.
   */
  protected async assertCompletedTransaction(tx: Transaction): Promise<void> {
    for (let index = 0; index < tx.inputs.length; index++) assertUnlocks(tx, index)
    const { inputs, outputs } = transactionTokens(tx)
    await this.assertSupportedAssets([...inputs.keys(), ...outputs.keys()])
  }

  /** Checks each distinct asset in order, so the first unsupported one is the one reported. */
  protected async assertSupportedAssets(assetIds: Iterable<string>): Promise<void> {
    await eachInOrder(new Set(assetIds), async assetId => {
      await this.assertSupportedAsset(assetId)
    })
  }

  /**
   * One receipt without profiles (0.1.0): its custody, its output's asset, owner and basket, and
   * overlay admission. The decision forwards the insertion unchanged and stores nothing.
   */
  protected async verifyReceipt(
    tx: Transaction,
    outputIndex: number,
    remittance: BasketInsertion,
    originator: string
  ): Promise<ReceiptDecision> {
    const target = parseAssetBasket(remittance.basket)
    if (target === undefined)
      throw new Error('BRC-207: a receipt must name a per-asset value or authority basket')
    const custody = parseCustody(
      remittance.customInstructions ?? '',
      MAX_RECEIPT_INSTRUCTION_BYTES,
      'receipt customInstructions'
    )
    const source = tx.outputs[outputIndex]
    if (source?.satoshis === undefined)
      throw new Error('BRC-207: the receipt names a missing output')
    const txid = tx.id('hex')
    const token = readTokenOutput(source.lockingScript, { txid, vout: outputIndex })
    if (token === undefined)
      throw new Error('BRC-207: the received output is not a BRC-162 token output')
    if (!selectsAsset(custody.assetId, token)) {
      throw new Error('BRC-207: the receipt instructions name a different asset than the output')
    }
    if (target.assetId !== token.assetId || target.role !== token.role) {
      throw new Error('BRC-207: the receipt basket does not match the received output')
    }
    await this.assertOwned(token, custody, custody.senderIdentityKey, originator)
    await this.assertSupportedAsset(token.assetId)
    const outpoint = outpointString(txid, outputIndex)
    const admitted = await this.spendable(token.assetId, [
      { outpoint, lockingScript: source.lockingScript, satoshis: source.satoshis }
    ])
    if (!admitted.has(outpoint)) {
      throw new Error(
        'BRC-207: the received output is not admitted and unspent in its asset overlay'
      )
    }
    return { outputIndex, insertion: remittance, records: [] }
  }

  /**
   * The receipt path with profiles registered (contract §2.2-5, 6 and 8). In order:
   * 1. every receipt's customInstructions is bounded at 16 MiB, each and in aggregate;
   * 2. before any asset is resolved, every receipt's custody is parsed and each attested leaf
   *    structurally, collecting the declarationTx evidence;
   * 3. every asset of the transaction is resolved with that evidence (so a never-seen asset
   *    resolves with no connectivity), every input must unlock, every token must conform to its
   *    deploy, and each receipt must fit its asset's `maxReceiptBytes`;
   * 4. `profileData` must name only declared profiles and the receipt's own asset; a non-attested
   *    leaf goes to its handler's `checkReceiptData`, or fails;
   * 5. basket, role and ownership are checked;
   * 6. an asset without the attested profile needs current spendability, as in 0.1.0; an attested
   *    asset's receipts are decided by `attestedOutcome` (frontier, coverage, consent);
   * 7. the trust snapshot is rechecked, then the records are written (anchors, ancestors, the
   *    deploy, the tip), then any settled record;
   * 8. the wallet gets the 5-member custody JSON, the caller's tags without `color_*`, and
   *    `color_offline` for a receipt credited without a covering attestation.
   */
  protected async internalizeProfiled(
    args: InternalizeActionArgs,
    tx: Transaction,
    receipts: ReadonlyArray<{ outputIndex: number; remittance: BasketInsertion }>,
    originator: string
  ): Promise<InternalizeActionArgs> {
    const label = 'receipt customInstructions'
    let total = 0
    const sized = receipts.map(receipt => {
      const text = receipt.remittance.customInstructions ?? ''
      const bytes = boundedUtf8Length(text, MAX_PARSED_RECEIPT_BYTES, label)
      total += bytes
      return { ...receipt, text, bytes }
    })
    if (total > MAX_PARSED_RECEIPT_BYTES) {
      throw new Error(
        `BRC-207: receipt customInstructions exceed ${MAX_PARSED_RECEIPT_BYTES} bytes in aggregate`
      )
    }

    const evidence = new Map<string, string>()
    const profiled: ProfiledReceipt[] = sized.map(({ outputIndex, remittance, text, bytes }) => {
      const custody = parseCustody(text, MAX_PARSED_RECEIPT_BYTES, label, true)
      let attested: ProfiledReceipt['attested']
      for (const [assetKey, value] of Object.entries(
        custody.profileData?.[ATTESTED_PROFILE_ID] ?? {}
      )) {
        const leaf = parseAttestedLeaf(value, assetKey)
        evidence.set(assetKey, leaf.declarationTx.toHex())
        if (assetKey === custody.assetId) attested = { json: JSON.stringify(value), leaf }
      }
      return {
        outputIndex,
        remittance,
        bytes,
        custody,
        ...(attested === undefined ? {} : { attested })
      }
    })

    for (let index = 0; index < tx.inputs.length; index++) assertUnlocks(tx, index)
    const txid = tx.id('hex')
    const { consumed } = transactionTokens(tx, false, this.read)
    // As in 0.1.0, a new deploy among the outputs is resolved only when it is itself a receipt.
    const outputTokens = tx.outputs.flatMap((output, vout) => {
      const token = this.read(output.lockingScript, { txid, vout })
      return token === undefined || token.deploy ? [] : [token]
    })
    const located = profiled.map(receipt => {
      const output = tx.outputs[receipt.outputIndex]
      if (output?.satoshis === undefined)
        throw new Error('BRC-207: the receipt names a missing output')
      const token = tryReadTokenOutput(
        output.lockingScript,
        { txid, vout: receipt.outputIndex },
        this.read
      )
      if (token === undefined)
        throw new Error('BRC-207: the received output is not a BRC-162 token output')
      const source: SourceOutput = {
        outpoint: outpointString(txid, receipt.outputIndex),
        lockingScript: output.lockingScript,
        satoshis: output.satoshis
      }
      return { ...receipt, token, source }
    })
    const assets = new Map<string, ResolvedAsset>()
    const involved = [
      ...located.map(receipt => receipt.token.assetId),
      ...consumed.map(input => input.assetId),
      ...outputTokens.map(token => token.assetId)
    ]
    await eachInOrder(new Set(involved), async assetId => {
      const declarationTx = evidence.get(assetId)
      assets.set(
        assetId,
        await this.resolveAsset(
          assetId,
          declarationTx === undefined ? undefined : { declarationTx }
        )
      )
    })
    // BRC-161 JSON legs of the transaction's assets conform too: they supply no ext state.
    const jsonLegs = [
      ...tokenSources(tx, new Set(), true, this.read).map(input => input.token),
      ...this.outputTokens(tx)
    ].filter(token => token.encoding === 'brc161' && assets.has(token.assetId))
    await this.assertConformingTokens([
      ...consumed.map(input => input.token),
      ...outputTokens,
      ...jsonLegs
    ])

    const checked: CheckedReceipt[] = []
    for (const receipt of located) {
      const resolved = assets.get(receipt.token.assetId)!
      if (receipt.bytes > resolved.maxReceiptBytes) {
        throw new Error(`BRC-207: ${label} exceeds ${resolved.maxReceiptBytes} bytes`)
      }
      checked.push({ ...receipt, resolved })
    }
    for (const receipt of checked) await this.checkReceiptProfileData(receipt, originator)
    for (const receipt of checked) {
      const target = parseAssetBasket(receipt.remittance.basket)
      if (target === undefined)
        throw new Error('BRC-207: a receipt must name a per-asset value or authority basket')
      if (!selectsAsset(receipt.custody.assetId, receipt.token)) {
        throw new Error('BRC-207: the receipt instructions name a different asset than the output')
      }
      if (target.assetId !== receipt.token.assetId || target.role !== receipt.token.role) {
        throw new Error('BRC-207: the receipt basket does not match the received output')
      }
      await this.assertOwned(
        receipt.token,
        receipt.custody,
        receipt.custody.senderIdentityKey,
        originator
      )
    }

    const groups = new Map<string, CheckedReceipt[]>()
    for (const receipt of checked) {
      const group = groups.get(receipt.token.assetId) ?? []
      group.push(receipt)
      groups.set(receipt.token.assetId, group)
    }
    // Evidence records are per transaction (contract §2.2-8), so one receipt transaction carries
    // the receipts of at most one attested asset; a second would merge into the first's record.
    if ([...groups.values()].filter(group => group[0].resolved.attested !== undefined).length > 1) {
      throw new ProfileParamsError(
        'BRC-207: a receipt transaction may carry one attested asset: its records are per transaction'
      )
    }
    const outcomes: AttestedOutcome[] = []
    for (const [assetId, group] of groups) {
      const resolved = group[0].resolved
      if (resolved.attested === undefined) {
        // An asset without the attested profile is credited only when currently admitted.
        const admitted = await this.spendable(
          assetId,
          group.map(receipt => receipt.source)
        )
        if (group.some(receipt => !admitted.has(receipt.source.outpoint))) {
          throw new Error(
            'BRC-207: the received output is not admitted and unspent in its asset overlay'
          )
        }
        continue
      }
      outcomes.push(await this.attestedOutcome(args, tx, group, resolved, originator))
    }

    // Nothing is written until every decision (and consent) is made and the trust snapshots
    // still hold; the tip is written last, and a settled record only after it.
    for (const { snapshot, resolved } of outcomes.map(outcome => ({
      snapshot: outcome.snapshot,
      resolved: assets.get(outcome.assetId)!
    }))) {
      if (snapshot === undefined) continue
      const now = await trustSnapshot(snapshot.handler, resolved.attested!)
      if (now?.snapshot !== snapshot.value)
        throw new AttestationEvidenceError('trust snapshot changed')
    }
    await this.writeReceiptRecords(txid, outcomes)

    const offline = new Set(
      outcomes.filter(outcome => outcome.settled === undefined).map(outcome => outcome.assetId)
    )
    const forwarded = new Map(checked.map(receipt => [receipt.remittance, receipt] as const))
    return {
      ...args,
      outputs: args.outputs.map(output => {
        const receipt =
          output.insertionRemittance === undefined
            ? undefined
            : forwarded.get(output.insertionRemittance)
        if (receipt === undefined) return output
        const { tags: callerTags, ...insertion } = receipt.remittance
        const tags = (callerTags ?? []).filter(tag => !tag.startsWith(COLOR_TAG_PREFIX))
        if (offline.has(receipt.token.assetId)) tags.push(COLOR_OFFLINE_TAG)
        const { assetId, derivationPrefix, derivationSuffix, senderIdentityKey } = receipt.custody
        return {
          ...output,
          insertionRemittance: {
            ...insertion,
            customInstructions: custodyInstructions({
              assetId,
              derivationPrefix,
              derivationSuffix,
              senderIdentityKey
            }),
            ...(tags.length === 0 ? {} : { tags })
          }
        }
      })
    }
  }

  /**
   * A receipt's `profileData` (contract §2.2-4): every profile must be one the asset requires
   * (A.154) and every asset key the receipt's own asset. The attested leaf of an attested asset is
   * the module's; any other leaf goes to its handler's `checkReceiptData`, or fails.
   */
  protected async checkReceiptProfileData(
    receipt: CheckedReceipt,
    originator: string
  ): Promise<void> {
    const { resolved } = receipt
    const data = receipt.custody.profileData ?? {}
    for (const [profileId, byAsset] of Object.entries(data)) {
      if (!resolved.req.has(profileId)) {
        throw new ProfileDataError('BRC-207: profile data names an undeclared profile')
      }
      if (Object.keys(byAsset).some(assetKey => assetKey !== resolved.assetId)) {
        throw new ProfileDataError(
          'BRC-207: profile data names an asset the receipt does not carry'
        )
      }
    }
    for (const [profileId, byAsset] of Object.entries(data)) {
      if (!Object.hasOwn(byAsset, resolved.assetId)) continue
      if (profileId === ATTESTED_PROFILE_ID && resolved.attested !== undefined) continue
      const entry = resolved.handlers.find(({ handler }) => handler.id === profileId)!
      if (entry.handler.checkReceiptData === undefined) {
        throw new ProfileDataError(`BRC-207: ${profileId} accepts no receipt profile data`)
      }
      await entry.handler.checkReceiptData(
        await this.profileContext(resolved, entry, originator),
        byAsset[resolved.assetId]
      )
    }
  }

  /** The context handed to a required profile's hooks for one resolved asset. */
  protected async profileContext(
    resolved: ResolvedAsset,
    entry: { handler: RequiredProfileHandler; descriptor: ProfileDescriptor },
    originator: string
  ): Promise<ProfileAssetContext> {
    return {
      assetId: resolved.assetId,
      profileId: entry.handler.id,
      descriptor: entry.descriptor,
      req: resolved.req,
      declarationTx: resolved.declarationTx!,
      wallet: this.wallet,
      identityKey: await this.identity(),
      originator
    }
  }

  /**
   * One attested asset's receipts in a transaction (0207:328-357, 0207:387-406): every receipt
   * carries the same attested leaf; the complete frontier behind the receipt outputs validates;
   * the anchors cover it in the asset's trust mode. Settled when a qualifying attestation covers
   * every receipt output of the tip; otherwise the user approves `color_receive_offline`. Nothing
   * is written here, and nothing is submitted.
   */
  protected async attestedOutcome(
    args: InternalizeActionArgs,
    tip: Transaction,
    group: readonly CheckedReceipt[],
    resolved: ResolvedAsset,
    originator: string
  ): Promise<AttestedOutcome> {
    const { assetId } = resolved
    const params = resolved.attested!
    const evidence = group.map(receipt => receipt.attested)
    if (evidence.some(entry => entry === undefined)) {
      throw new AttestationEvidenceError('missing attested evidence')
    }
    if (evidence.some(entry => entry!.json !== evidence[0]!.json)) {
      throw new AttestationEvidenceError('receipts of one asset carry different evidence')
    }
    const { leaf } = evidence[0]!
    const handler = resolved.handlers.find(
      ({ handler }) => handler.id === ATTESTED_PROFILE_ID
    )!.handler
    const snapshot = await trustSnapshot(handler, params)
    const qualifies = qualifyingSigner(params, snapshot?.identityKeys)
    const receiptBeef = parsed('the received transaction', () => Beef.fromBinary(args.tx))
    const bodies = new Map<string, Transaction>()
    for (const body of leaf.transactions) bodies.set(body.id('hex'), body)
    for (const entry of receiptBeef.txs) {
      if (entry.tx !== undefined) bodies.set(entry.txid, entry.tx)
    }
    // The frontier knows the deploy from declarationTx alone, so an attested deploy can be an
    // anchor that neither the leaf's transactions nor the receipt BEEF carry.
    bodies.set(resolved.declarationTx!.id('hex'), resolved.declarationTx!)
    const tipTxid = tip.id('hex')
    const outputIndexes = [...new Set(group.map(receipt => receipt.outputIndex))].sort(
      (a, b) => a - b
    )
    const frontier = validateFrontier({
      assetId,
      declarationTx: resolved.declarationTx!,
      tip,
      start: { outputs: outputIndexes },
      bodies,
      attestations: leaf.attestations,
      qualifies
    })
    assertCoverage(params, frontier.anchors, snapshot?.identityKeys)

    /** The exact AtomicBEEF settle submits for `txid`: the receipt's own bytes for the tip. */
    const submitBytes = (txid: string): number[] => {
      if (txid === tipTxid) return [...args.tx]
      const entry = receiptBeef.findTxid(txid)
      if (entry === undefined || entry.isTxidOnly) {
        throw new AttestationEvidenceError(`no submit bytes for ${txid}`)
      }
      return receiptBeef.toBinaryAtomic(txid)
    }
    const offChainValues = (txid: string): number[] => leaf.submissions.get(txid) ?? []
    const graph: ReceiptGraph = {
      assetId,
      tip: { txid: tipTxid, atomicBEEF: [...args.tx], offChainValues: offChainValues(tipTxid) },
      outputIndexes,
      pending: frontier.pending.map(txid => ({
        txid,
        atomicBEEF: submitBytes(txid),
        offChainValues: offChainValues(txid)
      })),
      attestations: distinctAttestations(leaf.attestations)
    }
    const anchorTxids = [
      ...new Set(frontier.anchors.map(anchor => parseOutpoint(anchor.outpoint).txid))
    ].filter(txid => txid !== tipTxid)
    // A stored record is merged, never replaced: one recorded for another asset would be corrupted.
    await eachInOrder(new Set([...anchorTxids, ...frontier.pending, tipTxid]), async txid => {
      const stored = await this.colorStore!.getTx(txid)
      if (stored !== undefined && stored.assetId !== assetId) {
        throw new ProfileParamsError(
          `BRC-207: transaction ${txid} of this receipt is recorded for another asset`
        )
      }
    })
    // A profile that defines admitReceipt decides every receipt (contract §2.2, D7), also one
    // whose tip the leaf already attests: it runs before the coverage decision and a throw
    // propagates with nothing written.
    const admitted = await this.admitReceipt(resolved, graph, qualifies, snapshot, originator)

    const anchorsByOutpoint = new Map(frontier.anchors.map(anchor => [anchor.outpoint, anchor]))
    const tipAnchors = outputIndexes.map(vout => anchorsByOutpoint.get(`${tipTxid}.${vout}`))
    let settled: SettledRecord | undefined
    if (admitted !== undefined) {
      settled = admitted.settled
    } else if (tipAnchors.every(anchor => anchor !== undefined)) {
      const common = [...tipAnchors[0]!.signers]
        .filter(signer => tipAnchors.every(anchor => anchor!.signers.includes(signer)))
        .sort()
      const signer =
        params.trustMode === 'identity'
          ? params.identityKey!
          : (common[0] ?? [...tipAnchors[0]!.signers].sort()[0])
      settled = { outputs: outputIndexes, signer }
    } else {
      const signers = [...new Set(frontier.anchors.flatMap(anchor => anchor.signers))].sort()
      const amounts = new Map(
        group.map(receipt => [receipt.outputIndex, receipt.token.amount.toString()])
      )
      await this.approve(originator, {
        type: 'color_receive_offline',
        assetId,
        outputs: outputIndexes.map(outputIndex => ({
          outputIndex,
          amount: amounts.get(outputIndex)!
        })),
        unsettledTransactions: graph.pending.length,
        ...(params.trustMode === 'identity' ? { signer: params.identityKey } : { signers }),
        profiles: [...resolved.req.keys()],
        seekPermission: args.seekPermission !== false
      })
    }

    // Records: every anchor transaction with its attestations, the pending ancestors (parents
    // first), then the tip. Each carries the exact AtomicBEEF settle and resubmit send.
    const qualifying = distinctAttestations([
      ...graph.attestations.filter(att => qualifies(att.signer)),
      ...(admitted?.attestations ?? [])
    ])
    const record = (
      txid: string,
      role: TxRecord['role'],
      atomicBEEF: number[],
      outputs: number[]
    ): TxRecord => {
      const body = bodies.get(txid)!
      return {
        v: 1,
        assetId,
        rawTx: body.toHex(),
        atomicBEEF: toHex(atomicBEEF),
        role,
        ...(role === 'receipt' ? { state: 'staged' as const } : {}),
        inputs: this.assetInputs(body, bodies, assetId),
        outputs,
        offChainValues: toHex(offChainValues(txid)),
        attestations: qualifying.filter(att => att.txid === txid)
      }
    }
    const records: Array<[string, TxRecord]> = []
    for (const txid of anchorTxids) {
      records.push([
        txid,
        record(txid, 'ancestor', this.anchorBytes(receiptBeef, bodies, txid), [])
      ])
    }
    for (const entry of graph.pending) {
      if (entry.txid !== tipTxid) {
        records.push([entry.txid, record(entry.txid, 'ancestor', entry.atomicBEEF, [])])
      }
    }
    records.push([tipTxid, record(tipTxid, 'receipt', graph.tip.atomicBEEF, outputIndexes)])
    return {
      assetId,
      outputIndexes,
      records,
      ...(settled === undefined ? {} : { settled }),
      declarationTx: resolved.declarationTx!,
      ...(snapshot === undefined ? {} : { snapshot: { handler, value: snapshot.snapshot } })
    }
  }

  /**
   * Runs the asset's `admitReceipt` hook, when a required profile defines one (contract §2.2).
   * `unavailable` (transport only) returns undefined, so the caller takes the attested offline
   * decision. `admitted` must carry verifying statements (low-S or high-S, never normalized) by
   * signers the asset trusts that cover every receipt output of the tip in the asset's trust
   * mode; it returns them (those of graph txs only) and the tip's settled record. Any other
   * answer fails, and a throw from the hook propagates: nothing has been written yet.
   */
  protected async admitReceipt(
    resolved: ResolvedAsset,
    graph: ReceiptGraph,
    qualifies: (signer: string) => boolean,
    snapshot: { identityKeys: string[] } | undefined,
    originator: string
  ): Promise<{ attestations: ColorAttestation[]; settled: SettledRecord } | undefined> {
    const entry = resolved.handlers.find(({ handler }) => handler.admitReceipt !== undefined)
    if (entry === undefined) return undefined
    const admission = await entry.handler.admitReceipt!(
      await this.profileContext(resolved, entry, originator),
      graph
    )
    // The answer comes from host code: read it defensively.
    const answer = admission as { status?: unknown; attestations?: unknown } | null | undefined
    if (answer?.status === 'unavailable') return undefined
    if (answer?.status !== 'admitted' || !Array.isArray(answer.attestations)) {
      throw new ProfileDataError(`BRC-207: ${entry.handler.id} admitReceipt gave no admission`)
    }
    const { assetId, outputIndexes } = graph
    const tip = graph.tip.txid
    const known = new Set([tip, ...graph.pending.map(pending => pending.txid)])
    const attestations: ColorAttestation[] = []
    for (const value of answer.attestations as unknown[]) {
      const att = parseAttestation(value as JsonValue)
      if (!verifyAttestation(att, assetId)) {
        throw new AttestationEvidenceError('admission attestation does not verify')
      }
      if (qualifies(att.signer) && known.has(att.txid)) attestations.push(att)
    }
    const covering = attestations.filter(att => att.txid === tip)
    const anchors = outputIndexes.map(vout => ({
      outpoint: outpointString(tip, vout),
      signers: [
        ...new Set(covering.filter(att => att.outputs.includes(vout)).map(att => att.signer))
      ].sort()
    }))
    if (anchors.some(anchor => anchor.signers.length === 0)) {
      throw new AttestationEvidenceError('admission does not cover the receipt outputs')
    }
    assertCoverage(resolved.attested!, anchors, snapshot?.identityKeys)
    const params = resolved.attested!
    const common = anchors[0].signers.filter(signer =>
      anchors.every(anchor => anchor.signers.includes(signer))
    )
    const signer =
      params.trustMode === 'identity' ? params.identityKey! : (common[0] ?? anchors[0].signers[0])
    return {
      attestations: distinctAttestations(attestations),
      settled: { outputs: [...outputIndexes], signer }
    }
  }

  /**
   * The AtomicBEEF stored for an anchor: the receipt's bytes for it when the receipt carries it
   * (with its unmined ancestors and proofs), else the anchor's supplied body alone. An anchor is
   * already attested and is never submitted from these bytes.
   */
  protected anchorBytes(
    receiptBeef: Beef,
    bodies: ReadonlyMap<string, Transaction>,
    txid: string
  ): number[] {
    const entry = receiptBeef.findTxid(txid)
    if (entry !== undefined && !entry.isTxidOnly) return receiptBeef.toBinaryAtomic(txid)
    const beef = new Beef()
    beef.mergeRawTx(bodies.get(txid)!.toBinary())
    return beef.toBinaryAtomic(txid)
  }

  /** The outpoints of `tx`'s inputs that are tokens of `assetId`, as far as their bodies are known. */
  protected assetInputs(
    tx: Transaction,
    bodies: ReadonlyMap<string, Transaction>,
    assetId: string
  ): string[] {
    return tx.inputs.flatMap(input => {
      const txid = input.sourceTXID ?? input.sourceTransaction?.id('hex')
      const source = txid === undefined ? undefined : bodies.get(txid)
      const output = source?.outputs[input.sourceOutputIndex]
      if (txid === undefined || output === undefined) return []
      let token: TokenOutput | undefined
      try {
        token = readSentToken(
          output.lockingScript,
          { txid, vout: input.sourceOutputIndex },
          this.read
        )
      } catch {
        return []
      }
      return token?.assetId === assetId ? [outpointString(txid, input.sourceOutputIndex)] : []
    })
  }

  /**
   * Writes attested receipt evidence in crash-safe order: per asset its anchors and pending
   * ancestors, the deploy, then the tip; after all of them, the tip's settled record when every
   * attested asset of the receipt settled. A stored record is merged, never downgraded, and an
   * existing settled record is never removed, so a retried receipt writes the same bytes.
   */
  protected async writeReceiptRecords(
    tipTxid: string,
    outcomes: readonly AttestedOutcome[]
  ): Promise<void> {
    if (outcomes.length === 0) return
    const store = this.colorStore!
    for (const outcome of outcomes) {
      const tip = outcome.records[outcome.records.length - 1]
      for (const [txid, record] of outcome.records) {
        if (txid === tipTxid) continue
        await this.putTxRecord(txid, record)
      }
      const deploy = outcome.declarationTx.toHex()
      if ((await store.getDeploy(outcome.assetId).catch(() => undefined)) !== deploy) {
        await store.putDeploy(outcome.assetId, deploy)
      }
      await this.putTxRecord(tip[0], tip[1])
    }
    if (outcomes.every(outcome => outcome.settled !== undefined)) {
      const outputs = [...new Set(outcomes.flatMap(outcome => outcome.settled!.outputs))].sort(
        (a, b) => a - b
      )
      const stored = await store.settled(tipTxid)
      const merged = [...new Set([...(stored?.outputs ?? []), ...outputs])].sort((a, b) => a - b)
      if (stored === undefined || stored.outputs.join(',') !== merged.join(',')) {
        await store.markSettled(tipTxid, {
          outputs: merged,
          signer: stored?.signer ?? outcomes[0].settled!.signer
        })
      }
    }
  }

  /** Writes `record`, merged with any readable stored record; an unchanged record is not rewritten. */
  protected async putTxRecord(txid: string, record: TxRecord): Promise<void> {
    const store = this.colorStore!
    const stored = await store.getTx(txid)
    const next = stored === undefined ? record : mergeTxRecords(stored, record)
    if (stored !== undefined && JSON.stringify(stored) === JSON.stringify(next)) return
    await store.putTx(txid, next)
  }

  /* ----------------------------------------------------------------------
   * Send
   * ---------------------------------------------------------------------- */

  /**
   * Checks a planned token action and adds its selected token inputs and per-asset change. With
   * profiles registered, the plan's assets are resolved first (an attested plan leaf supplies its
   * `declarationTx` as evidence), the plan is checked against their required profiles, the
   * requested tokens must conform to their deploys, and after funding each required profile's
   * `checkPlanData` sees its leaf and the asset's view of the layout. Any failure releases every
   * input the action held.
   */
  protected async createAction(
    args: CreateActionArgs,
    originator: string
  ): Promise<CreateActionArgs> {
    const labels = args.labels ?? []
    const plan = ColorPlan.fromLabels(labels)
    if (plan === undefined)
      throw new Error('BRC-207: a p color createAction requires a p color plan')
    // Plan labels are the only p color labels; BRC-176 proof transport is not part of BRC-207.
    if (
      labels.some(
        label =>
          label.startsWith(`${COLOR_BASKET_NAMESPACE} `) &&
          !label.startsWith(COLOR_PLAN_LABEL_PREFIX)
      )
    )
      throw new Error('BRC-207: unknown p color label')
    const handoff = labels.some(label => label.startsWith(NOSEND_EXPIRY_LABEL_PREFIX))
    const profiled = this.profiles.size > 0
    const resolved = profiled ? await this.resolvePlanAssets(plan) : new Map()
    await this.assertPlanSupported(plan, args, resolved)
    const { planned, outputs } = await this.planOutputs(plan, args, originator)
    if (profiled) await this.assertConformingTokens(planned.tokens)
    // A plain-noSend asset's token change stays in the hand-over, offline until it settles.
    const offline = new Set(
      [...resolved.values()]
        .filter(asset => asset.sendPolicy === 'plain-nosend')
        .map(asset => asset.assetId)
    )
    // The hold keeps concurrent sends in this module from choosing the same outputs while it plans.
    // It ends when this handler returns; storage then rejects a second action that tries to spend
    // an input already marked spent.
    const reserved = new Set<string>()
    // Only a plain-noSend hand-over may spend offline (unsettled) attested outputs.
    const spend: SpendContext = { offline: plainNoSendArgs(args), originator }
    try {
      const explicit = await this.explicitInputs(args, originator, spend)
      this.reserve(reserved, explicit.managed)
      if (profiled) await this.assertConformingTokens(explicit.tokens)
      const { inputs, changes } = await this.fund(
        reserved,
        plan,
        planned,
        explicit,
        handoff,
        originator,
        offline,
        spend
      )
      sighashScopes(plan, new Set([...explicit.managed, ...inputs].map(input => input.outpoint)))
      const ordered = orderInputs(explicit.inputs, tokenInputs(inputs), plan.inputPositions)
      const placed = placeChange(outputs, changes, plan.changePositions)
      if (profiled) {
        const managed = new Map(
          [...explicit.managed, ...inputs].map(input => [input.outpoint, input] as const)
        )
        const changeCustody = new Map(changes.map(change => [change.output, change.custody]))
        const beef =
          args.inputBEEF === undefined ? undefined : Beef.fromBinary(args.inputBEEF as number[])
        await eachInOrder(resolved.values(), async asset => {
          const layout = this.planLayout(asset.assetId, plan, ordered, placed, {
            managed,
            changeCustody,
            beef
          })
          await this.checkPlanData(asset, plan, layout, originator)
        })
      }
      return { ...args, inputs: ordered, outputs: placed }
    } finally {
      for (const outpoint of reserved) this.selected.delete(outpoint)
    }
  }

  /**
   * With profiles registered, the plan's existing assets, resolved (contract §2.2-4). Before any
   * resolution every `profileData` asset key must name an existing asset of the plan (an `ISSUE`
   * leaf is refused in 0.2.0, contract §2.2-3a), and each attested leaf is parsed structurally so
   * its `declarationTx` resolves a never-seen asset with no connectivity (D23 source i).
   */
  protected async resolvePlanAssets(plan: ColorPlan): Promise<Map<string, ResolvedAsset>> {
    const data = plan.profileData ?? {}
    for (const byAsset of Object.values(data)) {
      for (const assetKey of Object.keys(byAsset)) {
        if (assetKey === ISSUE) {
          throw new ProfileDataError('BRC-207: profile data for a new deploy is not supported')
        }
        if (!plan.assets.includes(assetKey)) {
          throw new ProfileDataError('BRC-207: profile data names an asset the plan does not move')
        }
      }
    }
    const evidence = new Map<string, string>()
    for (const [assetKey, value] of Object.entries(data[ATTESTED_PROFILE_ID] ?? {})) {
      evidence.set(assetKey, parseAttestedLeaf(value, assetKey).declarationTx.toHex())
    }
    const resolved = new Map<string, ResolvedAsset>()
    await eachInOrder(
      plan.assets.filter(assetId => assetId !== ISSUE),
      async assetId => {
        const declarationTx = evidence.get(assetId)
        resolved.set(
          assetId,
          await this.resolveAsset(
            assetId,
            declarationTx === undefined ? undefined : { declarationTx }
          )
        )
      }
    )
    return resolved
  }

  /**
   * Plan and action features this module version does not implement, and the send rules of the
   * plan's resolved assets (`resolved` is empty without profiles, which keeps every 0.1.0 check
   * and message). With profiles: `profileData` must name only profiles its asset requires
   * (A.154); a `plain-nosend` asset (B2) needs `options.noSend`, no BRC-177 label and only
   * `plain-nosend` assets beside it, and skips the BRC-177 requirement; and each asset's declared
   * operations must be ones its required profiles allow.
   */
  protected async assertPlanSupported(
    plan: ColorPlan,
    args: CreateActionArgs,
    resolved: ReadonlyMap<string, ResolvedAsset>
  ): Promise<void> {
    // A plan's ownedOutputs, inputPositions and changePositions, and the facts the user approves,
    // all name requested output indices; storage shuffles them when randomizeOutputs is true.
    if (args.options?.randomizeOutputs !== false) {
      throw new Error('BRC-207: a p color plan requires options.randomizeOutputs false')
    }
    if (this.profiles.size === 0) {
      if (Object.keys(plan.profileData ?? {}).length > 0) {
        throw new Error('BRC-207: plan.profileData is not supported')
      }
    } else {
      for (const [profileId, byAsset] of Object.entries(plan.profileData ?? {})) {
        const assetKeys = Object.keys(byAsset)
        const declaring = [...resolved.values()].filter(asset => asset.req.has(profileId))
        if (
          declaring.length === 0 ||
          assetKeys.some(assetKey => resolved.get(assetKey)?.req.has(profileId) !== true)
        ) {
          throw new ProfileDataError('BRC-207: profile data names an undeclared profile')
        }
      }
    }
    const noSend = args.options?.noSend === true
    const handoff = (args.labels ?? []).some(label => label.startsWith(NOSEND_EXPIRY_LABEL_PREFIX))
    // A signed deploy is filed in its asset basket through internalizeAction, which would end a
    // noSend transaction's lifecycle; the deploy is a broadcast action.
    if (plan.assets.includes(ISSUE) && (noSend || handoff)) {
      throw new Error('BRC-207: a deploy cannot be a noSend action')
    }
    const plain = [...resolved.values()].filter(asset => asset.sendPolicy === 'plain-nosend')
    if (plain.length > 0) {
      // B2: the recipient submits a plain noSend hand-over; it never splits and is never sent here.
      if (plain.length !== resolved.size) {
        throw new ProfileParamsError(
          'BRC-207: a plain noSend hand-over cannot move an asset without that send policy'
        )
      }
      if (!noSend || handoff) {
        throw new ProfileParamsError(
          'BRC-207: a plain noSend hand-over requires options.noSend and no BRC-177 p nosend expiry label'
        )
      }
      // Its durable record and evidence are per transaction and asset.
      if (plain.length > 1) {
        throw new ProfileParamsError('BRC-207: a plain noSend hand-over moves exactly one asset')
      }
    } else if (noSend && !handoff) {
      // As in BTMS, a token action completes with its overlay submission. The one deferred flow is
      // the BRC-177 handoff, whose receiver submits; a plain noSend action later sent with sendWith
      // would never reach the token overlay, as the manager gives modules no sendWith hook.
      throw new Error('BRC-207: noSend token actions require a BRC-177 p nosend expiry label')
    }
    for (const asset of resolved.values()) {
      const allowed = asset.operations
      if (allowed === undefined) continue
      const refused = [...declaredOperations(plan, asset.assetId)].filter(op => !allowed.has(op))
      if (refused.length > 0) {
        throw new ProfileParamsError(
          `BRC-207: the required profiles of ${asset.assetId} do not allow [${refused.join(', ')}]`
        )
      }
    }
    // Storage adds satoshi change while funding, after this module returns: it appends the requested
    // outputs, then any storage commission output, then change, and reports neither position.
    if (plan.changePositions.some(position => position.assetId === null)) {
      throw new Error(
        'BRC-207: satoshi change positions are not supported: the wallet does not position satoshi change'
      )
    }
  }

  /**
   * One asset's inputs and outputs in a funded action's final layout, before the transaction
   * exists: managed inputs with their custody, foreign token inputs read from `inputBEEF`, and
   * token outputs with custody for the wallet's own (plan `ownedOutputs` and token change).
   */
  protected planLayout(
    assetId: string,
    plan: ColorPlan,
    inputs: readonly CreateActionInput[],
    outputs: readonly CreateActionOutput[],
    sources: {
      managed: ReadonlyMap<string, ManagedInput>
      changeCustody: ReadonlyMap<CreateActionOutput, Custody>
      beef?: Beef
    }
  ): { inputs: ProfileTxView['inputs']; outputs: ProfileTxView['outputs'] } {
    const viewInputs = inputs.flatMap((input, inputIndex) => {
      const managed = sources.managed.get(input.outpoint)
      if (managed !== undefined) {
        if (managed.assetId !== assetId) return []
        const { outpoint, role, amount, custody } = managed
        return [{ inputIndex, outpoint, role, amount, custody }]
      }
      const source = foreignSource(sources.beef, input.outpoint)
      if (source === undefined) return []
      const token = readAnyTokenOutput(
        source.lockingScript,
        parseOutpoint(input.outpoint),
        this.read
      )
      if (token === undefined || token.deploy || token.assetId !== assetId) return []
      return [{ inputIndex, outpoint: input.outpoint, role: token.role, amount: token.amount }]
    })
    const owned = new Map(plan.ownedOutputs.map(remittance => [remittance.outputIndex, remittance]))
    const viewOutputs = outputs.flatMap((output, outputIndex) => {
      const token = readSentToken(
        LockingScript.fromHex(output.lockingScript),
        { txid: '00'.repeat(32), vout: outputIndex },
        this.read
      )
      if (token === undefined || token.deploy || token.assetId !== assetId) return []
      const remittance = owned.get(outputIndex)
      const custody =
        remittance === undefined ? sources.changeCustody.get(output) : custodyOf(remittance)
      return [
        {
          outputIndex,
          role: token.role,
          amount: token.amount,
          ...(custody === undefined ? {} : { custody })
        }
      ]
    })
    return { inputs: viewInputs, outputs: viewOutputs }
  }

  /**
   * A required profile's view of one asset in an action (contract §2.2): the layout, the
   * transaction once it exists, and, for `profileId`, its plan leaf.
   */
  protected txView(
    assetId: string,
    plan: ColorPlan,
    layout: {
      inputs: ProfileTxView['inputs']
      outputs: ProfileTxView['outputs']
      tx?: Transaction
    },
    profileId?: string
  ): ProfileTxView {
    const byAsset = profileId === undefined ? undefined : plan.profileData?.[profileId]
    const planLeaf =
      byAsset !== undefined && Object.hasOwn(byAsset, assetId) ? byAsset[assetId] : undefined
    return {
      ...(layout.tx === undefined ? {} : { tx: layout.tx }),
      assetId,
      inputs: layout.inputs,
      outputs: layout.outputs,
      ...(planLeaf === undefined ? {} : { planLeaf })
    }
  }

  /** Runs each required profile's `checkPlanData` for one asset with its leaf (A.157, A.159). */
  protected async checkPlanData(
    asset: ResolvedAsset,
    plan: ColorPlan,
    layout: {
      inputs: ProfileTxView['inputs']
      outputs: ProfileTxView['outputs']
      tx?: Transaction
    },
    originator: string
  ): Promise<void> {
    await eachInOrder(asset.handlers, async entry => {
      const view = this.txView(asset.assetId, plan, layout, entry.handler.id)
      if (entry.handler.checkPlanData === undefined) {
        // The module parses the attested leaf itself (resolvePlanAssets); any other leaf for a
        // profile without the hook would be accepted unchecked (A.157).
        const ownLeaf = entry.handler.id === ATTESTED_PROFILE_ID && asset.attested !== undefined
        if (view.planLeaf !== undefined && !ownLeaf) {
          throw new ProfileDataError(`BRC-207: ${entry.handler.id} accepts no plan profile data`)
        }
        return
      }
      await entry.handler.checkPlanData(
        await this.profileContext(asset, entry, originator),
        view.planLeaf,
        view
      )
    })
  }

  protected reserve(reserved: Set<string>, inputs: ReadonlyArray<{ outpoint: string }>): void {
    for (const input of inputs) {
      this.selected.add(input.outpoint)
      reserved.add(input.outpoint)
    }
  }

  protected release(reserved: Set<string>, inputs: ReadonlyArray<{ outpoint: string }>): void {
    for (const input of inputs) {
      this.selected.delete(input.outpoint)
      reserved.delete(input.outpoint)
    }
  }

  /**
   * Classifies the caller's inputs: this wallet's `p color` outputs are managed and signed by the
   * module; foreign token inputs count only once their asset's overlay admits them; other inputs
   * pass through unchanged.
   */
  protected async explicitInputs(
    args: CreateActionArgs,
    originator: string,
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<ExplicitInputs> {
    const inputs = args.inputs ?? []
    const explicit: ExplicitInputs = {
      inputs: [...inputs],
      managed: [],
      holdings: new Map(),
      tokens: []
    }
    if (inputs.length === 0) return explicit
    const outpoints = new Set(inputs.map(input => input.outpoint))
    if (outpoints.size !== inputs.length) throw new Error('BRC-207: duplicate explicit input')
    const listed = await this.wallet.listOutputs(
      {
        basket: toolbox.specOpBasketPrefixOutputs,
        tags: [COLOR_BASKET_NAMESPACE],
        include: 'locking scripts',
        includeCustomInstructions: true
      },
      originator
    )
    const own = new Map(
      listed.outputs
        .filter(output => outpoints.has(output.outpoint))
        .map(output => [output.outpoint, output])
    )
    const beef =
      args.inputBEEF === undefined
        ? undefined
        : parsed('inputBEEF', () => Beef.fromBinary(args.inputBEEF as number[]))
    await eachInOrder(inputs, async input => {
      const output = own.get(input.outpoint)
      if (output === undefined) await this.foreignInput(explicit, beef, input.outpoint)
      else await this.ownInput(explicit, output, originator, spend)
    })
    return explicit
  }

  /** Counts one of this wallet's `p color` outputs once it is managed, admitted and unspent. */
  protected async ownInput(
    explicit: ExplicitInputs,
    output: WalletOutput,
    originator: string,
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<void> {
    if (!output.spendable)
      throw new Error('BRC-207: an explicit p color input is reserved by another action')
    const managed = await this.managedInput(output, originator)
    if (managed === undefined)
      throw new Error('BRC-207: an explicit p color input is not a managed token output')
    await this.assertSupportedAsset(managed.assetId)
    explicit.tokens.push(this.read(managed.lockingScript, parseOutpoint(managed.outpoint))!)
    if (
      !(await this.spendable(managed.assetId, [managed], spend)).has(managed.outpoint) &&
      !(await this.resubmitHeld(managed.assetId, managed.role, [managed], originator)).has(
        managed.outpoint
      )
    )
      throw new Error('BRC-207: an explicit p color input is not admitted and unspent')
    explicit.managed.push(managed)
    const totals = holding(explicit.holdings, managed.assetId, emptyExplicitHolding)
    if (managed.role === 'value') totals.value += managed.amount
    else totals.authority += 1
  }

  /** Counts a foreign token input once its overlay admits it; other foreign inputs add nothing. */
  protected async foreignInput(
    explicit: ExplicitInputs,
    beef: Beef | undefined,
    outpoint: string
  ): Promise<void> {
    // A source missing from inputBEEF is resolved from the wallet and checked at signAction.
    const source = foreignSource(beef, outpoint)
    const token =
      source === undefined
        ? undefined
        : readAnyTokenOutput(source.lockingScript, parseOutpoint(outpoint), this.read)
    if (token === undefined) return
    await this.assertSupportedAsset(token.assetId)
    explicit.tokens.push(token)
    if (!(await this.spendable(token.assetId, [source!])).has(outpoint))
      throw new Error('BRC-207: a foreign token input is not admitted and unspent in its overlay')
    const totals = holding(explicit.holdings, token.assetId, emptyExplicitHolding)
    if (token.role === 'value') {
      totals.value += token.amount
      totals.foreignValue += token.amount
    } else {
      totals.authority += 1
      totals.foreignAuthority += 1
    }
  }

  /** Classifies the requested outputs, totalling each asset's value and authority outputs. */
  protected async planOutputs(
    plan: ColorPlan,
    args: CreateActionArgs,
    originator: string
  ): Promise<{ planned: PlannedOutputs; outputs: CreateActionOutput[] }> {
    const requested = args.outputs ?? []
    for (const remittance of plan.ownedOutputs) {
      if (remittance.outputIndex >= requested.length) {
        throw new Error('BRC-207: plan.ownedOutputs names a missing output')
      }
    }
    const owned = new Map(plan.ownedOutputs.map(remittance => [remittance.outputIndex, remittance]))
    const planned: PlannedOutputs = { holdings: new Map(), tokens: [], destinations: [] }
    const outputs = await mapInOrder(
      requested,
      async (output, index) =>
        await this.planOutput(plan, args, index, output, owned.get(index), planned, originator)
    )
    return { planned, outputs }
  }

  /** One requested output: passed through, a token destination, or a token output this wallet keeps. */
  protected async planOutput(
    plan: ColorPlan,
    args: CreateActionArgs,
    index: number,
    output: CreateActionOutput,
    remittance: ColorRemittance | undefined,
    planned: PlannedOutputs,
    originator: string
  ): Promise<CreateActionOutput> {
    const lockingScript = parsed(`output ${index} locking script`, () =>
      LockingScript.fromHex(output.lockingScript)
    )
    const placeholder = { txid: '00'.repeat(32), vout: index }
    const token = this.read(lockingScript, placeholder)
    if (token === undefined) {
      if (remittance !== undefined)
        throw new Error('BRC-207: plan.ownedOutputs names a non-token output')
      if (output.basket?.startsWith(`${COLOR_BASKET_NAMESPACE} `) === true) {
        throw new Error('BRC-207: a p color basket can only receive BRC-162 token outputs')
      }
      const json = readJsonTokenOutput(lockingScript, placeholder)
      if (json !== undefined) {
        this.jsonDestination(plan, index, output, json, planned)
        if (!json.deploy) planned.tokens.push(json)
      }
      return output
    }
    // With profiles registered, a token output carries only the module's state tags.
    if (this.profiles.size > 0) output = withoutColorTags(output)
    if (token.deploy)
      return await this.deployOutput(args, output, token, remittance, planned, originator)
    if (!plan.assets.includes(token.assetId))
      throw new Error('BRC-207: an output asset is missing from plan.assets')
    planned.tokens.push(token)
    const totals = holding(planned.holdings, token.assetId, emptyHolding)
    if (token.role === 'value') totals.value += token.amount
    else totals.authority += 1
    if (remittance !== undefined)
      return await this.ownedOutput(token, output, remittance, originator)
    if (output.basket !== undefined) {
      throw new Error('BRC-207: only outputs in plan.ownedOutputs may enter a p color basket')
    }
    planned.destinations.push({
      outputIndex: index,
      assetId: token.assetId,
      role: token.role,
      amount: token.amount.toString(),
      lockingScript: output.lockingScript
    })
    return output
  }

  /** A BRC-161 JSON output to another party: counted for its asset, never held or created here. */
  protected jsonDestination(
    plan: ColorPlan,
    index: number,
    output: CreateActionOutput,
    token: TokenOutput,
    planned: PlannedOutputs
  ): void {
    if (token.deploy) throw new Error('BRC-207: a new issuance must use BRC-162')
    if (!plan.assets.includes(token.assetId))
      throw new Error('BRC-207: an output asset is missing from plan.assets')
    const totals = holding(planned.holdings, token.assetId, emptyHolding)
    if (token.role === 'authority') totals.authority += 1
    else {
      totals.value += token.amount
      if (token.jsonOperation !== 'mint') totals.jsonValue = (totals.jsonValue ?? 0n) + token.amount
    }
    planned.destinations.push({
      outputIndex: index,
      assetId: token.assetId,
      role: token.role,
      amount: token.amount.toString(),
      lockingScript: output.lockingScript
    })
  }

  /**
   * The action's deploy, which BRC-162 requires at output 0. An owned deploy keeps its `ISSUE`
   * key; its asset basket is assigned once the transaction ID is final.
   */
  protected async deployOutput(
    args: CreateActionArgs,
    output: CreateActionOutput,
    token: TokenOutput,
    remittance: ColorRemittance | undefined,
    planned: PlannedOutputs,
    originator: string
  ): Promise<CreateActionOutput> {
    // 0.2.0 limit (contract §2.2-3a): a deploy that requires processing profiles is lib-built.
    const attributes = token.attributes
    if (
      attributes?.payload === 'map' &&
      attributes.req.status === 'valid' &&
      attributes.req.value.size > 0
    ) {
      throw new ProfileParamsError(
        'BRC-207: a deploy that requires processing profiles must be built outside this module'
      )
    }
    if (output.basket !== undefined)
      throw new Error(
        "BRC-207: a deploy output's basket is assigned once its transaction is signed"
      )
    planned.deploy = { operation: deployOperation(token) }
    if (remittance === undefined) {
      planned.destinations.push({
        outputIndex: 0,
        assetId: ISSUE,
        role: token.role,
        amount: token.amount.toString(),
        lockingScript: output.lockingScript
      })
      return output
    }
    if (remittance.assetId !== ISSUE)
      throw new Error('BRC-207: a deploy output remittance must use ISSUE')
    await this.assertOwned(token, remittance, remittance.senderIdentityKey, originator)
    // Without a p color basket the manager does not encrypt its custody, so it is encrypted here.
    return {
      ...output,
      customInstructions: await encryptMetadata(
        this.wallet,
        custodyInstructions(custodyOf(remittance)),
        originator
      )
    }
  }

  /** A token output of the action that this wallet keeps, placed in its asset's basket. */
  protected async ownedOutput(
    token: TokenOutput,
    output: CreateActionOutput,
    remittance: ColorRemittance,
    originator: string
  ): Promise<CreateActionOutput> {
    if (remittance.assetId !== token.assetId)
      throw new Error('BRC-207: an owned output remittance names another asset')
    await this.assertOwned(token, remittance, remittance.senderIdentityKey, originator)
    const basket = assetBasket(token.assetId, token.role)
    if (output.basket !== undefined && output.basket !== basket) {
      throw new Error('BRC-207: an owned output names the wrong p color basket')
    }
    return {
      ...output,
      basket,
      customInstructions: custodyInstructions(custodyOf(remittance))
    }
  }

  /**
   * Funds each asset the plan involves, checks its operations, splits for a handoff, and returns
   * the selected inputs and token change. The user approves the funded action at signAction.
   */
  protected async fund(
    reserved: Set<string>,
    plan: ColorPlan,
    planned: PlannedOutputs,
    explicit: ExplicitInputs,
    handoff: boolean,
    originator: string,
    offline: ReadonlySet<string> = new Set(),
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<{
    inputs: ManagedInput[]
    changes: TokenChange[]
  }> {
    const assetIds = new Set([
      ...planned.holdings.keys(),
      ...explicit.holdings.keys(),
      ...plan.operations.flatMap(operation =>
        operation.assetId === ISSUE ? [] : [operation.assetId]
      )
    ])
    assertPlanAssets(plan, new Set([...assetIds, ...(planned.deploy === undefined ? [] : [ISSUE])]))
    if (planned.deploy !== undefined) assertOperations(plan, ISSUE, [planned.deploy.operation])
    const funding = await mapInOrder(assetIds, async assetId => {
      await this.assertSupportedAsset(assetId)
      return await this.fundAsset(
        reserved,
        plan,
        assetId,
        planned.holdings.get(assetId) ?? emptyHolding(),
        explicit.holdings.get(assetId) ?? emptyExplicitHolding(),
        originator,
        spend
      )
    })
    const settled = await mapInOrder(
      funding,
      async asset =>
        await this.settleFunding(
          reserved,
          asset,
          explicit.holdings.get(asset.assetId)?.value ?? 0n,
          handoff,
          originator,
          offline.has(asset.assetId)
        )
    )
    return {
      inputs: settled.flatMap(asset => asset.inputs),
      changes: settled.flatMap(asset => asset.change)
    }
  }

  /**
   * One funded asset's inputs and change: a BRC-177 handoff with change splits off an exact output
   * instead, so the recipient receives no change; otherwise any change becomes a new managed
   * output, tagged `color_offline` when `offline` (a plain-noSend hand-over's change, B2).
   */
  protected async settleFunding(
    reserved: Set<string>,
    asset: AssetFunding,
    explicitValue: bigint,
    handoff: boolean,
    originator: string,
    offline = false
  ): Promise<{
    inputs: ManagedInput[]
    change: TokenChange[]
  }> {
    if (asset.change <= 0n) return { inputs: asset.selected, change: [] }
    if (handoff) {
      const value = asset.selected.filter(input => input.role === 'value')
      const needed = asset.outputs.value - asset.change - explicitValue
      return {
        inputs: await this.splitExact(reserved, asset.assetId, value, needed, originator),
        change: []
      }
    }
    const { output, custody } = await this.newManagedOutput(asset.assetId, asset.change, originator)
    return {
      inputs: asset.selected,
      change: [
        {
          assetId: asset.assetId,
          output: offline ? { ...output, tags: [COLOR_OFFLINE_TAG] } : output,
          custody
        }
      ]
    }
  }

  /**
   * Selects one asset's value inputs for a transfer and authority inputs for a declared authority
   * operation, then checks the resulting operations against the plan. Value is selected, with
   * change, only when the asset's operations are a transfer without a mint or burn.
   */
  protected async fundAsset(
    reserved: Set<string>,
    plan: ColorPlan,
    assetId: string,
    requested: Holding,
    explicit: ExplicitHolding,
    originator: string,
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<AssetFunding> {
    const declared = declaredOperations(plan, assetId)
    const selected: ManagedInput[] = []
    const automatic = declared.has('transfer') && !declared.has('mint') && !declared.has('burn')
    if (automatic && requested.value > explicit.value) {
      selected.push(
        ...(await this.selectInputs(
          reserved,
          assetId,
          'value',
          requested.value - explicit.value,
          originator,
          spend
        ))
      )
    }
    const authorityOperation = AUTHORITY_OPERATIONS.find(operation => declared.has(operation))
    const authorityCount =
      authorityOperation === undefined || explicit.authority > 0
        ? 0
        : authorityInputsFor(authorityOperation, requested.authority)
    if (authorityCount > 0) {
      selected.push(
        ...(await this.selectInputs(
          reserved,
          assetId,
          'authority',
          BigInt(authorityCount),
          originator,
          spend
        ))
      )
    }
    const selectedValue = sumAmounts(selected)
    const value = explicit.value + selectedValue
    // Change returns what selection adds beyond the need; excess explicit value is a burn.
    const change = selectedValue > 0n ? value - requested.value : 0n
    const inputs = { value, authority: explicit.authority + authorityCount }
    const outputs = {
      value: requested.value + change,
      authority: requested.authority,
      jsonValue: requested.jsonValue
    }
    assertOperations(plan, assetId, requiredOperations(inputs, outputs))
    return { assetId, selected, change, outputs }
  }

  /** Replaces a handoff's value inputs with one split output of exactly `amount`, which it reserves. */
  protected async splitExact(
    reserved: Set<string>,
    assetId: string,
    selected: ManagedInput[],
    amount: bigint,
    originator: string
  ): Promise<ManagedInput[]> {
    const exact = await this.split(assetId, selected, amount, originator)
    this.release(reserved, selected)
    this.reserve(reserved, [exact])
    return [exact]
  }

  /**
   * Selects admitted, unspent outputs of one asset's value or authority basket: value outputs
   * covering `target` units, largest first, or `target` authority outputs.
   */
  protected async selectInputs(
    reserved: Set<string>,
    assetId: string,
    role: TokenRole,
    target: bigint,
    originator: string,
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<ManagedInput[]> {
    const candidates = (await this.candidates(assetId, role, originator)).sort(byAmountDescending)
    const rejected = new Set<string>()
    for (;;) {
      const chosen = chooseCandidates(candidates, rejected, role, target)
      if (chosen === undefined)
        throw new Error(
          `BRC-207: insufficient spendable ${role === 'value' ? 'balance' : 'authority'} of ${assetId}`
        )
      const selected = await this.checkChosen(
        reserved,
        assetId,
        role,
        chosen,
        rejected,
        originator,
        spend
      )
      if (selected !== undefined) return selected
    }
  }

  /**
   * Holds the chosen outputs and checks them: each must have readable custody and be admitted and
   * unspent, after resubmission if needed. Returns them as inputs, still held, when all pass;
   * otherwise rejects and releases the ones that failed and returns undefined.
   */
  protected async checkChosen(
    reserved: Set<string>,
    assetId: string,
    role: TokenRole,
    chosen: Candidate[],
    rejected: Set<string>,
    originator: string,
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<ManagedInput[] | undefined> {
    // Chosen outputs are held while they are checked, so a concurrent action cannot choose them.
    this.reserve(reserved, chosen)
    // Custody is read only for chosen outputs; an unreadable record is skipped, not fatal.
    const inputs = await Promise.all(
      chosen.map(async candidate => await this.readableInput(candidate, originator))
    )
    const unreadable = chosen.filter((_, index) => inputs[index] === undefined)
    if (unreadable.length > 0) {
      for (const candidate of unreadable) rejected.add(candidate.outpoint)
      this.release(reserved, unreadable)
      return undefined
    }
    const selected = inputs as ManagedInput[]
    const admitted = await this.spendable(assetId, selected, spend)
    const unlisted = selected.filter(input => !admitted.has(input.outpoint))
    const recovered = await this.resubmitHeld(assetId, role, unlisted, originator)
    const missing = unlisted.filter(input => !recovered.has(input.outpoint))
    if (missing.length === 0) return selected
    for (const input of missing) rejected.add(input.outpoint)
    this.release(reserved, missing)
    return undefined
  }

  /**
   * Resubmits the wallet's own copies of the transactions behind held outputs that the overlay
   * does not report, as BTMS does when it selects, and returns the outputs it then admits.
   *
   * An attested asset's outputs are never resubmitted here: `spendable` already resubmitted each
   * settled one through the settle path (exact stored bytes and off-chain values, per-txid
   * latch), an offline one needs no overlay, and the wallet's copy carries no off-chain values
   * (contract §2.2-7). Returning nothing keeps a selection from submitting a txid twice.
   * After store loss, an attested output the overlay does not list is therefore not resubmitted
   * at selection: it is recovered by the sender's resend or by `settle()`, and until then it is
   * excluded (fail closed).
   */
  protected async resubmitHeld(
    assetId: string,
    role: TokenRole,
    outputs: readonly SourceOutput[],
    originator: string
  ): Promise<Set<string>> {
    if (outputs.length === 0) return new Set()
    if (this.profiles.size > 0 && (await this.resolveAsset(assetId)).attested !== undefined) {
      return new Set()
    }
    const txids = new Set(outputs.map(output => parseOutpoint(output.outpoint).txid))
    const beef = new Beef()
    for (let offset = 0; [...txids].some(txid => beef.findTxid(txid) === undefined);) {
      const page = await this.wallet.listOutputs(
        {
          basket: assetBasket(assetId, role),
          include: 'entire transactions',
          limit: LIST_PAGE_LIMIT,
          offset
        },
        originator
      )
      if (page.BEEF !== undefined) beef.mergeBeef(page.BEEF)
      offset += page.outputs.length
      if (page.outputs.length < LIST_PAGE_LIMIT) break
    }
    await eachInOrder(txids, async txid => {
      if (beef.findTxid(txid) === undefined) return
      const atomic = beef.toBinaryAtomic(txid)
      const held = Transaction.fromAtomicBEEF(atomic)
      const { assetIds, deploy } = submissionAssets(held, held, this.read)
      // A refused resubmission leaves the output unlisted; the spendability check decides.
      const groups = await this.routedTopics(assetIds, deploy).catch(() => [])
      await eachInOrder(groups, async ({ provider, topics }) => {
        await provider.submit(topics, atomic).catch(() => undefined)
      })
    })
    return await this.spendable(assetId, outputs)
  }

  /** One basket's token outputs of the asset, read from their locking scripts, excluding selected ones. */
  protected async candidates(
    assetId: string,
    role: TokenRole,
    originator: string
  ): Promise<Candidate[]> {
    const outputs = await this.listBasket(assetBasket(assetId, role), originator, {})
    // A finally refused transaction's outputs are never selected (C55).
    const refused = this.profiles.size > 0 ? await this.colorStore!.refusedSet() : undefined
    return outputs.flatMap(output => {
      if (this.selected.has(output.outpoint) || output.customInstructions === undefined) return []
      const outpoint = parseOutpoint(output.outpoint)
      if (refused?.has(outpoint.txid) === true) return []
      const source = this.sourceOutput(output)
      const token = tryReadTokenOutput(source.lockingScript, outpoint, this.read)
      if (token?.assetId !== assetId || token.role !== role) return []
      return [
        { ...source, token, amount: token.amount, customInstructions: output.customInstructions }
      ]
    })
  }

  /** A chosen candidate with its custody, or undefined when its custody record is unreadable. */
  protected async readableInput(
    candidate: Candidate,
    originator: string
  ): Promise<ManagedInput | undefined> {
    try {
      const { outpoint, lockingScript, satoshis, token, customInstructions } = candidate
      return await this.custodyInput(
        { outpoint, lockingScript, satoshis, token },
        customInstructions,
        originator
      )
    } catch {
      return undefined
    }
  }

  /** A `p color` basket output as a managed token input, or undefined when it is not one. */
  protected async managedInput(
    output: WalletOutput,
    originator: string
  ): Promise<ManagedInput | undefined> {
    const source = this.sourceOutput(output)
    const token = this.read(source.lockingScript, parseOutpoint(output.outpoint))
    if (token === undefined || output.customInstructions === undefined) return undefined
    return await this.custodyInput({ ...source, token }, output.customInstructions, originator)
  }

  /** Decrypts and parses an output's custody tuple; undefined when it names another asset. */
  protected async custodyInput(
    output: SourceOutput & { token: TokenOutput },
    customInstructions: string,
    originator: string
  ): Promise<ManagedInput | undefined> {
    const custody = parseCustody(
      await maybeDecryptMetadata(this.wallet, customInstructions, originator),
      undefined,
      'managed output customInstructions'
    )
    if (!selectsAsset(custody.assetId, output.token)) return undefined
    const { token, ...source } = output
    return { ...source, assetId: token.assetId, role: token.role, amount: token.amount, custody }
  }

  /**
   * Before a handoff, splits the selected inputs into an output of exactly `amount` and token
   * change, broadcast and submitted. The split pays this wallet and, like BRC-177's revocation
   * anchor, needs no separate consent; the user approves the handoff itself in signAction.
   */
  protected async split(
    assetId: string,
    selected: ManagedInput[],
    amount: bigint,
    originator: string
  ): Promise<ManagedInput> {
    const change = sumAmounts(selected) - amount
    const exact = await this.newManagedOutput(assetId, amount, originator)
    const rest = await this.newManagedOutput(assetId, change, originator)
    // The split goes to the underlying wallet directly, so its custody is encrypted here.
    const outputs = await Promise.all(
      [exact.output, rest.output].map(async output => ({
        ...output,
        customInstructions: await encryptMetadata(
          this.wallet,
          output.customInstructions as string,
          originator
        )
      }))
    )
    const created = await this.wallet.createAction(
      {
        description: 'Split tokens for a handoff',
        labels: ColorPlan.toLabels({
          version: 1,
          assets: [assetId],
          ownedOutputs: [
            { outputIndex: 0, ...exact.custody },
            { outputIndex: 1, ...rest.custody }
          ],
          operations: [{ assetId, operation: 'transfer' }],
          inputPositions: [],
          changePositions: [],
          sighashTypes: []
        }),
        inputs: tokenInputs(selected),
        outputs,
        options: { randomizeOutputs: false, signAndProcess: false }
      },
      originator
    )
    const signable = created.signableTransaction
    if (signable == null) throw new Error('BRC-207: the split action was not returned for signing')
    const template = Transaction.fromAtomicBEEF(signable.tx)
    let signed: SignActionResult
    try {
      const spends = await this.signInputs(
        template,
        selected,
        new Map(),
        originator,
        'BRC-207: the split transaction omits a token input'
      )
      signed = await this.wallet.signAction({ reference: signable.reference, spends }, originator)
    } catch (error) {
      await this.wallet
        .abortAction({ reference: signable.reference }, originator)
        .catch(() => undefined)
      throw error
    }
    if (signed.txid === undefined || signed.tx === undefined) {
      throw new Error('BRC-207: the split transaction was not returned')
    }
    await this.submit([assetId], signed.tx)
    return {
      outpoint: outpointString(signed.txid, 0),
      lockingScript: LockingScript.fromHex(exact.output.lockingScript),
      satoshis: TOKEN_CARRIER_SATOSHIS,
      assetId,
      role: 'value',
      amount,
      custody: exact.custody
    }
  }

  /** A fresh wallet-owned value output in the asset's basket, keyed to this wallet. */
  protected async newManagedOutput(
    assetId: string,
    amount: bigint,
    originator: string
  ): Promise<{ output: CreateActionOutput; custody: Custody }> {
    const custody: Custody = {
      assetId,
      derivationPrefix: toBase64(Random(16)),
      derivationSuffix: toBase64(Random(16)),
      senderIdentityKey: await this.identity()
    }
    const publicKey = await this.publicKey(custody, custody.senderIdentityKey, originator)
    return {
      custody,
      output: {
        lockingScript: new OneColor()
          .lock(assetId, amount, hash160(toArray(publicKey, 'hex')))
          .toHex(),
        satoshis: TOKEN_CARRIER_SATOSHIS,
        basket: assetBasket(assetId, 'value'),
        customInstructions: custodyInstructions(custody),
        outputDescription: 'BRC-207 token change'
      }
    }
  }

  /**
   * Checks the funded action against its plan, rechecks every token input's spendability, asks
   * the user to approve the final layout, and signs the inputs that spend this wallet's
   * `p color` outputs. For an action moving profile assets, before anything is approved or
   * signed: each required profile's `checkPlanData` runs again with the transaction, a
   * plain-noSend hand-over's input evidence must be in the store, and the `submissionData` hook
   * must give bytes. The wallet is then asked for the signed transaction, which `onResponse`
   * records.
   */
  protected async signAction(
    args: SignActionArgs,
    action: PermissionsModuleAction | undefined,
    originator: string
  ): Promise<SignActionArgs> {
    if (action === undefined) return args
    const createArgs = action.createArgs
    const plan = ColorPlan.fromLabels(createArgs?.labels)
    if (createArgs === undefined || plan === undefined)
      throw new Error("BRC-207: signAction needs the action's p color createAction arguments")
    const tx = action.transaction
    const tokens = transactionTokens(tx, true, this.read)
    // Sources the wallet resolved after createAction and the final layout conform too.
    if (this.profiles.size > 0) {
      await this.assertConformingTokens([
        ...tokens.consumed.map(input => input.token),
        ...this.outputTokens(tx)
      ])
    }
    assertTransactionOperations(plan, tokens)
    const managed = await this.actionInputs(tx, originator)
    const scopes = sighashScopes(plan, new Set(managed.map(input => input.outpoint)))
    const pending =
      this.profiles.size > 0
        ? await this.profileSigning(plan, createArgs, tx, managed, originator)
        : undefined
    // B2: a plain-noSend hand-over may spend unsettled parents, so it must never be broadcast or
    // batched here; signAction options would otherwise override the createAction noSend.
    if (
      pending?.plain === true &&
      (args.options?.noSend === false || (args.options?.sendWith ?? []).length > 0)
    ) {
      throw new ProfileParamsError(
        'BRC-207: a plain noSend hand-over is never sent by this wallet: signAction options.noSend cannot be false and sendWith must be empty'
      )
    }
    const spend: SpendContext = { offline: plainNoSendArgs(createArgs), originator }
    const consumedAssets = new Set(tokens.consumed.map(input => input.assetId))
    const trust = await this.trustVersions(consumedAssets)
    await eachInOrder(consumedAssets, async assetId => {
      const assetInputs = tokens.consumed.filter(input => input.assetId === assetId)
      const admitted = await this.spendable(assetId, assetInputs, spend)
      if (assetInputs.some(input => !admitted.has(input.outpoint)))
        throw new Error(`BRC-207: a ${assetId} input is no longer spendable`)
    })
    await this.approve(
      originator,
      actionConsent(
        plan,
        createArgs,
        tx,
        tokens,
        managed,
        scopes,
        (await this.plainNoSend(plan)) || undefined,
        this.read
      )
    )
    // The decision stands only on the trust it was made with (C16).
    await this.assertTrustUnchanged(trust)
    const spends = {
      ...args.spends,
      ...(await this.signInputs(
        tx,
        managed,
        scopes,
        originator,
        'BRC-207: the signable transaction omits a token input'
      ))
    }
    if (pending === undefined) return { ...args, spends }
    // onResponse needs the signed transaction itself, never only its txid; a plain hand-over's
    // send mode is fixed, as the toolbox fixes a BRC-177 protected action's.
    this.pendingHandoffs.set(args.reference, pending)
    return {
      ...args,
      spends,
      options: {
        ...args.options,
        ...(pending.plain ? { noSend: true, sendWith: [] } : {}),
        returnTXIDOnly: false
      }
    }
  }

  /**
   * The signing-time checks of an action's profile assets, or undefined when it moves none:
   * each asset's view of the final layout (`tx` set, change custody from the forwarded
   * createAction outputs) goes to `checkPlanData` again; a plain-noSend hand-over must have
   * stored evidence for every same-asset input; and the asset's `submissionData` hook, when a
   * required profile defines one, must return bytes.
   */
  protected async profileSigning(
    plan: ColorPlan,
    createArgs: CreateActionArgs,
    tx: Transaction,
    managed: readonly ManagedInput[],
    originator: string
  ): Promise<PendingHandoff | undefined> {
    const assets = [...(await this.resolvePlanAssets(plan)).values()].filter(
      asset => asset.handlers.length > 0
    )
    if (assets.length === 0) return undefined
    const plain = assets.some(asset => asset.sendPolicy === 'plain-nosend')
    const requested = createArgs.outputs ?? []
    const owned = new Set(plan.ownedOutputs.map(remittance => remittance.outputIndex))
    const outputs: CreateActionOutput[] = tx.outputs.map(output => ({
      lockingScript: output.lockingScript.toHex(),
      satoshis: output.satoshis ?? 0,
      outputDescription: ''
    }))
    // Token change is the module's own p color output; createAction admits no other into a
    // p color basket outside plan.ownedOutputs. The manager leaves `p ` custody in plaintext.
    const changeCustody = new Map<CreateActionOutput, Custody>()
    requested.forEach((output, index) => {
      if (owned.has(index) || output.basket?.startsWith(`${COLOR_BASKET_NAMESPACE} `) !== true)
        return
      if (output.customInstructions === undefined || outputs[index] === undefined) return
      if (outputs[index].lockingScript !== output.lockingScript) {
        throw new Error('BRC-207: the signable transaction does not match its token change')
      }
      const { assetId, derivationPrefix, derivationSuffix, senderIdentityKey } = parseCustody(
        output.customInstructions,
        undefined,
        'token change customInstructions'
      )
      changeCustody.set(outputs[index], {
        assetId,
        derivationPrefix,
        derivationSuffix,
        senderIdentityKey
      })
    })
    const beef = new Beef()
    for (const input of tx.inputs) {
      if (input.sourceTransaction !== undefined) beef.mergeRawTx(input.sourceTransaction.toBinary())
    }
    const inputs = tx.inputs.map(input => ({ outpoint: inputOutpoint(input) }) as CreateActionInput)
    const managedByOutpoint = new Map(managed.map(input => [input.outpoint, input] as const))
    const pending: PendingHandoff = {
      plain,
      labels: (createArgs.labels ?? []).filter(label => label.startsWith(COLOR_PLAN_LABEL_PREFIX)),
      assets: []
    }
    await eachInOrder(assets, async asset => {
      const layout = {
        ...this.planLayout(asset.assetId, plan, inputs, outputs, {
          managed: managedByOutpoint,
          changeCustody,
          beef
        }),
        tx
      }
      await this.checkPlanData(asset, plan, layout, originator)
      const outpoints = layout.inputs.map(input => input.outpoint)
      if (plain && asset.attested !== undefined) {
        await this.attestedEvidence(asset.assetId, outpoints)
      }
      pending.assets.push({
        assetId: asset.assetId,
        offChainValues: await this.submissionData(asset, plan, layout, originator),
        inputs: outpoints,
        outputs: layout.outputs
          .filter(output => output.custody !== undefined)
          .map(output => output.outputIndex)
      })
    })
    return pending
  }

  /**
   * The asset's BRC-22 off-chain bytes from the one required profile that defines
   * `submissionData` (contract §2.2), called before signing with the unsigned transaction;
   * `[]` when none does. A defined hook must return a non-empty byte array.
   */
  protected async submissionData(
    asset: ResolvedAsset,
    plan: ColorPlan,
    layout: {
      inputs: ProfileTxView['inputs']
      outputs: ProfileTxView['outputs']
      tx: Transaction
    },
    originator: string
  ): Promise<number[]> {
    const entry = asset.handlers.find(({ handler }) => handler.submissionData !== undefined)
    if (entry === undefined) return []
    const bytes: unknown = await entry.handler.submissionData!(
      await this.profileContext(asset, entry, originator),
      this.txView(asset.assetId, plan, layout, entry.handler.id)
    )
    if (!Array.isArray(bytes) || bytes.length === 0) {
      throw new ProfileDataError(`BRC-207: ${entry.handler.id} submissionData returned no bytes`)
    }
    if (!bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new ProfileDataError(`BRC-207: ${entry.handler.id} submissionData returned non-bytes`)
    }
    return [...(bytes as number[])]
  }

  /**
   * True when the plan moves an asset whose required profiles declare `plain-nosend` (createAction
   * admits such an asset only beside others like it). Always false without profiles.
   */
  protected async plainNoSend(plan: ColorPlan): Promise<boolean> {
    if (this.profiles.size === 0) return false
    let plain = false
    await eachInOrder(
      plan.assets.filter(assetId => assetId !== ISSUE),
      async assetId => {
        if ((await this.resolveAsset(assetId)).sendPolicy === 'plain-nosend') plain = true
      }
    )
    return plain
  }

  /** The transaction's inputs that spend this wallet's `p color` outputs, with their stored custody. */
  protected async actionInputs(tx: Transaction, originator: string): Promise<ManagedInput[]> {
    const outpoints = new Set(tx.inputs.map(input => inputOutpoint(input)))
    // The action's own inputs are reserved by it, which this listing includes.
    const listed = await this.wallet.listOutputs(
      {
        basket: toolbox.specOpBasketPrefixOutputs,
        tags: [COLOR_BASKET_NAMESPACE],
        include: 'locking scripts',
        includeCustomInstructions: true
      },
      originator
    )
    const managed = await Promise.all(
      listed.outputs
        .filter(output => outpoints.has(output.outpoint))
        .map(async output => await this.managedInput(output, originator))
    )
    return managed.filter(input => input !== undefined)
  }

  /**
   * Submits a signed token transaction to the topic of every asset among its inputs and outputs,
   * and a deploy to the discovery topic. For a profile action (`pending` from signAction) each
   * profile asset's submission data goes with its topic, and an attested asset whose returned
   * attestation covers the wallet's own outputs is recorded settled (`recordSubmitted`).
   */
  protected async submitSigned(
    result: SignActionResult,
    template: Transaction,
    pending?: PendingHandoff
  ): Promise<void> {
    if (result?.tx === undefined) return
    const tx = Transaction.fromAtomicBEEF(result.tx)
    const { assetIds, deploy } = submissionAssets(tx, template, this.read)
    if (assetIds.length === 0 && !deploy) return
    if (pending === undefined) {
      await this.submit(assetIds, result.tx, deploy)
      return
    }
    const offChainValues = new Map(
      pending.assets.map(asset => [asset.assetId, asset.offChainValues] as const)
    )
    const steaks = await this.submit(assetIds, result.tx, deploy, offChainValues)
    await this.recordSubmitted(tx, result.tx, steaks, pending)
  }

  /**
   * Submits a transaction to each asset topic, and a deploy to the discovery topic, trying again
   * up to `SUBMIT_ATTEMPTS` times before reporting the provider's failure, and returns every
   * call's STEAK. As in BTMS, an accepted submission completes the action: every token input was
   * overlay-checked and the plan verified before signing, so an output the overlay then does not
   * admit stays in its basket and is resubmitted when it is next selected.
   *
   * Topics are grouped by routed provider. `offChainValues` names the profile assets' BRC-22
   * off-chain bytes; one call carries one set of bytes, so a topic with non-empty bytes is
   * submitted on its own with them, and every other topic of the provider in one call with two
   * arguments, exactly as without profiles.
   */
  protected async submit(
    assetIds: string[],
    beef: AtomicBEEF,
    deploy = false,
    offChainValues?: ReadonlyMap<string, number[]>
  ): Promise<AttestedSTEAK[]> {
    const withBytes = new Map<string, number[]>()
    for (const [assetId, bytes] of offChainValues ?? []) {
      if (bytes.length > 0) withBytes.set(colorTopic(assetId), bytes)
    }
    const steaks: AttestedSTEAK[] = []
    await eachInOrder(await this.routedTopics(assetIds, deploy), async ({ provider, topics }) => {
      const plain = topics.filter(topic => !withBytes.has(topic))
      const calls: Array<{ topics: string[]; offChainValues?: number[] }> = []
      if (plain.length > 0 || plain.length === topics.length) calls.push({ topics: plain })
      for (const topic of topics) {
        const bytes = withBytes.get(topic)
        if (bytes !== undefined) calls.push({ topics: [topic], offChainValues: bytes })
      }
      await eachInOrder(calls, async call => {
        let failure: unknown
        for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt++) {
          try {
            steaks.push(
              call.offChainValues === undefined
                ? await provider.submit(call.topics, Array.from(beef))
                : await provider.submit(call.topics, Array.from(beef), [...call.offChainValues])
            )
            return
          } catch (error) {
            failure = error
          }
        }
        throw failure
      })
    })
    return steaks
  }

  /**
   * After a profile action was broadcast and submitted: for each attested asset with wallet-owned
   * outputs, a returned `tm_color_<assetId>` attestation that verifies, qualifies and covers
   * those outputs is stored with the transaction, its exact submitted AtomicBEEF and off-chain
   * values, and only then the transaction is marked settled. Anything else records nothing: the
   * outputs then take the live check, as a store-less wallet would. The action already completed,
   * so a failure here is never reported.
   */
  protected async recordSubmitted(
    tx: Transaction,
    beef: AtomicBEEF,
    steaks: readonly AttestedSTEAK[],
    pending: PendingHandoff
  ): Promise<void> {
    const store = this.colorStore!
    const txid = tx.id('hex')
    await eachInOrder(pending.assets, async asset => {
      try {
        const { assetId, outputs } = asset
        if (outputs.length === 0) return
        if ((await this.resolveAsset(assetId)).attested === undefined) return
        const qualifies = await this.qualifiesFor(assetId)
        const topic = colorTopic(assetId)
        const att = steaks
          .map(steak => {
            const entry = (
              steak as Record<string, AttestedSTEAK[string] | undefined> | undefined
            )?.[topic]
            if (entry === undefined || entry === null) return undefined
            try {
              return attestationFromSteak(txid, topic, entry)
            } catch {
              return undefined
            }
          })
          .find(
            att =>
              att !== undefined &&
              verifyAttestation(att, assetId) &&
              qualifies(att.signer) &&
              outputs.every(vout => att.outputs.includes(vout))
          )
        if (att === undefined) return
        // One record per transaction: a second asset of the same transaction is not recorded.
        const existing = await store.getTx(txid)
        if (existing !== undefined && existing.assetId !== assetId) return
        await this.putTxRecord(txid, {
          v: 1,
          assetId,
          rawTx: tx.toHex(),
          atomicBEEF: toHex(Array.from(beef)),
          role: 'receipt',
          state: 'credited',
          inputs: [...asset.inputs],
          outputs: [...outputs],
          offChainValues: toHex(asset.offChainValues),
          attestations: [att]
        })
        const settled = await store.settled(txid)
        const merged = [...new Set([...(settled?.outputs ?? []), ...att.outputs])].sort(
          (a, b) => a - b
        )
        if (settled === undefined || settled.outputs.join(',') !== merged.join(',')) {
          await store.markSettled(txid, { outputs: merged, signer: settled?.signer ?? att.signer })
        }
      } catch {
        // Not recorded: the outputs fall back to the live check.
      }
    })
  }

  /**
   * A transaction's topics grouped by provider, in topic order: the discovery topic on the default
   * provider, each asset topic on its asset's provider. Without profiles, or when every asset
   * routes to the default provider, this is the single 0.1.0 call.
   */
  protected async routedTopics(
    assetIds: readonly string[],
    deploy: boolean
  ): Promise<Array<{ provider: ColorOverlayProvider; topics: string[] }>> {
    const groups = new Map<ColorOverlayProvider, string[]>()
    if (deploy) groups.set(this.provider, [DISCOVERY_TOPIC])
    for (const assetId of assetIds) {
      const provider = await this.providerFor(assetId)
      const topics = groups.get(provider)
      if (topics === undefined) groups.set(provider, [colorTopic(assetId)])
      else topics.push(colorTopic(assetId))
    }
    if (groups.size === 0) return [{ provider: this.provider, topics: [] }]
    return [...groups].map(([provider, topics]) => ({ provider, topics }))
  }

  /* ----------------------------------------------------------------------
   * App-built transactions (createSignature)
   * ---------------------------------------------------------------------- */

  /** Signs one managed input of an app-built transaction described by a 207 signature envelope. */
  protected async createSignature(
    args: CreateSignatureArgs,
    originator: string,
    next: PermissionsModuleNext
  ): Promise<unknown> {
    if (args.hashToDirectlySign !== undefined) {
      throw new Error(
        'BRC-207: p color signatures take a signature envelope, not hashToDirectlySign'
      )
    }
    const selector = this.parseKeyArgs(args)
    if (args.data === undefined || args.data.length > MAX_ENVELOPE_BYTES) {
      throw new Error('BRC-207: the signature envelope is missing or exceeds 16 MiB')
    }
    const envelope = jsonObject(
      parseStrictJsonBytes(args.data, 'signature envelope'),
      'signature envelope'
    )
    exactMembers(
      envelope,
      ['version', 'tx', 'inputIndex', 'sighashType', 'ownedOutputs'],
      ['profileData'],
      'signature envelope'
    )
    if (envelope.version !== 1) throw new Error('BRC-207: signature envelope version must be 1')
    if (
      Object.keys(parseProfileData(envelope.profileData, 'signature envelope profileData') ?? {})
        .length > 0
    ) {
      throw new Error(
        'BRC-207: signature envelope profileData names a profile the asset does not require'
      )
    }
    const tx = parsed('the signature envelope tx', () =>
      Transaction.fromAtomicBEEF(
        jsonByteArray(envelope.tx, 'signature envelope tx', MAX_ENVELOPE_BYTES)
      )
    )
    const inputIndex = jsonUint32(envelope.inputIndex, 'signature envelope inputIndex')
    const sighashType = jsonUint32(envelope.sighashType, 'signature envelope sighashType')
    if (sighashType > 255) throw new Error('BRC-207: sighashType must be in 0..255')
    const ownedOutputs = parseRemittances(envelope.ownedOutputs, 'signature envelope ownedOutputs')
    const input = tx.inputs[inputIndex]
    const sourceTransaction = input?.sourceTransaction
    const source = sourceTransaction?.outputs[input.sourceOutputIndex]
    if (sourceTransaction === undefined || source?.satoshis === undefined) {
      throw new Error('BRC-207: the envelope must carry the signed input source transaction')
    }
    const sourceTXID = sourceTransaction.id('hex')
    const token = this.read(source.lockingScript, {
      txid: sourceTXID,
      vout: input.sourceOutputIndex
    })
    if (token === undefined || !selectsAsset(selector.assetId, token)) {
      throw new Error(
        'BRC-207: the protocol asset selector does not match the signed source output'
      )
    }
    await this.assertOwned(token, selector, args.counterparty ?? 'anyone', originator)
    // The signature commits to the whole transaction, so it is evaluated as a send is: every
    // input authenticated from its source, every asset's legs and supply change derived, and
    // every token input admitted and unspent in its overlay.
    const tokens = transactionTokens(tx, true, this.read)
    const involved = new Set([token.assetId, ...tokens.inputs.keys(), ...tokens.outputs.keys()])
    await this.assertSupportedAssets(involved)
    // A signature for an app-built transaction cannot carry submission data, keep a plain
    // noSend hand-over's evidence or run a profile's transition checks (it has no plan), so
    // assets whose profiles need any of them are refused rather than handled as baseline. Every
    // source and output must conform to its deploy (A.146, A.151) before anything is signed.
    if (this.profiles.size > 0) {
      await eachInOrder(involved, async assetId => {
        const asset = await this.resolveAsset(assetId)
        if (
          asset.sendPolicy !== undefined ||
          asset.handlers.some(
            ({ handler }) =>
              handler.submissionData !== undefined || handler.checkPlanData !== undefined
          )
        ) {
          throw new ProfileParamsError(
            `BRC-207: the required profiles of ${assetId} do not allow app-built signatures`
          )
        }
      })
      await this.assertConformingTokens([
        ...tokens.consumed.map(consumed => consumed.token),
        ...this.outputTokens(tx)
      ])
    }
    await Promise.all(
      ownedOutputs.map(async remittance => {
        const output = tx.outputs[remittance.outputIndex]
        const owned =
          output === undefined
            ? undefined
            : this.read(output.lockingScript, {
                txid: '00'.repeat(32),
                vout: remittance.outputIndex
              })
        if (owned === undefined || owned.deploy || remittance.assetId !== owned.assetId) {
          throw new Error('BRC-207: an envelope remittance does not match its output')
        }
        await this.assertOwned(owned, remittance, remittance.senderIdentityKey, originator)
      })
    )
    const outpoint = outpointString(sourceTXID, input.sourceOutputIndex)
    const signed = { outpoint, lockingScript: source.lockingScript, satoshis: source.satoshis }
    const consumedAssets = new Set(tokens.consumed.map(consumed => consumed.assetId))
    const trust = await this.trustVersions(consumedAssets)
    await eachInOrder(consumedAssets, async assetId => {
      const assetInputs = tokens.consumed.filter(consumed => consumed.assetId === assetId)
      const admitted = await this.spendable(assetId, assetInputs)
      if (!admitted.has(outpoint) && assetId === token.assetId)
        throw new Error('BRC-207: the signed input is not admitted and unspent in its overlay')
      if (assetInputs.some(consumed => !admitted.has(consumed.outpoint)))
        throw new Error(`BRC-207: a ${assetId} input is not admitted and unspent in its overlay`)
    })
    const preimage = this.preimage(tx, inputIndex, signed, sighashType)
    const kept = (vout: number): boolean =>
      ownedOutputs.some(remittance => remittance.outputIndex === vout)
    await this.approve(originator, {
      type: 'color_signature',
      inputIndex,
      seekPermission: args.seekPermission !== false,
      ...transactionConsent(
        tx,
        tokens,
        [token],
        kept,
        vout => !kept(vout),
        [{ outpoint, inputIndex, sighashType }],
        kept(0),
        this.read
      )
    })
    // The decision stands only on the trust it was made with (C16).
    await this.assertTrustUnchanged(trust)
    return await next({
      protocolID: args.protocolID,
      keyID: args.keyID,
      counterparty: args.counterparty,
      privileged: args.privileged,
      privilegedReason: args.privilegedReason,
      seekPermission: args.seekPermission,
      hashToDirectlySign: hash256(preimage)
    })
  }

  /* ----------------------------------------------------------------------
   * Read views
   * ---------------------------------------------------------------------- */

  protected async listOutputs(
    args: ListOutputsArgs,
    originator: string,
    next: PermissionsModuleNext
  ): Promise<unknown> {
    const seekPermission = args.seekPermission !== false
    if (args.basket === ASSETS_SELECTOR) {
      await this.authorizeRead(originator, { basket: args.basket, seekPermission })
      return await this.inventory(args, originator)
    }
    const balance = parseBalanceSelector(args.basket)
    if (balance !== undefined) {
      await this.authorizeRead(originator, { basket: args.basket, ...balance, seekPermission })
      return await this.balance(balance.assetId, balance.role, args, originator)
    }
    const held = parseAssetBasket(args.basket)
    if (held !== undefined) {
      await this.authorizeRead(originator, { basket: args.basket, ...held, seekPermission })
      return await next(args)
    }
    throw new Error('BRC-207: unknown p color basket selector')
  }

  /** `p color balance`: exact sum of available token units, or count of available authorities. */
  protected async balance(
    assetId: string,
    role: TokenRole,
    args: ListOutputsArgs,
    originator: string
  ): Promise<ListOutputsResult> {
    // As in BTMS, a read reports wallet state alone: the basket's unreserved, unspent outputs.
    // The overlay is consulted only when spending. With profiles, the asset must resolve first,
    // so an unsupported asset fails closed (A.142/A.143) before any output is read.
    let outputs: WalletOutput[]
    if (this.profiles.size > 0) {
      await this.resolveAsset(assetId)
      outputs = await this.viewedBasket(assetBasket(assetId, role), args, originator)
    } else {
      const { tags, tagQueryMode } = args
      outputs = await this.listBasket(assetBasket(assetId, role), originator, {
        tags,
        tagQueryMode
      })
    }
    const held = outputs
      .map(output => {
        const source = this.sourceOutput(output)
        return this.read(source.lockingScript, parseOutpoint(output.outpoint))
      })
      .filter(token => token?.assetId === assetId && token.role === role)
    const total = held.reduce((sum, token) => sum + (role === 'value' ? token!.amount : 1n), 0n)
    return { totalOutputs: total.toString(), outputs: [] }
  }

  /**
   * With profiles registered, a basket's unreserved outputs as a balance sees them: refused
   * transactions' outputs are left out (C55), and the caller's tag filter is applied to the view
   * tags, so `color_offline` matches only outputs without a settled record (contract §2.2-6).
   */
  protected async viewedBasket(
    basket: string,
    args: ListOutputsArgs,
    originator: string
  ): Promise<WalletOutput[]> {
    const status = await this.settlementState()
    const outputs = await this.listBasket(basket, originator, { includeTags: true })
    return outputs.filter(output => {
      if (status.refused.has(parseOutpoint(output.outpoint).txid)) return false
      const tags = [...storedViewTags(output, status), `${STATE_TAG_PREFIX}available`]
      return matchesTags(tags, args.tags ?? [], args.tagQueryMode)
    })
  }

  /** The settled and refused txids; called only when profiles are registered. */
  protected async settlementState(): Promise<SettlementState> {
    const [settled, refused] = await Promise.all([
      this.colorStore!.settledSet(),
      this.colorStore!.refusedSet()
    ])
    return { settled, refused }
  }

  /**
   * With profiles registered, the records whose asset resolves: each distinct asset is resolved
   * once per listing, and the outputs of an asset that fails with `UnsupportedProfileError` or
   * `ProfileParamsError` are left out, as the 0.1.0 reader left them out (A.142). Any other
   * resolution failure fails the listing.
   */
  protected async supportedRecords(records: InventoryRecord[]): Promise<InventoryRecord[]> {
    const unsupported = new Set<string>()
    await eachInOrder(new Set(records.map(record => record.assetId)), async assetId => {
      try {
        await this.resolveAsset(assetId)
      } catch (error) {
        if (
          !isNamedError(error, 'UnsupportedProfileError') &&
          !isNamedError(error, 'ProfileParamsError')
        ) {
          throw error
        }
        unsupported.add(assetId)
      }
    })
    return records.filter(record => !unsupported.has(record.assetId))
  }

  /** `p color assets`: every held token output across all per-asset baskets, with its state. */
  protected async inventory(args: ListOutputsArgs, originator: string): Promise<ListOutputsResult> {
    const entireTransactions = args.include === 'entire transactions'
    const listed = await this.wallet.listOutputs(
      {
        basket: toolbox.specOpBasketPrefixOutputs,
        tags: [COLOR_BASKET_NAMESPACE],
        include: entireTransactions ? 'entire transactions' : 'locking scripts',
        includeCustomInstructions: args.includeCustomInstructions,
        includeTags: true,
        includeLabels: args.includeLabels
      },
      originator
    )
    const beef =
      entireTransactions && listed.BEEF !== undefined ? Beef.fromBinary(listed.BEEF) : undefined
    let records = inventoryRecords(listed.outputs, beef, this.read)
    let status: SettlementState | undefined
    if (this.profiles.size > 0) {
      records = await this.supportedRecords(records)
      status = await this.settlementState()
    }
    const views = records
      .map(record => inventoryView(record, status))
      .filter(view => matchesTags(view.tags, args.tags ?? [], args.tagQueryMode))
    const limit = args.limit ?? 10
    const offset = args.offset ?? 0
    const ordered = offset < 0 ? [...views].reverse() : views
    const start = offset < 0 ? -offset - 1 : offset
    const page = ordered.slice(start, start + limit)
    // Only the returned page is decrypted and carried in the BEEF.
    const result: ListOutputsResult = {
      totalOutputs: views.length,
      outputs: await Promise.all(
        page.map(async view => await this.inventoryOutput(view, args, originator))
      )
    }
    if (beef !== undefined) result.BEEF = pageBeef(beef, page)
    return result
  }

  /** One inventory record as a BRC-100 output with the fields the caller asked for. */
  protected async inventoryOutput(
    view: InventoryView,
    args: ListOutputsArgs,
    originator: string
  ): Promise<WalletOutput> {
    const { record, state, tags } = view
    const output: WalletOutput = {
      satoshis: record.output.satoshis,
      spendable: state === 'available',
      outpoint: record.output.outpoint
    }
    if (args.include === 'locking scripts')
      output.lockingScript = record.source.lockingScript.toHex()
    if (args.includeCustomInstructions === true && record.output.customInstructions !== undefined) {
      output.customInstructions = await maybeDecryptMetadata(
        this.wallet,
        record.output.customInstructions,
        originator
      )
    }
    if (args.includeTags === true) output.tags = tags
    if (args.includeLabels === true) output.labels = record.output.labels
    return output
  }

  /* ----------------------------------------------------------------------
   * Shared helpers
   * ---------------------------------------------------------------------- */

  /** Validates a `p color` key reference and returns its asset selector and remittance strings. */
  protected parseKeyArgs(args: {
    protocolID?: unknown
    keyID?: unknown
  }): ReturnType<typeof parseColorProtocolID> {
    if (args.keyID !== COLOR_KEY_ID) throw new Error('BRC-207: p color keys use keyID "color"')
    return parseColorProtocolID(args.protocolID)
  }

  protected async identity(): Promise<string> {
    if (this.identityKey === undefined) {
      const pending = this.wallet
        .getPublicKey({ identityKey: true })
        .then(({ publicKey }) => publicKey)
      this.identityKey = pending
      // A rejected lookup is not cached; the next call asks the wallet again.
      pending.catch(() => {
        if (this.identityKey === pending) this.identityKey = undefined
      })
    }
    return await this.identityKey
  }

  protected async publicKey(
    custody: Pick<Custody, 'assetId' | 'derivationPrefix' | 'derivationSuffix'>,
    counterparty: WalletCounterparty,
    originator: string
  ): Promise<string> {
    const { publicKey } = await this.wallet.getPublicKey(
      {
        protocolID: colorProtocolID(
          custody.assetId,
          custody.derivationPrefix,
          custody.derivationSuffix
        ),
        keyID: COLOR_KEY_ID,
        counterparty,
        forSelf: true
      },
      originator
    )
    return publicKey
  }

  /** Fails unless the output is a P2PKH remainder locked to this wallet's derived `p color` key. */
  protected async assertOwned(
    token: TokenOutput,
    custody: Pick<Custody, 'assetId' | 'derivationPrefix' | 'derivationSuffix'>,
    counterparty: WalletCounterparty,
    originator: string
  ): Promise<void> {
    if (token.pubKeyHash === undefined)
      throw new Error('BRC-207: a managed token output must have a P2PKH remainder')
    const publicKey = await this.publicKey(custody, counterparty, originator)
    if (toHex(hash160(toArray(publicKey, 'hex'))) !== toHex(token.pubKeyHash)) {
      throw new Error("BRC-207: the token output is not locked to this wallet's p color key")
    }
  }

  /**
   * Authenticates the asset's deploy and fails when it declares required processing profiles this
   * wallet does not support. Kept for subclassers: `resolveAsset` with the result discarded.
   */
  protected async assertSupportedAsset(assetId: string): Promise<void> {
    await this.resolveAsset(assetId)
  }

  /**
   * Authenticates an asset's deploy and resolves its required profiles and provider, memoized by
   * asset id (a failure is forgotten). Without profiles this is the 0.1.0 check: one admission
   * query to the provider, and a deploy that declares any `req` fails. With profiles, the deploy is
   * taken from the first of (D23) the request's `declarationTx`, the `color.v1.` deploy cache, the
   * default provider and each handler's `deployProviders()`, each checked by txid hash; it is then
   * cached, and its `req` resolved against the registered handlers.
   */
  protected async resolveAsset(
    assetId: string,
    evidence?: { declarationTx?: string }
  ): Promise<ResolvedAsset> {
    if (this.profiles.size === 0) {
      return await (this.supportedAssets.get(assetId) ??
        this.memoize(assetId, this.resolveBaseline(assetId)))
    }
    const { txid, vout } = parseAssetId(assetId)
    // Request evidence is checked even when the asset is already resolved, so a request with a
    // mismatching body fails the same way whatever the cache holds.
    let supplied: Transaction | undefined
    if (evidence?.declarationTx !== undefined) {
      supplied = canonicalTransaction(evidence.declarationTx, txid)
      if (supplied === undefined) {
        throw new Error('BRC-207: the supplied declarationTx does not match the asset')
      }
      this.deployToken(assetId, supplied, vout)
    }
    const pending = this.supportedAssets.get(assetId)
    if (pending !== undefined) {
      if (supplied === undefined) return await pending
      try {
        return await pending
      } catch {
        // The resolution in flight failed; this request carries its own deploy, so try again.
      }
    }
    return await this.memoize(assetId, this.resolveProfiled(assetId, supplied))
  }

  /** Records a resolution in the memo, forgetting it if it fails. */
  protected memoize(assetId: string, check: Promise<ResolvedAsset>): Promise<ResolvedAsset> {
    this.supportedAssets.set(assetId, check)
    check.catch(() => {
      if (this.supportedAssets.get(assetId) === check) this.supportedAssets.delete(assetId)
    })
    return check
  }

  /** The 0.1.0 support check: the deploy from the provider, which must declare no `req`. */
  protected async resolveBaseline(assetId: string): Promise<ResolvedAsset> {
    const { txid, vout } = parseAssetId(assetId)
    const outpoint = outpointString(txid, vout)
    const deploy = readOutputList(await this.provider.admission(assetId, [outpoint]), [
      outpoint
    ]).get(outpoint)
    if (deploy === undefined)
      throw new Error(`BRC-207: the overlay has no admitted deploy for ${assetId}`)
    if (!isDeployOutput(deploy.lockingScript, { txid, vout })) {
      throw new Error(`BRC-207: ${assetId} is not a token deploy`)
    }
    return {
      assetId,
      req: NO_REQUIREMENTS,
      handlers: [],
      provider: this.provider,
      maxReceiptBytes: MAX_RECEIPT_INSTRUCTION_BYTES
    }
  }

  /** Resolution with profiles registered: find and verify the deploy, then its requirements. */
  protected async resolveProfiled(
    assetId: string,
    supplied: Transaction | undefined
  ): Promise<ResolvedAsset> {
    const { txid, vout } = parseAssetId(assetId)
    const cached = supplied === undefined ? await this.cachedDeploy(assetId, txid) : undefined
    const declarationTx = supplied ?? cached ?? (await this.providedDeploy(assetId, txid, vout))
    // Bytes that hash to the asset's txid are the asset's own: a non-deploy fails, never falls back.
    const { attributes } = this.deployToken(assetId, declarationTx, vout)
    if (cached === undefined) {
      // The cache is keyed by hash and re-verified on read, so a failed write only costs a lookup.
      await this.colorStore!.putDeploy(assetId, declarationTx.toHex()).catch(() => undefined)
    }
    const resolved = resolveRequirements(attributes, this.profiles)
    const provider = routeProvider(assetId, resolved, this.provider)
    const { handlers } = resolved
    let operations: Set<ColorOperationName> | undefined
    for (const { handler } of handlers) {
      if (handler.operations === undefined) continue
      const allowed = operations
      operations = new Set(handler.operations.filter(op => allowed?.has(op) ?? true))
    }
    const sendPolicy = handlers.some(({ handler }) => handler.sendPolicy === 'plain-nosend')
      ? 'plain-nosend'
      : undefined
    // The default attested construction applies unless `evidenceProfile` delegates it (0207:435).
    const declared = handlers.find(({ handler }) => handler.id === ATTESTED_PROFILE_ID)
    const params =
      declared === undefined ? undefined : parseAttestedParams(declared.descriptor.params)
    const attested = params?.evidenceProfile === undefined ? params : undefined
    // Offline acceptance after an `unavailable` admission needs the default attested evidence
    // policy, so a hook on an asset without it would silently never run (Decision 3).
    if (
      attested === undefined &&
      handlers.some(({ handler }) => handler.admitReceipt !== undefined)
    ) {
      throw new ProfileParamsError('BRC-207: admitReceipt requires the attested profile')
    }
    return {
      assetId,
      declarationTx,
      ...(attributes === undefined ? {} : { attributes }),
      req: resolved.req,
      handlers,
      provider,
      ...(sendPolicy === undefined ? {} : { sendPolicy }),
      ...(operations === undefined ? {} : { operations }),
      ...(attested === undefined ? {} : { attested }),
      maxReceiptBytes:
        handlers.length === 0
          ? MAX_RECEIPT_INSTRUCTION_BYTES
          : Math.max(
              ...handlers.map(
                ({ handler }) => handler.maxReceiptBytes ?? MAX_RECEIPT_INSTRUCTION_BYTES
              )
            )
    }
  }

  /**
   * The deploy output of `tx` read with this module's reader, or a throw when it is not the
   * asset's deploy. `tx` must already be known to have the asset's txid.
   */
  protected deployToken(assetId: string, tx: Transaction, vout: number): TokenOutput {
    const output = tx.outputs[vout]
    const token =
      output === undefined
        ? undefined
        : readAnyTokenOutput(output.lockingScript, { txid: tx.id('hex'), vout }, this.read)
    if (token?.deploy !== true || token.assetId !== assetId) {
      throw new Error(`BRC-207: ${assetId} is not a token deploy`)
    }
    return token
  }

  /** The cached deploy when its bytes hash to the asset's txid; a mismatching entry is deleted. */
  protected async cachedDeploy(assetId: string, txid: string): Promise<Transaction | undefined> {
    let hex: string | undefined
    try {
      hex = await this.colorStore!.getDeploy(assetId)
    } catch {
      return undefined // An unreadable cache is a miss: every other source is verified by hash.
    }
    if (hex === undefined) return undefined
    const tx = canonicalTransaction(hex, txid)
    if (tx === undefined) await this.colorStore!.deleteDeploy(assetId).catch(() => undefined)
    return tx
  }

  /**
   * The deploy transaction from the default provider, then from each registered handler's
   * `deployProviders()` in registration order (each distinct provider asked once). A provider
   * failure moves on to the next; when none has the deploy, the first failure is reported, or that
   * no overlay has it.
   */
  protected async providedDeploy(
    assetId: string,
    txid: string,
    vout: number
  ): Promise<Transaction> {
    const outpoint = outpointString(txid, vout)
    const asked = new Set<ColorOverlayProvider>()
    let failure: { error: unknown } | undefined
    const ask = async (provider: ColorOverlayProvider): Promise<Transaction | undefined> => {
      if (asked.has(provider)) return undefined
      asked.add(provider)
      try {
        // readOutputList derives each outpoint from the transaction's own id: a hash check.
        return readOutputList(await provider.admission(assetId, [outpoint]), [outpoint]).get(
          outpoint
        )?.transaction
      } catch (error) {
        failure ??= { error }
        return undefined
      }
    }
    const found = await ask(this.provider)
    if (found !== undefined) return found
    for (const handler of this.profiles.values()) {
      if (handler.deployProviders === undefined) continue
      let providers: ColorOverlayProvider[]
      try {
        providers = [...handler.deployProviders()]
      } catch (error) {
        failure ??= { error }
        continue
      }
      for (const provider of providers) {
        const tx = await ask(provider)
        if (tx !== undefined) return tx
      }
    }
    if (failure !== undefined) throw failure.error
    throw new Error(`BRC-207: the overlay has no admitted deploy for ${assetId}`)
  }

  /**
   * Fails unless each token conforms to its asset's deploy: a successor's `req`, when present, must
   * be byte-identical to the deploy's (0207:92-95, C03/C04), and each required profile's own `ext`
   * entry must pass its handler's `checkExt` (or be absent without one). A BRC-161 JSON token
   * supplies no ext state, so each required profile's `checkExt` sees an absent entry (0207: a
   * required profile may reject that absence); deploy requirements still apply to it. Other
   * tokens read without attributes (the 0.1.0 reader) are only resolved.
   */
  protected async assertConformingTokens(tokens: Iterable<TokenOutput>): Promise<void> {
    const list = [...tokens]
    const assets = new Map<string, ResolvedAsset>()
    await eachInOrder(new Set(list.map(token => token.assetId)), async assetId => {
      assets.set(assetId, await this.resolveAsset(assetId))
    })
    for (const token of list) {
      const asset = assets.get(token.assetId)!
      if (token.attributes === undefined) {
        if (token.encoding === 'brc161') assertOwnExtEntries(asset.handlers, ABSENT_ATTRIBUTES)
        continue
      }
      assertWellFormedProfileMaps(token.attributes)
      if (!reqMatchesDeploy(asset.attributes ?? ABSENT_ATTRIBUTES, token.attributes)) {
        throw new ProfileParamsError('BRC-207: successor requirements differ from the deploy')
      }
      assertOwnExtEntries(asset.handlers, token.attributes)
    }
  }

  /**
   * Whether an attestation signer counts for an asset: its identity key in identity mode, else a
   * member of the current trust snapshot. An asset without the default attested construction
   * trusts no signer, so it never settles through `settle()`.
   */
  protected async qualifiesFor(assetId: string): Promise<(signer: string) => boolean> {
    const resolved = await this.resolveAsset(assetId)
    const params = resolved.attested
    if (params === undefined) return () => false
    const { handler } = resolved.handlers.find(({ handler }) => handler.id === ATTESTED_PROFILE_ID)!
    const snapshot = await trustSnapshot(handler, params)
    return qualifyingSigner(params, snapshot?.identityKeys)
  }

  /** True when the asset's value or authority basket lists `outpoint` (all pages). */
  protected async holds(outpoint: string, assetId: string): Promise<boolean> {
    for (const role of ['value', 'authority'] as const) {
      const basket = assetBasket(assetId, role)
      for (let offset = 0; ;) {
        const page = await this.wallet.listOutputs({ basket, limit: LIST_PAGE_LIMIT, offset })
        if (page.outputs.some(output => output.outpoint === outpoint)) return true
        offset += page.outputs.length
        if (page.outputs.length < LIST_PAGE_LIMIT) break
      }
    }
    return false
  }

  /** The vouts of `tx`'s token outputs of `assetId`, read with this module's reader. */
  protected tokenVouts(tx: Transaction, assetId: string): number[] {
    const txid = tx.id('hex')
    return tx.outputs.flatMap((output, vout) => {
      try {
        return readAnyTokenOutput(output.lockingScript, { txid, vout }, this.read)?.assetId ===
          assetId
          ? [vout]
          : []
      } catch {
        return []
      }
    })
  }

  /** The non-deploy token outputs of `tx` in either encoding, read with this module's reader. */
  protected outputTokens(tx: Transaction): TokenOutput[] {
    const txid = tx.id('hex')
    return tx.outputs.flatMap((output, vout) => {
      const token = readSentToken(output.lockingScript, { txid, vout }, this.read)
      return token === undefined || token.deploy ? [] : [token]
    })
  }

  /** The provider for every query and submit of an asset: the default one without profiles. */
  protected async providerFor(assetId: string): Promise<ColorOverlayProvider> {
    if (this.profiles.size === 0) return this.provider
    return (await this.resolveAsset(assetId)).provider
  }

  /**
   * The queried outputs that may be spent. Without profiles, and for an asset without the default
   * attested construction, these are the outputs the overlay reports admitted and unspent
   * (`liveSpendable`). For an attested asset (contract §2.2-7) each output is decided in order:
   * 1. an output of a finally refused transaction is never spendable (C55);
   * 2. a held output of a settled transaction is checked live on the routed provider: a transport
   *    failure proceeds on the stored attestation; an unlisted one is resubmitted through the
   *    settle path (its exact stored bytes and off-chain values, under the per-txid latch), then
   *    checked again, and excluded if still unlisted;
   * 3. a held output with a stored record and no settlement: for a plain-noSend hand-over
   *    (`spend.offline`), whose recipient submits its ancestors first, it is spendable offline,
   *    with no overlay contact, when its stored evidence still holds (in identity mode the
   *    evidence walk to its anchors, in the list modes the complete frontier against the current
   *    trust snapshot, C17). For any other action, which this wallet publishes, the transaction
   *    and its unsettled ancestors are first settled, parents first, through `settle()` (one
   *    single-flight run), and the output then gets the baseline live check: it is spent only
   *    once the overlay lists it, and an unreachable overlay fails the check (pinned brc-0207:
   *    before publishing a child, establish acceptance of its required ancestors);
   * 4. any other output gets the baseline live check.
   */
  protected async spendable(
    assetId: string,
    outputs: readonly SourceOutput[],
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<Set<string>> {
    if (this.profiles.size > 0 && outputs.length > 0) {
      const resolved = await this.resolveAsset(assetId)
      if (resolved.attested !== undefined)
        return await this.attestedSpendable(resolved, outputs, spend)
    }
    return await this.liveSpendable(assetId, outputs)
  }

  /** The attested branch of `spendable` (steps 1-4 there). */
  protected async attestedSpendable(
    resolved: ResolvedAsset,
    outputs: readonly SourceOutput[],
    spend: SpendContext = PUBLISHED_SPEND
  ): Promise<Set<string>> {
    const { assetId } = resolved
    const store = this.colorStore!
    const spendable = new Set<string>()
    const facts = new Map<
      string,
      { refused: boolean; settled: boolean; record?: TxRecord; tx?: Transaction }
    >()
    const txids = new Set(outputs.map(output => parseOutpoint(output.outpoint).txid))
    await eachInOrder(txids, async txid => {
      if ((await store.refused(txid)) !== undefined) {
        facts.set(txid, { refused: true, settled: false })
        return
      }
      const record = await store.getTx(txid)
      const tx = record === undefined ? undefined : storedTransaction(record, txid)
      facts.set(txid, {
        refused: false,
        settled: (await store.settled(txid)) !== undefined,
        ...(record === undefined ? {} : { record }),
        ...(tx === undefined ? {} : { tx })
      })
    })
    const settled: SourceOutput[] = []
    const offline = new Map<string, SourceOutput[]>()
    const baseline: SourceOutput[] = []
    for (const output of outputs) {
      const { txid, vout } = parseOutpoint(output.outpoint)
      const fact = facts.get(txid)!
      if (fact.refused) continue
      if (!holdsStoredOutput(fact.record, fact.tx, assetId, vout, output)) {
        baseline.push(output)
      } else if (fact.settled) {
        settled.push(output)
      } else {
        const group = offline.get(txid) ?? []
        group.push(output)
        offline.set(txid, group)
      }
    }

    if (settled.length > 0) {
      const listed = await this.reachableSpendable(assetId, settled)
      if (listed === undefined) {
        // Unreachable overlay: proceed on the stored, verified attestation while it still covers
        // the output under the current trust (C17).
        const records = new Map([...facts].map(([txid, fact]) => [txid, fact.record] as const))
        for (const outpoint of await this.storedCoverage(resolved, settled, records)) {
          spendable.add(outpoint)
        }
      } else {
        for (const outpoint of listed) spendable.add(outpoint)
        const unlisted = settled.filter(output => !listed.has(output.outpoint))
        if (unlisted.length > 0) {
          await eachInOrder(
            new Set(unlisted.map(output => parseOutpoint(output.outpoint).txid)),
            async txid => {
              // A failed resubmission leaves the output unlisted; the recheck decides.
              await this.settler!.settleTx(txid).catch(() => undefined)
            }
          )
          const rechecked = await this.reachableSpendable(assetId, unlisted)
          for (const outpoint of rechecked ?? []) spendable.add(outpoint)
        }
      }
    }

    if (spend.offline) {
      await eachInOrder(offline, async ([txid, group]) => {
        if (await this.offlineEvidenceHolds(resolved, txid, group)) {
          for (const output of group) spendable.add(output.outpoint)
        } else {
          baseline.push(...group)
        }
      })
    } else if (offline.size > 0) {
      // Parents first, under the settler's single flight and per-txid latch; the live check
      // below decides, so a refused, unreachable or failed settlement spends nothing.
      await this.settler!.settle(
        { txids: [...offline.keys()], assetIds: [assetId] },
        spend.originator
      ).catch(() => undefined)
      for (const group of offline.values()) baseline.push(...group)
    }

    if (baseline.length > 0) {
      for (const outpoint of await this.liveSpendable(assetId, baseline)) spendable.add(outpoint)
    }
    return spendable
  }

  /**
   * The settled outputs whose stored attestations still cover them (C17, 0207:231-233): in
   * identity mode the settled record stands, since its key is fixed; in the list modes each
   * output's verifying stored attestations must pass `assertCoverage` under the current trust
   * snapshot. An unavailable trust list covers nothing.
   */
  protected async storedCoverage(
    resolved: ResolvedAsset,
    outputs: readonly SourceOutput[],
    records: ReadonlyMap<string, TxRecord | undefined>
  ): Promise<string[]> {
    const params = resolved.attested!
    if (params.trustMode === 'identity') return outputs.map(output => output.outpoint)
    const { handler } = resolved.handlers.find(({ handler }) => handler.id === ATTESTED_PROFILE_ID)!
    let identityKeys: string[] | undefined
    try {
      identityKeys = (await trustSnapshot(handler, params))?.identityKeys
    } catch {
      return []
    }
    return outputs.flatMap(output => {
      const { txid, vout } = parseOutpoint(output.outpoint)
      const signers = (records.get(txid)?.attestations ?? [])
        .filter(
          att =>
            att.txid === txid &&
            att.outputs.includes(vout) &&
            verifyAttestation(att, resolved.assetId)
        )
        .map(att => att.signer)
      try {
        assertCoverage(params, [{ outpoint: output.outpoint, signers }], identityKeys)
        return [output.outpoint]
      } catch {
        return []
      }
    })
  }

  /**
   * The current trust snapshot version of each attested list-mode asset among `assetIds` (`null`
   * when the list is unavailable), captured with a spend decision and compared again before a
   * signature is released (C16, 0207:229-230). Empty without profiles.
   */
  protected async trustVersions(assetIds: Iterable<string>): Promise<Map<string, string | null>> {
    const versions = new Map<string, string | null>()
    if (this.profiles.size === 0) return versions
    await eachInOrder(new Set(assetIds), async assetId => {
      const resolved = await this.resolveAsset(assetId)
      const params = resolved.attested
      if (params === undefined || params.trustMode === 'identity') return
      const { handler } = resolved.handlers.find(
        ({ handler }) => handler.id === ATTESTED_PROFILE_ID
      )!
      versions.set(
        assetId,
        await trustSnapshot(handler, params).then(
          snapshot => snapshot?.snapshot ?? null,
          () => null
        )
      )
    })
    return versions
  }

  /** Fails with `trust snapshot changed` when any version captured by `trustVersions` moved. */
  protected async assertTrustUnchanged(
    versions: ReadonlyMap<string, string | null>
  ): Promise<void> {
    if (versions.size === 0) return
    const now = await this.trustVersions(versions.keys())
    for (const [assetId, version] of versions) {
      if (now.get(assetId) !== version) throw new AttestationEvidenceError('trust snapshot changed')
    }
  }

  /**
   * `liveSpendable`, or undefined when the provider fails with a transport `ColorProviderError`
   * (no typed verdict). Any other failure is thrown, as in the baseline check.
   */
  protected async reachableSpendable(
    assetId: string,
    outputs: readonly SourceOutput[]
  ): Promise<Set<string> | undefined> {
    try {
      return await this.liveSpendable(assetId, outputs)
    } catch (error) {
      if (
        isNamedError(error, 'ColorProviderError') &&
        (error as { transport?: unknown }).transport === true
      ) {
        return undefined
      }
      throw error
    }
  }

  /**
   * Whether the stored evidence behind held, unsettled outputs of `txid` still allows spending
   * them offline: the store walk from them reaches attested anchors through stored records; in
   * the list modes the complete frontier is validated again from the stored bytes and its anchors
   * must cover it under the current trust snapshot. Never contacts an overlay; any failure is
   * false.
   */
  protected async offlineEvidenceHolds(
    resolved: ResolvedAsset,
    txid: string,
    outputs: readonly SourceOutput[]
  ): Promise<boolean> {
    const { assetId } = resolved
    const params = resolved.attested!
    try {
      const evidence = await this.attestedEvidence(
        assetId,
        outputs.map(output => output.outpoint)
      )
      // Identity mode trusts one fixed key, so the receipt-time validation still stands.
      if (params.trustMode === 'identity') return true
      const { handler } = resolved.handlers.find(
        ({ handler }) => handler.id === ATTESTED_PROFILE_ID
      )!
      const snapshot = await trustSnapshot(handler, params)
      const bodies = new Map<string, Transaction>()
      const addBodies = (atomicBEEF: string): void => {
        for (const entry of Beef.fromBinary(toArray(atomicBEEF, 'hex')).txs) {
          if (entry.tx !== undefined) bodies.set(entry.txid, entry.tx)
        }
      }
      for (const [, record] of evidence.records) addBodies(record.atomicBEEF)
      await eachInOrder(new Set(evidence.attestations.map(att => att.txid)), async anchor => {
        const record = await this.colorStore!.getTx(anchor)
        if (record !== undefined) addBodies(record.atomicBEEF)
      })
      const declarationTx = resolved.declarationTx!
      bodies.set(declarationTx.id('hex'), declarationTx)
      const tip = bodies.get(txid)
      if (tip === undefined) return false
      const frontier = validateFrontier({
        assetId,
        declarationTx,
        tip,
        start: { outputs: outputs.map(output => parseOutpoint(output.outpoint).vout) },
        bodies,
        attestations: evidence.attestations,
        qualifies: qualifyingSigner(params, snapshot?.identityKeys)
      })
      assertCoverage(params, frontier.anchors, snapshot?.identityKeys)
      return true
    } catch {
      return false
    }
  }

  /** The queried outputs the overlay reports admitted and unspent, matched to their source bytes. */
  protected async liveSpendable(
    assetId: string,
    outputs: readonly SourceOutput[]
  ): Promise<Set<string>> {
    const outpoints = outputs.map(output => output.outpoint)
    const provider = await this.providerFor(assetId)
    const listed = readOutputList(await provider.spendability(assetId, outpoints), outpoints)
    for (const output of outputs) {
      const answer = listed.get(output.outpoint)
      if (
        answer !== undefined &&
        (answer.satoshis !== output.satoshis ||
          answer.lockingScript.toHex() !== output.lockingScript.toHex())
      ) {
        throw new Error(
          `BRC-207: the overlay answer for ${output.outpoint} does not match its source output`
        )
      }
    }
    return new Set(listed.keys())
  }

  /** All spendable outputs of one basket, with locking scripts and custom instructions. */
  protected async listBasket(
    basket: string,
    originator: string,
    filter: Pick<ListOutputsArgs, 'tags' | 'tagQueryMode' | 'includeTags'>
  ): Promise<WalletOutput[]> {
    const outputs: WalletOutput[] = []
    for (;;) {
      const page = await this.wallet.listOutputs(
        {
          basket,
          tags: filter.tags,
          tagQueryMode: filter.tagQueryMode,
          include: 'locking scripts',
          includeCustomInstructions: true,
          ...(filter.includeTags === true ? { includeTags: true } : {}),
          limit: LIST_PAGE_LIMIT,
          offset: outputs.length
        },
        originator
      )
      outputs.push(...page.outputs)
      if (page.outputs.length < LIST_PAGE_LIMIT) return outputs
    }
  }

  protected sourceOutput(output: WalletOutput): SourceOutput {
    if (output.lockingScript === undefined)
      throw new Error('BRC-207: the wallet omitted a locking script')
    return {
      outpoint: output.outpoint,
      lockingScript: LockingScript.fromHex(output.lockingScript),
      satoshis: output.satoshis
    }
  }

  protected preimage(
    tx: Transaction,
    inputIndex: number,
    source: SourceOutput,
    scope: number
  ): number[] {
    if ((scope & 0x1f) === TransactionSignature.SIGHASH_SINGLE && inputIndex >= tx.outputs.length) {
      throw new Error('BRC-207: SIGHASH_SINGLE requires an output at the signed input index')
    }
    const { txid, vout } = parseOutpoint(source.outpoint)
    return TransactionSignature.format({
      sourceTXID: txid,
      sourceOutputIndex: vout,
      sourceSatoshis: source.satoshis,
      transactionVersion: tx.version,
      otherInputs: tx.inputs.filter((_, index) => index !== inputIndex),
      allInputs: tx.inputs,
      outputs: tx.outputs,
      inputIndex,
      subscript: source.lockingScript,
      inputSequence: tx.inputs[inputIndex].sequence ?? 0xffffffff,
      lockTime: tx.lockTime,
      scope
    })
  }

  /** Unlocking scripts for this module's inputs of `template`, keyed by input index. */
  protected async signInputs(
    template: Transaction,
    inputs: readonly ManagedInput[],
    scopes: ReadonlyMap<string, number>,
    originator: string,
    missing: string
  ): Promise<Record<number, { unlockingScript: string }>> {
    const indexed = inputs.map(input => {
      const index = template.inputs.findIndex(
        candidate => inputOutpoint(candidate) === input.outpoint
      )
      if (index < 0) throw new Error(missing)
      return { index, input }
    })
    const scripts = await Promise.all(
      indexed.map(
        async ({ index, input }) =>
          await this.unlock(
            template,
            index,
            input,
            scopes.get(input.outpoint) ?? DEFAULT_SIGHASH,
            originator
          )
      )
    )
    return Object.fromEntries(
      indexed.map(({ index }, position) => [index, { unlockingScript: scripts[position] }])
    )
  }

  /** P2PKH unlocking script for a managed input, signed with its `p color` key. */
  protected async unlock(
    tx: Transaction,
    inputIndex: number,
    input: ManagedInput,
    scope: number,
    originator: string
  ): Promise<string> {
    const protocolID = colorProtocolID(
      input.custody.assetId,
      input.custody.derivationPrefix,
      input.custody.derivationSuffix
    )
    const counterparty = input.custody.senderIdentityKey
    const { signature } = await this.wallet.createSignature(
      {
        protocolID,
        keyID: COLOR_KEY_ID,
        counterparty,
        hashToDirectlySign: hash256(this.preimage(tx, inputIndex, input, scope))
      },
      originator
    )
    const der = Signature.fromDER(signature)
    const checksig = new TransactionSignature(der.r, der.s, scope).toChecksigFormat()
    const publicKey = toArray(await this.publicKey(input.custody, counterparty, originator), 'hex')
    return new UnlockingScript([
      { op: checksig.length, data: checksig },
      { op: publicKey.length, data: publicKey }
    ]).toHex()
  }

  protected async approve(originator: string, request: Record<string, unknown>): Promise<void> {
    const approved = await this.requestTokenAccess(originator, JSON.stringify(request))
    if (approved !== true) throw new ColorConsentDeclinedError(String(request.type))
  }

  /** Every `p color` read asks the host; the host decides whether an existing grant covers it. */
  /**
   * Asks the host to approve a read, naming what is read: the `basket` requested (with the
   * `assetId` and `role` of a balance or holdings read) or the `p color` `labels` of a
   * listActions, and the caller's `seekPermission`.
   */
  protected async authorizeRead(originator: string, read: Record<string, unknown>): Promise<void> {
    await this.approve(originator, { type: 'color_access', ...read })
  }
}
