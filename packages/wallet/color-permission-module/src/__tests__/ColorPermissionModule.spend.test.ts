import { beforeEach, describe, expect, it } from '@jest/globals'
import {
  PrivateKey,
  Transaction,
  type CreateActionArgs,
  type CreateActionResult,
  type InternalizeActionArgs,
  type SignActionArgs,
  type SignActionResult
} from '@bsv/sdk'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import { encodeStrictCbor } from '@bsv/templates'
import type { PermissionsModuleAction } from '@bsv/wallet-toolbox-client'
import { ATTESTED_PROFILE_ID } from '../attestation.js'
import { createAttestedProfile } from '../attested.js'
import { ColorPlan } from '../ColorPlan.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { ColorProviderError } from '../errors.js'
import { colorTopic } from '../identifiers.js'
import type { RequiredProfileHandler } from '../profiles.js'
import { ColorStore } from '../store.js'
import {
  createModule,
  deployAsset,
  FakeProvider,
  FakeWallet,
  holdTokens,
  tokenPayment
} from './fixtures.js'
import {
  AttestingProvider,
  attestedAsset,
  attestedReceipt,
  C0,
  FakeStore,
  graph,
  issuerLikePayload,
  issuerLikeProfile,
  type GraphBuilder
} from './profileFixtures.js'

const APP = 'app.example'
const SIGNER = C0.SIGNER
const K = new PrivateKey(C0.PRIV)
/** A required profile that supplies BRC-22 off-chain values and sends ordinary broadcast actions. */
const DATA_ID = 'urn:example:color:data'
const DATA_BYTES = [1, 2, 3]

interface Bench {
  wallet: FakeWallet
  /** The default provider of attested-only assets, and the routed provider of issuer-like ones. */
  ap: AttestingProvider
  /** The default provider of issuer-like assets. */
  fallback: FakeProvider
  store: FakeStore
  colorStore: ColorStore
  g: GraphBuilder
  prompts: Array<Record<string, unknown>>
}

function bench(): Bench {
  const store = new FakeStore()
  return {
    wallet: new FakeWallet(),
    ap: new AttestingProvider(),
    fallback: new FakeProvider(),
    store,
    colorStore: new ColorStore(store),
    g: graph(),
    prompts: []
  }
}

function approve(b: Bench) {
  return async (_app: string, message: string): Promise<boolean> => {
    b.prompts.push(JSON.parse(message) as Record<string, unknown>)
    return true
  }
}

/** A module with the attested profile (and `extra` handlers); `b.ap` is its default provider. */
function attestedModule(
  b: Bench,
  options: {
    trustedIdentities?: () => Promise<{ snapshot: string; identityKeys: string[] }>
    extra?: RequiredProfileHandler[]
  } = {}
): ColorPermissionModule {
  const attested = createAttestedProfile(
    options.trustedIdentities === undefined
      ? undefined
      : { trustedIdentities: options.trustedIdentities }
  )
  const profiles: Record<string, RequiredProfileHandler> = { [attested.id]: attested }
  for (const handler of options.extra ?? []) profiles[handler.id] = handler
  return new ColorPermissionModule({
    wallet: b.wallet.asWallet(),
    provider: b.ap,
    requestTokenAccess: approve(b),
    profiles,
    store: b.store
  })
}

/** The attested and issuer-like profiles, issuer-like assets routed to `b.ap`. */
function issuerModule(b: Bench): ColorPermissionModule {
  const attested = createAttestedProfile()
  const issuer = issuerLikeProfile({ K: SIGNER, provider: b.ap })
  return new ColorPermissionModule({
    wallet: b.wallet.asWallet(),
    provider: b.fallback,
    requestTokenAccess: approve(b),
    profiles: { [attested.id]: attested, [issuer.id]: issuer },
    store: b.store
  })
}

/** A profile with `submissionData` and no send policy: its actions broadcast with off-chain values. */
function dataProfile(): RequiredProfileHandler {
  return {
    id: DATA_ID,
    versions: [1],
    checkDescriptor: () => {},
    submissionData: async () => [...DATA_BYTES]
  }
}

/** A list-mode plain-noSend profile: its hand-overs spend offline outputs with no overlay. */
const LIST_NOSEND_ID = 'urn:example:color:list-nosend'

function listNoSendProfile(): RequiredProfileHandler {
  return {
    id: LIST_NOSEND_ID,
    versions: [1],
    sendPolicy: 'plain-nosend',
    operations: ['transfer'],
    checkDescriptor: () => {}
  }
}

function listNoSendPayload(): number[] {
  return encodeStrictCbor({
    req: {
      [ATTESTED_PROFILE_ID]: { params: { trustMode: 'any' }, version: 1 },
      [LIST_NOSEND_ID]: { params: null, version: 1 }
    }
  })
}

/** The deploy payload of an attested identity-mode asset that also requires the data profile. */
function dataPayload(): number[] {
  return encodeStrictCbor({
    req: {
      [ATTESTED_PROFILE_ID]: { params: { trustMode: 'identity', identityKey: SIGNER }, version: 1 },
      [DATA_ID]: { params: null, version: 1 }
    }
  })
}

/**
 * Receives an attested payment of 600 into `b.wallet` through `module`: offline (with consent)
 * unless `attestTip`, in which case the tip is attested by K and settled at receipt. `unattested`
 * puts that many unattested hops between the attested anchor and the tip.
 */
async function receive(
  b: Bench,
  module: ColorPermissionModule,
  deploy: Transaction,
  options: { attestTip?: boolean; signers?: PrivateKey[]; unattested?: number } = {}
) {
  const receipt = await attestedReceipt({
    g: b.g,
    deploy,
    recipient: b.wallet,
    signers: options.signers ?? [K],
    attestTip: options.attestTip,
    unattested: options.unattested,
    tipOffChainValues: 'e0'
  })
  const { args } = await module.onRequest({
    method: 'internalizeAction',
    args: receipt.args,
    originator: APP
  })
  await b.wallet.internalizeAction(args as InternalizeActionArgs)
  const R = receipt.tip.id('hex')
  return { ...receipt, R, outpoint: `${R}.0` }
}

function planLabels(assetId: string): string[] {
  return ColorPlan.toLabels({
    version: 1,
    assets: [assetId],
    ownedOutputs: [],
    operations: [{ assetId, operation: 'transfer' }],
    inputPositions: [],
    changePositions: [],
    sighashTypes: []
  })
}

async function paymentOutput(assetId: string, amount: bigint) {
  const { tx } = await tokenPayment(new FakeWallet(), new FakeWallet(), assetId, amount)
  return {
    lockingScript: tx.outputs[0].lockingScript.toHex(),
    satoshis: 1,
    outputDescription: 'Token payment'
  }
}

/** The module's createAction handler alone: the funded arguments. */
async function plan(
  module: ColorPermissionModule,
  assetId: string,
  extra: Partial<CreateActionArgs> = {}
): Promise<CreateActionArgs> {
  return (
    await module.onRequest({
      method: 'createAction',
      args: {
        description: 'Send tokens',
        labels: planLabels(assetId),
        outputs: [await paymentOutput(assetId, 200n)],
        ...extra,
        options: { randomizeOutputs: false, ...extra.options }
      } as CreateActionArgs,
      originator: APP
    })
  ).args as CreateActionArgs
}

/**
 * The manager's flow up to the wallet's signAction: module createAction, wallet createAction,
 * module signAction. Returns what onResponse needs to finish.
 */
async function prepare(
  b: Bench,
  module: ColorPermissionModule,
  assetId: string,
  extra: Partial<CreateActionArgs> = {}
): Promise<{
  funded: CreateActionArgs
  action: PermissionsModuleAction
  signArgs: SignActionArgs
}> {
  const funded = await plan(module, assetId, extra)
  const created = (await module.onResponse(await b.wallet.createAction(funded), {
    method: 'createAction',
    originator: APP
  })) as CreateActionResult
  const signable = created.signableTransaction!
  const action: PermissionsModuleAction = {
    reference: signable.reference,
    transaction: Transaction.fromAtomicBEEF(signable.tx),
    noSend: funded.options?.noSend === true,
    createArgs: b.wallet.pending.get(signable.reference)!.args
  }
  const signArgs = (
    await module.onRequest({
      method: 'signAction',
      args: { reference: action.reference, spends: {} },
      originator: APP,
      action
    })
  ).args as SignActionArgs
  return { funded, action, signArgs }
}

/** The whole flow: prepare, the wallet's signAction, then the module's onResponse. */
async function send(
  b: Bench,
  module: ColorPermissionModule,
  assetId: string,
  extra: Partial<CreateActionArgs> = {}
): Promise<SignActionResult> {
  const { action, signArgs } = await prepare(b, module, assetId, extra)
  return (await module.onResponse(await b.wallet.signAction(signArgs), {
    method: 'signAction',
    originator: APP,
    action
  })) as SignActionResult
}

const calls = (provider: FakeProvider): number =>
  provider.calls.spendability + provider.calls.admission + provider.calls.submit

function transportDown(provider: FakeProvider): void {
  provider.spendability = async () => {
    provider.calls.spendability++
    throw new ColorProviderError('ERR_UNAVAILABLE', true, true, 'overlay unreachable')
  }
}

describe('spending attested assets', () => {
  let b: Bench

  beforeEach(() => {
    b = bench()
  })

  it('a broadcast action settles an offline input and its ancestors, parents first, before signing', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { outpoint, R, ancestors } = await receive(b, module, deploy, { unattested: 1 })
    expect(b.prompts.map(prompt => prompt.type)).toContain('color_receive_offline')
    expect(await module.isSettled(R)).toBe(false)
    const A = ancestors[0].id('hex')
    const before = b.ap.submissions.length

    const { funded, action, signArgs } = await prepare(b, module, assetId)

    // The parent, then the receipt, reached the overlay before the wallet could broadcast.
    expect(b.ap.submissions.slice(before).map(entry => entry.txid)).toEqual([A, R])
    expect(await module.isSettled(R)).toBe(true)
    expect(funded.inputs!.map(input => input.outpoint)).toEqual([outpoint])
    expect(Object.keys(signArgs.spends)).toEqual(['0'])

    const result = (await module.onResponse(await b.wallet.signAction(signArgs), {
      method: 'signAction',
      originator: APP,
      action
    })) as SignActionResult
    expect(b.ap.submissions.slice(before).map(entry => entry.txid)).toEqual([A, R, result.txid])
  })

  it('a broadcast action never spends an offline input its overlay does not accept', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { outpoint, R } = await receive(b, module, deploy, { unattested: 1 })
    const explicit = async () =>
      await plan(module, assetId, {
        inputs: [{ outpoint, inputDescription: 'Token' } as never],
        outputs: [await paymentOutput(assetId, 600n)]
      })

    // Unreachable: nothing is funded, and nothing is recorded refused.
    b.ap.failTransport()
    await expect(plan(module, assetId)).rejects.toThrow(/insufficient spendable balance/)
    await expect(explicit()).rejects.toThrow(/not admitted and unspent/)
    expect(await b.colorStore.refused(R)).toBeUndefined()
    expect(await module.isSettled(R)).toBe(false)
    expect(b.wallet.pending.size).toBe(0)

    // A final refusal of the parent refuses the receipt; it is never selected again.
    b.ap.refuse('ERR_CONFLICT', false)
    await expect(plan(module, assetId)).rejects.toThrow(/insufficient spendable balance/)
    expect(await b.colorStore.refused(R)).toBeDefined()
    expect(b.wallet.pending.size).toBe(0)
  })

  it('an offline output is handed over plain-noSend with no overlay contact', async () => {
    const module = issuerModule(b)
    const { tx: deploy, assetId } = b.g.deploy(2000n, issuerLikePayload(SIGNER))
    b.ap.failTransport()
    const { outpoint } = await receive(b, module, deploy)
    b.ap.online()
    expect(b.prompts.map(prompt => prompt.type)).toContain('color_receive_offline')
    const before = calls(b.ap) + calls(b.fallback)

    const result = await send(b, module, assetId, { options: { noSend: true } })

    const tx = Transaction.fromAtomicBEEF(result.tx!)
    expect(tx.inputs.map(input => `${input.sourceTXID}.${input.sourceOutputIndex}`)).toEqual([
      outpoint
    ])
    expect(calls(b.ap) + calls(b.fallback)).toBe(before)
    const { colorHandoff } = result as SignActionResult & {
      colorHandoff: { profileData: Record<string, Record<string, unknown>> }
    }
    expect(Object.keys(colorHandoff.profileData)).toEqual([ATTESTED_PROFILE_ID])
    expect(Object.keys(colorHandoff.profileData[ATTESTED_PROFILE_ID])).toEqual([assetId])
  })

  it('a settled output uses live spendability; a transport failure proceeds on the stored attestation', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { tip, outpoint, R } = await receive(b, module, deploy, { attestTip: true })
    expect(await module.isSettled(R)).toBe(true)
    b.ap.admit(assetId, tip, 0)

    const live = await plan(module, assetId)
    expect(live.inputs!.map(input => input.outpoint)).toEqual([outpoint])
    expect(b.ap.calls.spendability).toBeGreaterThan(0)
    expect(b.ap.submitted).toEqual([])

    transportDown(b.ap)
    const before = b.ap.calls.spendability
    const offline = await plan(module, assetId)
    expect(offline.inputs!.map(input => input.outpoint)).toEqual([outpoint])
    expect(b.ap.calls.spendability).toBeGreaterThan(before)
    expect(b.ap.submitted).toEqual([])
  })

  it('a settled output that is reachable but unlisted is resubmitted with stored bytes and offChainValues', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { args, outpoint, R } = await receive(b, module, deploy, { attestTip: true })
    const record = await b.colorStore.getTx(R)
    expect(record?.offChainValues).toBe('e0')

    const funded = await plan(module, assetId)

    expect(b.ap.submissions).toEqual([
      { topics: [colorTopic(assetId)], txid: R, offChainValues: toArray('e0', 'hex') }
    ])
    expect(b.ap.submitted[0].beef).toEqual(toArray(record!.atomicBEEF, 'hex'))
    expect(b.ap.submitted[0].beef).toEqual([...args.tx])
    expect(funded.inputs!.map(input => input.outpoint)).toEqual([outpoint])
  })

  it('an unlisted output that stays unlisted after resubmission is excluded', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { outpoint } = await receive(b, module, deploy, { attestTip: true })
    b.ap.rejectSubmissions = true

    await expect(plan(module, assetId)).rejects.toThrow(/insufficient spendable balance/)
    // Resubmitted once, through the settle path only.
    expect(b.ap.submitted).toHaveLength(1)
    await expect(
      plan(module, assetId, {
        inputs: [{ outpoint, inputDescription: 'Token' } as never],
        outputs: [await paymentOutput(assetId, 600n)]
      })
    ).rejects.toThrow(/not admitted and unspent/)
  })

  it('a refused resubmission of a settled transaction never marks it refused', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { tip, outpoint, R } = await receive(b, module, deploy, { attestTip: true })
    b.ap.refuse('ERR_CONFLICT', false)

    await expect(plan(module, assetId)).rejects.toThrow(/insufficient spendable balance/)
    expect(b.ap.submitted).toHaveLength(1)
    expect(await b.colorStore.refused(R)).toBeUndefined()
    expect(await module.isSettled(R)).toBe(true)

    // Listed again, the output is spendable: the refusal locked nothing.
    b.ap.online()
    b.ap.admit(assetId, tip, 0)
    const funded = await plan(module, assetId)
    expect(funded.inputs!.map(input => input.outpoint)).toEqual([outpoint])
  })

  it('a refused output is never selected', async () => {
    const module = attestedModule(b)
    const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
    const { outpoint, R } = await receive(b, module, deploy)
    await b.colorStore.markRefused(R, { code: 'ERR_CONFLICT', description: 'double spend' })
    const before = calls(b.ap)

    await expect(plan(module, assetId)).rejects.toThrow(/insufficient spendable balance/)
    await expect(
      plan(module, assetId, {
        inputs: [{ outpoint, inputDescription: 'Token' } as never],
        outputs: [await paymentOutput(assetId, 600n)]
      })
    ).rejects.toThrow(/not admitted and unspent/)
    expect(calls(b.ap)).toBe(before)
  })

  it('C17 list-mode trust loss excludes offline outputs from new spends', async () => {
    let identityKeys: string[] = [SIGNER]
    const module = attestedModule(b, {
      trustedIdentities: async () => ({ snapshot: `v${identityKeys.length}`, identityKeys }),
      extra: [listNoSendProfile()]
    })
    const { tx: deploy, assetId } = b.g.deploy(1000n, listNoSendPayload())
    const { outpoint } = await receive(b, module, deploy)
    expect(b.prompts.map(prompt => prompt.type)).toContain('color_receive_offline')
    const before = calls(b.ap)
    const handOver = { options: { noSend: true } }

    const trusted = await plan(module, assetId, handOver)
    expect(trusted.inputs!.map(input => input.outpoint)).toEqual([outpoint])
    expect(calls(b.ap)).toBe(before)

    identityKeys = [new PrivateKey(7777).toPublicKey().toString()]
    await expect(plan(module, assetId, handOver)).rejects.toThrow(/insufficient spendable balance/)
  })

  it('a broadcast attested action submits offChainValues and records a returned attestation as settled', async () => {
    const module = attestedModule(b, { extra: [dataProfile()] })
    const { tx: deploy, assetId } = b.g.deploy(1000n, dataPayload())
    const { tip, R } = await receive(b, module, deploy, { attestTip: true })
    expect(await module.isSettled(R)).toBe(true)
    b.ap.admit(assetId, tip, 0)

    const result = await send(b, module, assetId)

    const txid = result.txid!
    expect(b.ap.submissions.at(-1)).toEqual({
      topics: [colorTopic(assetId)],
      txid,
      offChainValues: DATA_BYTES
    })
    expect(b.ap.submitted.at(-1)!.beef).toEqual([...result.tx!])
    expect(await module.isSettled(txid)).toBe(true)
    const record = await b.colorStore.getTx(txid)
    expect(record).toMatchObject({
      assetId,
      atomicBEEF: toHex([...result.tx!]),
      offChainValues: toHex(DATA_BYTES),
      outputs: [1]
    })
    expect(record!.attestations).toHaveLength(1)
    expect(record!.attestations[0]).toMatchObject({ txid, signer: SIGNER })
    expect(record!.attestations[0].outputs).toContain(1)
    // The change is now a settled output: live spendability, nothing resubmitted.
    const submitted = b.ap.submitted.length
    const next = await plan(module, assetId, { outputs: [await paymentOutput(assetId, 100n)] })
    expect(next.inputs!.map(input => input.outpoint)).toEqual([`${txid}.1`])
    expect(b.ap.submitted).toHaveLength(submitted)
  })

  it('profile-free spending is unchanged', async () => {
    const provider = new FakeProvider()
    const lengths: number[] = []
    const submit = provider.submit
    provider.submit = async (...args: Parameters<FakeProvider['submit']>) => {
      lengths.push(args.length)
      return await submit(...args)
    }
    const module = createModule(b.wallet, provider)
    const { assetId } = await deployAsset(new FakeWallet(), provider, 1000n)
    const [held] = await holdTokens(b.wallet, provider, assetId, [600n])
    // Unlisted: the wallet's own copy is resubmitted before it is selected.
    provider.current.delete(`${held.id('hex')}.0`)

    const result = await send({ ...b, ap: b.ap }, module, assetId)

    expect(lengths.length).toBeGreaterThanOrEqual(2)
    expect(lengths.every(length => length === 2)).toBe(true)
    expect(provider.submissions.every(entry => !('offChainValues' in entry))).toBe(true)
    expect(provider.submissions.at(-1)?.txid).toBe(result.txid)
    expect(b.store.writes).toEqual([])
  })
})
