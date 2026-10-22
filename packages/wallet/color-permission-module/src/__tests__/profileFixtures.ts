import {
  Curve,
  LockingScript,
  P2PKH,
  PrivateKey,
  ProtoWallet,
  Signature,
  Transaction,
  type InternalizeActionArgs
} from '@bsv/sdk'
import { hash160 } from '@bsv/sdk/primitives/Hash'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import { encodeStrictCbor, OneColor, type StrictCborValue } from '@bsv/templates'
import { ATTESTED_PROFILE_ID, attestationFromSteak } from '../attestation.js'
import { parseAttestedParams } from '../attested.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import {
  ColorProviderError,
  isNamedError,
  ProfileDataError,
  ProfileParamsError
} from '../errors.js'
import { assetBasket, COLOR_KEY_ID, colorProtocolID } from '../identifiers.js'
import type {
  ColorAttestation,
  ProfileAssetContext,
  ReceiptGraph,
  RequiredProfileHandler,
  ResolvedAsset
} from '../profiles.js'
import type { JsonValue } from '../strictJson.js'
import type { TokenOutput } from '../tokenOutputs.js'
import type { AttestedSTEAK, ColorModuleStore, ColorOverlayProvider } from '../types.js'
import { FakeProvider, remittanceString, type FakeWallet } from './fixtures.js'

/** A Map-backed `ColorModuleStore` that logs every `set` key, in order. */
export class FakeStore implements ColorModuleStore {
  readonly entries = new Map<string, string>()
  readonly writes: string[] = []

  get = async (key: string): Promise<string | undefined> => this.entries.get(key)

  set = async (key: string, value: string): Promise<void> => {
    this.writes.push(key)
    this.entries.set(key, value)
  }

  delete = async (key: string): Promise<void> => {
    this.entries.delete(key)
  }

  keys = async (prefix: string): Promise<string[]> =>
    [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort()

  /** Simulates store loss. */
  clear(): void {
    this.entries.clear()
  }
}

const isRevision = (value: StrictCborValue): boolean =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
  (typeof value === 'bigint' && value >= 0n)

/**
 * The A.141a revision profile (0207 Appendix A.141a): `urn:example:color:revision` v1, null
 * params, and an optional `ext` entry `{revision: uint}`.
 */
export function exampleProfile(): RequiredProfileHandler {
  return {
    id: 'urn:example:color:revision',
    versions: [1],
    checkDescriptor: descriptor => {
      if (descriptor.params !== null) {
        throw new ProfileParamsError('BRC-207: the revision profile takes null params')
      }
    },
    checkExt: value => {
      if (value === undefined) return
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        value instanceof Uint8Array ||
        Object.keys(value).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(value, 'revision') ||
        !isRevision((value as Record<string, StrictCborValue>).revision)
      ) {
        throw new ProfileParamsError('BRC-207: the revision ext entry must be {revision: uint}')
      }
    }
  }
}

/** The BRC-207 C.0 attestation vectors (0207:10224-10264). Priv 5555 is a public test key. */
export const C0 = {
  PRIV: 5555,
  SIGNER: '02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046',
  CHILD: '033520aaa77b6914019796e974d1737acc890c5283c0921ddcfc2d5c815db8fb90',
  DIGEST: '9f61b417ec979c3c057313fe56f3c6056d2962b6bceaaa8272377bb9a80d8f9d',
  TWEAK: '6ef21748a4f6f5034842184e25f68e8df8663e036622ad9b3d061c6dd81ea93b',
  INVOICE: '2-color admission attestation-1',
  ASSET: 'c7d0f61946bc8bde6c01219c67bb99cbf2f89a39bcaea9c2ecf67c54224edb4f_0',
  TXID: '05fabadb4a03eb7d5e54713824a483161a82ecc7061b124e99a13e9778131931',
  OUTPUTS: [0, 2],
  LOW_S:
    '3045022100d1f48fc13a1ffd18196bcb6166aff936b8dc6cb7b0866fe9226ef1db89fb06be02203eff5870ae5215047d1d624733b29f563d5037660ce5c4ed0ce4ac52cc56758a',
  HIGH_S:
    '3046022100d1f48fc13a1ffd18196bcb6166aff936b8dc6cb7b0866fe9226ef1db89fb06be022100c100a78f51adeafb82e29db8cc4d60a87d5ea580a262db4eb2edb23a03dfcbb7',
  MESSAGE:
    '1color-admit:v1:tm_color_c7d0f61946bc8bde6c01219c67bb99cbf2f89a39bcaea9c2ecf67c54224edb4f_0:05fabadb4a03eb7d5e54713824a483161a82ecc7061b124e99a13e9778131931:0,2'
} as const

/**
 * Signs an attested-v1 statement (contract §3) with `priv` through a ProtoWallet, the way an
 * overlay does: protocol `[2, 'color admission attestation']`, key ID `'1'`, counterparty
 * `anyone`. The message is built here, independently of the module, so tests stay an oracle.
 */
export async function signAttestation(
  priv: PrivateKey,
  assetId: string,
  txid: string,
  outputs: readonly number[]
): Promise<ColorAttestation> {
  const message = `1color-admit:v1:tm_color_${assetId}:${txid}:${outputs.join(',')}`
  const { signature } = await new ProtoWallet(priv).createSignature({
    data: toArray(message, 'utf8'),
    protocolID: [2, 'color admission attestation'],
    keyID: '1',
    counterparty: 'anyone'
  })
  return {
    txid,
    outputs: [...outputs],
    signer: priv.toPublicKey().toString(),
    signature: toHex(signature)
  }
}

/** The A.141a required-profile deploy locking scripts (0207:9376-9383), verbatim. */
export const A141A = {
  U: '00596d33a163726571a1781975726e3a6578616d706c653a636f6c6f723a756e6b6e6f776ea266706172616d73f66776657273696f6e017576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  V: '00596d34a163726571a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e027576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  C: '00596d4c60a263657874a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea1687265766973696f6e0063726571a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e0175ab76a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  D: '00596d3fa263657874a1781975726e3a6578616d706c653a646973706c61793a776f726473a2636f6e65646974656d646d616e79656974656d736373796d644954454d7576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  M: '00596d06a163726571f67576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  L: '0063036f726451126170706c69636174696f6e2f6273762d3230004ca37b2270223a226273762d3230222c226f70223a226465706c6f792b6d696e74222c22616d74223a2239222c22636f6c6f725061796c6f6164223a22613136333732363537316131373831393735373236653361363537383631366437303663363533613633366636633666373233613735366536623665366637373665613236363730363137323631366437336636363737363635373237333639366636653031227d6876a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  X: '00596d4c8da263657874a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea1687265766973696f6e0063726571a2781975726e3a6578616d706c653a636f6c6f723a756e6b6e6f776ea266706172616d73f66776657273696f6e01781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e0175ab76a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  N: '00596d36a163726571a1781c75726e3a6578616d706c653a636f6c6f723a6e6f2d6f7665726c6179a266706172616d73f66776657273696f6e017576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac'
} as const

/** A one-output transaction (1000 sats) carrying `hex` as output 0, and its asset id `<txid>_0`. */
export function fixtureDeploy(hex: string): { tx: Transaction; assetId: string } {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: LockingScript.fromHex(hex), satoshis: 1000 })
  return { tx, assetId: `${tx.id('hex')}_0` }
}

/** Exposes the module's protected asset-resolution seams to tests. */
export class TestModule extends ColorPermissionModule {
  async resolveAssetForTest(
    assetId: string,
    evidence?: { declarationTx?: string }
  ): Promise<ResolvedAsset> {
    return await this.resolveAsset(assetId, evidence)
  }

  async providerForTest(assetId: string): Promise<ColorOverlayProvider> {
    return await this.providerFor(assetId)
  }

  async assertConformingTokensForTest(tokens: Iterable<TokenOutput>): Promise<void> {
    await this.assertConformingTokens(tokens)
  }

  async candidatesForTest(
    assetId: string,
    role: 'value' | 'authority',
    originator: string
  ): Promise<Array<{ outpoint: string; amount: bigint }>> {
    return await this.candidates(assetId, role, originator)
  }
}

/**
 * Contract §4 fixture F-REQ: the 328-byte DAG-CBOR `req` value of the Mandala deploy, with
 * K = `C0.SIGNER`. Attested v1 in identity mode, then the Mandala issuer-v1 profile.
 */
export const F_REQ_HEX =
  'a2781c68747470733a2f2f6272632e6465762f3230372f6174746573746564a266706172616d73a26974727573744d6f6465686964656e746974796b6964656e746974794b657978423032373938623831393531613661386337656638626564613039623036613233303331643765666166333762363633323635653031383861623337383132343034366776657273696f6e01785068747470733a2f2f6769746875622e636f6d2f6273762d626c6f636b636861696e2f6d616e64616c612f626c6f622f6d61737465722f646f63732f70726f66696c65732f6973737565722d76312e6d64a266706172616d73a16b6964656e746974794b657978423032373938623831393531613661386337656638626564613039623036613233303331643765666166333762363633323635653031383861623337383132343034366776657273696f6e01'

/** The Mandala issuer-v1 profile id (contract §4): a test constant only; the module never names Mandala. */
export const MANDALA_ISSUER_ID =
  'https://github.com/bsv-blockchain/mandala/blob/master/docs/profiles/issuer-v1.md'

/** The deploy payload `{req: F_REQ}`: the attested identity-mode profile and Mandala issuer-v1. */
export const F_REQ_PAYLOAD: number[] = toArray(`a163726571${F_REQ_HEX}`, 'hex')

/** A graph input: output `vout` of `tx`, unlocked by `key` (default: the graph's owner). */
export interface GraphInput {
  tx: Transaction
  vout: number
  key?: PrivateKey
}

/**
 * A graph output: an amount of the graph's asset (`0n` is an authority), `'plain'` satoshis to the
 * owner, an explicit token of any asset, or a raw locking script.
 */
export type GraphOutput =
  | bigint
  | 'plain'
  | { assetId: string; amount: bigint; payload?: number[] }
  | { lockingScript: LockingScript }

/** Builds real BRC-162 transaction graphs whose P2PKH scripts verify under the interpreter. */
export interface GraphBuilder {
  /** The key every output pays to. */
  readonly owner: PrivateKey
  /** Every transaction built so far, keyed by txid. */
  readonly bodies: Map<string, Transaction>
  /** The asset of the last `deploy()`. */
  readonly assetId: string
  /** A no-input transaction with one plain P2PKH output (1000 sats) to the owner. */
  fund: () => Transaction
  /** A no-input deploy of `amount` (`0n`: the first authority) with `payload` (default F_REQ). */
  deploy: (amount?: bigint, payload?: number[]) => { tx: Transaction; assetId: string }
  /** A fully signed transaction spending `inputs` into `outputs` (1 sat each). */
  spend: (inputs: GraphInput[], outputs: GraphOutput[]) => Promise<Transaction>
  /** An attested-v1 statement by `signer` over `vouts` of `tx` for the graph's asset. */
  attest: (signer: PrivateKey, tx: Transaction, vouts: number[]) => Promise<ColorAttestation>
}

export function graph(owner: PrivateKey = new PrivateKey(4242)): GraphBuilder {
  const pubKeyHash = owner.toPublicKey().toHash() as number[]
  const bodies = new Map<string, Transaction>()
  let nonce = 1
  let assetId: string | undefined
  const add = (tx: Transaction): Transaction => {
    bodies.set(tx.id('hex'), tx)
    return tx
  }
  const asset = (): string => assetId ?? '0'.repeat(64) + '_0'
  const lockingScript = (output: GraphOutput): LockingScript => {
    if (output === 'plain') return new P2PKH().lock(pubKeyHash)
    if (typeof output === 'bigint') return new OneColor().lock(asset(), output, pubKeyHash)
    if ('lockingScript' in output) return output.lockingScript
    return new OneColor().lock(output.assetId, output.amount, pubKeyHash, output.payload)
  }
  return {
    owner,
    bodies,
    get assetId() {
      return asset()
    },
    fund: () => {
      const tx = new Transaction(1, [], [], nonce++)
      tx.addOutput({ lockingScript: new P2PKH().lock(pubKeyHash), satoshis: 1000 })
      return add(tx)
    },
    deploy: (amount = 0n, payload = F_REQ_PAYLOAD) => {
      const tx = new Transaction(1, [], [], nonce++)
      tx.addOutput({
        lockingScript: new OneColor().lock(null, amount, pubKeyHash, payload),
        satoshis: 1
      })
      add(tx)
      assetId = `${tx.id('hex')}_0`
      return { tx, assetId }
    },
    spend: async (inputs, outputs) => {
      const tx = new Transaction()
      for (const { tx: source, vout, key } of inputs) {
        tx.addInput({
          sourceTransaction: source,
          sourceOutputIndex: vout,
          unlockingScriptTemplate: new OneColor().unlock(key ?? owner)
        })
      }
      for (const output of outputs)
        tx.addOutput({ lockingScript: lockingScript(output), satoshis: 1 })
      await tx.sign()
      return add(tx)
    },
    attest: async (signer, tx, vouts) => await signAttestation(signer, asset(), tx.id('hex'), vouts)
  }
}

/** The deploy payload `{req: {attested: {params, version: 1}}}` (attested v1 only). */
export function attestedPayload(params: Record<string, string>): number[] {
  return encodeStrictCbor({ req: { [ATTESTED_PROFILE_ID]: { params, version: 1 } } })
}

/**
 * An attested-v1 asset deployed by the graph's owner with `amount` value units at output 0. `K`
 * is the identity key of identity mode, or the full params map. With `admit`, the deploy is
 * admitted to that provider.
 */
export function attestedAsset(
  g: GraphBuilder,
  K: string | Record<string, string>,
  options: {
    amount?: bigint
    admit?: { admit: (assetId: string, tx: Transaction, vout: number) => void }
  } = {}
): { tx: Transaction; assetId: string } {
  const params = typeof K === 'string' ? { trustMode: 'identity', identityKey: K } : K
  const deploy = g.deploy(options.amount ?? 1000n, attestedPayload(params))
  options.admit?.admit(deploy.assetId, deploy.tx, 0)
  return deploy
}

export interface AttestedReceipt {
  args: InternalizeActionArgs
  /** The receipt transaction. */
  tip: Transaction
  /** The attested parent of the first unattested hop. */
  anchor: Transaction
  /** Unattested ancestors between the anchor and the tip, parents first. */
  ancestors: Transaction[]
  /** The attested leaf as carried. */
  leaf: { [member: string]: JsonValue }
  /** The custody members the wallet must receive (the 5-member JSON). */
  custody: {
    version: 1
    assetId: string
    derivationPrefix: string
    derivationSuffix: string
    senderIdentityKey: string
  }
}

/**
 * A complete attested receipt for `recipient`: deploy → anchor (attested by `signers` over both
 * of its outputs) → `unattested` hops → tip paying `amount` at output 0 to the recipient's
 * `p color` key, from the graph's owner as sender. With `attestTip`, the tip is attested by the
 * signers too. The leaf carries the deploy, the unattested ancestors (parents first, no tip),
 * every attestation and a submission per unattested tx and the tip (`tipOffChainValues`).
 */
export async function attestedReceipt(options: {
  g: GraphBuilder
  deploy: Transaction
  recipient: FakeWallet
  signers: PrivateKey[]
  amount?: bigint
  unattested?: number
  attestTip?: boolean
  tipOffChainValues?: string
  tags?: string[]
  seekPermission?: boolean
  extraProfileData?: Record<string, Record<string, JsonValue>>
}): Promise<AttestedReceipt> {
  const { g, deploy, recipient, signers } = options
  const assetId = `${deploy.id('hex')}_0`
  const supply = OneColor.decode(deploy.outputs[0].lockingScript).amount
  const amount = options.amount ?? 600n
  const anchor = await g.spend([{ tx: deploy, vout: 0 }], [amount, supply - amount])
  const attestations: ColorAttestation[] = []
  for (const signer of signers) attestations.push(await g.attest(signer, anchor, [0, 1]))
  const ancestors: Transaction[] = []
  let previous = anchor
  for (let hop = 0; hop < (options.unattested ?? 0); hop++) {
    previous = await g.spend([{ tx: previous, vout: 0 }], [amount])
    ancestors.push(previous)
  }
  const custody = {
    version: 1 as const,
    assetId,
    derivationPrefix: remittanceString(),
    derivationSuffix: remittanceString(),
    senderIdentityKey: g.owner.toPublicKey().toString()
  }
  const { publicKey } = await new ProtoWallet(g.owner).getPublicKey({
    protocolID: colorProtocolID(assetId, custody.derivationPrefix, custody.derivationSuffix),
    keyID: COLOR_KEY_ID,
    counterparty: recipient.identityKey
  })
  const tip = await g.spend(
    [{ tx: previous, vout: 0 }],
    [
      {
        lockingScript: new OneColor().lock(assetId, amount, hash160(toArray(publicKey, 'hex')))
      }
    ]
  )
  if (options.attestTip === true) {
    for (const signer of signers) attestations.push(await g.attest(signer, tip, [0]))
  }
  const leaf: { [member: string]: JsonValue } = {
    declarationTx: deploy.toHex(),
    transactions: ancestors.map(tx => tx.toHex()),
    attestations: attestations.map(att => ({ ...att })),
    submissions: [
      ...ancestors.map(tx => ({ txid: tx.id('hex'), offChainValues: '' })),
      { txid: tip.id('hex'), offChainValues: options.tipOffChainValues ?? '' }
    ]
  }
  const customInstructions = JSON.stringify({
    ...custody,
    profileData: { [ATTESTED_PROFILE_ID]: { [assetId]: leaf }, ...options.extraProfileData }
  })
  const args: InternalizeActionArgs = {
    tx: tip.toAtomicBEEF(),
    description: 'Receive tokens',
    outputs: [
      {
        outputIndex: 0,
        protocol: 'basket insertion',
        insertionRemittance: {
          basket: assetBasket(assetId, 'value'),
          customInstructions,
          ...(options.tags === undefined ? {} : { tags: options.tags })
        }
      }
    ],
    ...(options.seekPermission === undefined ? {} : { seekPermission: options.seekPermission })
  }
  return { args, tip, anchor, ancestors, leaf, custody }
}

/** The same signature with `s` replaced by `n - s` when it is low: the high-S twin (BSV Chronicle). */
export function highS(signature: string): string {
  const parsed = Signature.fromDER(signature, 'hex')
  const n = new Curve().n
  const s = parsed.s.gt(n.ushrn(1)) ? parsed.s : n.sub(parsed.s)
  return new Signature(parsed.r, s).toDER('hex') as string
}

/**
 * A `FakeProvider` whose `tm_color_*` STEAK entries carry an attested-v1 signature by priv 5555
 * (contract §3: the root identity key in `admissionIdentityKey`, the child-key signature in
 * `admissionSignature`). It records every submit's exact bytes and can be told to fail.
 */
export class AttestingProvider extends FakeProvider {
  readonly key = new PrivateKey(C0.PRIV)
  /** Every submit's topics and exact bytes, in call order (also failed ones). */
  readonly submitted: Array<{ topics: string[]; beef: number[]; offChainValues?: number[] }> = []
  /** Sign high-S statements (a valid signature under BSV Chronicle). */
  highS = false
  #failure: ColorProviderError | undefined

  constructor() {
    super()
    const admit = this.submit
    this.submit = async (topics, beef, offChainValues) => {
      this.submitted.push({
        topics: [...topics],
        beef: [...beef],
        ...(offChainValues === undefined ? {} : { offChainValues: [...offChainValues] })
      })
      if (this.#failure !== undefined) {
        this.calls.submit++
        throw this.#failure
      }
      const steak = await admit(topics, beef, offChainValues)
      const txid = Transaction.fromAtomicBEEF(beef).id('hex')
      const attested: AttestedSTEAK = {}
      for (const [topic, entry] of Object.entries(steak)) {
        if (!topic.startsWith('tm_color_') || entry.outputsToAdmit.length === 0) {
          attested[topic] = entry
          continue
        }
        const att = await signAttestation(
          this.key,
          topic.slice('tm_color_'.length),
          txid,
          entry.outputsToAdmit
        )
        attested[topic] = {
          ...entry,
          admissionSignature: this.highS ? highS(att.signature) : att.signature,
          admissionIdentityKey: att.signer
        }
      }
      return attested
    }
  }

  /** Every later submit is a transport failure. */
  failTransport(): void {
    this.#failure = new ColorProviderError('ERR_UNAVAILABLE', true, true, 'overlay unreachable')
  }

  /** Every later submit is a typed overlay refusal. */
  refuse(code: string, retryable: boolean): void {
    this.#failure = new ColorProviderError(code, retryable, false, `overlay refused (${code})`)
  }
}

/** The issuer-like test profile's id. */
export const ISSUER_LIKE_ID = 'urn:example:color:issuer'

/**
 * The deploy payload of an issuer-like asset: attested v1 in identity mode with `K`, plus the
 * issuer-like profile v1 with params `{identityKey: K}`.
 */
export function issuerLikePayload(K: string): number[] {
  return encodeStrictCbor({
    req: {
      [ATTESTED_PROFILE_ID]: { params: { trustMode: 'identity', identityKey: K }, version: 1 },
      [ISSUER_LIKE_ID]: { params: { identityKey: K }, version: 1 }
    }
  })
}

/**
 * A Mandala-like required profile (contract §7.1, D6/D7): plain-noSend transfers only, a 16 MiB
 * receipt limit, routed to `provider`. `admitReceipt` submits every pending tx in order, then the
 * tip when it is not pending, with the exact bytes and off-chain values, and maps the tip's STEAK
 * to `admitted`; a transport failure is `unavailable`, any other throw propagates. With
 * `requireOffChain`, an empty submission fails with ProfileDataError before anything is sent.
 */
export function issuerLikeProfile(options: {
  K: string
  provider: ColorOverlayProvider
  requireOffChain?: boolean
  onAdmit?: (ctx: ProfileAssetContext, graph: ReceiptGraph) => void
}): RequiredProfileHandler {
  const { K, provider } = options
  return {
    id: ISSUER_LIKE_ID,
    versions: [1],
    sendPolicy: 'plain-nosend',
    operations: ['transfer'],
    maxReceiptBytes: 16_777_216,
    provider: () => provider,
    checkDescriptor: (descriptor, req) => {
      const attested = req.get(ATTESTED_PROFILE_ID)
      const params = attested === undefined ? undefined : parseAttestedParams(attested.params)
      if (params?.trustMode !== 'identity' || params.identityKey !== K) {
        throw new ProfileParamsError('BRC-207: the issuer profile requires attested identity K')
      }
      const own = descriptor.params as Record<string, unknown> | null
      if (own === null || typeof own !== 'object' || own.identityKey !== K) {
        throw new ProfileParamsError('BRC-207: the issuer profile names another identity')
      }
    },
    checkPlanData: async () => {},
    submissionData: async (_ctx, view) => toArray(JSON.stringify(view.planLeaf ?? null), 'utf8'),
    admitReceipt: async (ctx, receipt) => {
      options.onAdmit?.(ctx, receipt)
      const entries = [...receipt.pending]
      if (!entries.some(entry => entry.txid === receipt.tip.txid)) entries.push(receipt.tip)
      if (
        options.requireOffChain === true &&
        entries.some(entry => entry.offChainValues.length === 0)
      ) {
        throw new ProfileDataError('BRC-207: the issuer profile requires off-chain values')
      }
      const topic = `tm_color_${receipt.assetId}`
      let tipSteak: AttestedSTEAK | undefined
      try {
        for (const entry of entries) {
          const steak = await provider.submit([topic], entry.atomicBEEF, entry.offChainValues)
          if (entry.txid === receipt.tip.txid) tipSteak = steak
        }
      } catch (error) {
        if (isNamedError(error, 'ColorProviderError') && (error as ColorProviderError).transport) {
          return { status: 'unavailable' }
        }
        throw error
      }
      const entry = tipSteak?.[topic]
      const att =
        entry === undefined ? undefined : attestationFromSteak(receipt.tip.txid, topic, entry)
      return { status: 'admitted', attestations: att === undefined ? [] : [att] }
    }
  }
}
