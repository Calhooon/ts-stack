import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  Beef,
  LockingScript,
  PrivateKey,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  type CreateActionArgs,
  type CreateActionResult,
  type SignActionResult
} from '@bsv/sdk'
import { hash160 } from '@bsv/sdk/primitives/Hash'
import { toArray } from '@bsv/sdk/primitives/utils'
import { OneColor } from '@bsv/templates'
import type { PermissionsModuleAction } from '@bsv/wallet-toolbox-client'
import { ATTESTED_PROFILE_ID, COLOR_OFFLINE_TAG } from '../attestation.js'
import { createAttestedProfile } from '../attested.js'
import { ColorPlan, type ColorPlan as Plan } from '../ColorPlan.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { ProfileDataError } from '../errors.js'
import { assetBasket, COLOR_KEY_ID, colorProtocolID, colorTopic, ISSUE } from '../identifiers.js'
import type { ProfileTxView, RequiredProfileHandler } from '../profiles.js'
import type { JsonValue } from '../strictJson.js'
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
  C0,
  FakeStore,
  graph,
  ISSUER_LIKE_ID,
  issuerLikePayload,
  issuerLikeProfile,
  TestModule,
  type GraphBuilder
} from './profileFixtures.js'

const APP = 'app.example'
const SIGNER = C0.SIGNER
const HANDOFF_LABEL = 'p nosend expiry seconds 30'

/** The hand-over test bench: a holder wallet, the default and routed providers, and the store. */
interface Bench {
  wallet: FakeWallet
  fallback: FakeProvider
  ap: AttestingProvider
  store: FakeStore
  g: GraphBuilder
  prompts: Array<Record<string, unknown>>
  /** Every createAction the underlying wallet saw, in order. */
  created: CreateActionArgs[]
}

function bench(): Bench {
  const wallet = new FakeWallet()
  const created: CreateActionArgs[] = []
  const createAction = wallet.createAction.bind(wallet)
  wallet.createAction = async (args: CreateActionArgs): Promise<CreateActionResult> => {
    created.push(args)
    return await createAction(args)
  }
  return {
    wallet,
    fallback: new FakeProvider(),
    ap: new AttestingProvider(),
    store: new FakeStore(),
    g: graph(),
    prompts: [],
    created
  }
}

/** A module with the attested profile and the issuer-like profile (or `issuer`) registered. */
function issuerModule(b: Bench, issuer?: RequiredProfileHandler): TestModule {
  const attested = createAttestedProfile()
  const handler = issuer ?? issuerLikeProfile({ K: SIGNER, provider: b.ap })
  return new TestModule({
    wallet: b.wallet.asWallet(),
    provider: b.fallback,
    requestTokenAccess: async (_app, message) => {
      b.prompts.push(JSON.parse(message) as Record<string, unknown>)
      return true
    },
    profiles: { [attested.id]: attested, [handler.id]: handler },
    store: b.store
  })
}

/**
 * An issuer-like asset whose deploy the default provider knows, and `amounts` held by the bench
 * wallet, admitted on the routed provider.
 */
async function issuerAsset(b: Bench, amounts: bigint[] = [1000n]): Promise<string> {
  const { tx, assetId } = b.g.deploy(2000n, issuerLikePayload(SIGNER))
  b.fallback.admit(assetId, tx, 0)
  await holdTokens(b.wallet, b.ap, assetId, amounts)
  return assetId
}

function planLabels(assetId: string, overrides: Partial<Plan> = {}): string[] {
  return ColorPlan.toLabels({
    version: 1,
    assets: [assetId],
    ownedOutputs: [],
    operations: [{ assetId, operation: 'transfer' }],
    inputPositions: [],
    changePositions: [],
    sighashTypes: [],
    ...overrides
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

async function plan(
  module: ColorPermissionModule,
  args: Partial<CreateActionArgs>
): Promise<CreateActionArgs> {
  return (
    await module.onRequest({
      method: 'createAction',
      args: {
        description: 'Send tokens',
        ...args,
        options: { randomizeOutputs: false, ...args.options }
      } as CreateActionArgs,
      originator: APP
    })
  ).args as CreateActionArgs
}

/** The manager's flow for a token send: module createAction, wallet, module signAction, wallet. */
async function send(
  b: Bench,
  module: ColorPermissionModule,
  args: Partial<CreateActionArgs>
): Promise<SignActionResult> {
  const funded = await plan(module, args)
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
  ).args as { reference: string; spends: Record<number, { unlockingScript: string }> }
  return (await module.onResponse(await b.wallet.signAction(signArgs), {
    method: 'signAction',
    originator: APP,
    action
  })) as SignActionResult
}

function selected(module: ColorPermissionModule): Set<string> {
  return (module as unknown as { selected: Set<string> }).selected
}

describe('plain-noSend hand-over planning', () => {
  let b: Bench

  beforeEach(() => {
    b = bench()
  })

  it('A.154 plan profileData naming an undeclared profile fails', async () => {
    const assetId = await issuerAsset(b)
    await expect(
      plan(issuerModule(b), {
        labels: planLabels(assetId, {
          profileData: { 'urn:example:color:undeclared': { [assetId]: { note: 'x' } } }
        }),
        outputs: [await paymentOutput(assetId, 600n)],
        options: { noSend: true }
      })
    ).rejects.toMatchObject({
      name: 'ProfileDataError',
      message: '[ProfileDataError] BRC-207: profile data names an undeclared profile'
    })
    expect(b.created).toEqual([])
  })

  it('plan profileData asset keys must be in plan.assets', async () => {
    const assetId = await issuerAsset(b)
    const module = issuerModule(b)
    const other = `${'ab'.repeat(32)}_0`
    for (const key of [other, ISSUE]) {
      await expect(
        plan(module, {
          labels: planLabels(assetId, { profileData: { [ISSUER_LIKE_ID]: { [key]: {} } } }),
          outputs: [await paymentOutput(assetId, 600n)],
          options: { noSend: true }
        })
      ).rejects.toMatchObject({ name: 'ProfileDataError' })
    }
    expect(b.created).toEqual([])
  })

  it('without profiles the 0.1.0 refusal stays', async () => {
    const provider = new FakeProvider()
    const module = createModule(b.wallet, provider)
    const { assetId } = await deployAsset(new FakeWallet(), provider, 1000n)
    await holdTokens(b.wallet, provider, assetId, [1000n])
    await expect(
      plan(module, {
        labels: planLabels(assetId, { profileData: { [ISSUER_LIKE_ID]: { [assetId]: {} } } }),
        outputs: [await paymentOutput(assetId, 600n)]
      })
    ).rejects.toThrow(/^BRC-207: plan\.profileData is not supported$/)
  })

  it('operations outside the handler list fail', async () => {
    const assetId = await issuerAsset(b)
    await expect(
      plan(issuerModule(b), {
        labels: planLabels(assetId, { operations: [{ assetId, operation: 'burn' }] }),
        outputs: [],
        options: { noSend: true }
      })
    ).rejects.toMatchObject({ name: 'ProfileParamsError' })
    expect(b.created).toEqual([])
  })

  it('plain-nosend requires noSend and refuses a BRC-177 label', async () => {
    const assetId = await issuerAsset(b)
    const module = issuerModule(b)
    const outputs = [await paymentOutput(assetId, 600n)]
    for (const args of [
      { labels: planLabels(assetId), outputs, options: { noSend: false } },
      { labels: planLabels(assetId), outputs },
      { labels: [HANDOFF_LABEL, ...planLabels(assetId)], outputs, options: { noSend: true } }
    ]) {
      const rejected = plan(module, args)
      await expect(rejected).rejects.toMatchObject({ name: 'ProfileParamsError' })
      await expect(rejected).rejects.toThrow(/plain noSend hand-over/)
    }
    expect(b.created).toEqual([])
    expect(selected(module).size).toBe(0)
  })

  it('B2: no split, change stays in the tx, tagged color_offline', async () => {
    const assetId = await issuerAsset(b)
    const held = [...b.wallet.outputs.keys()]
    const module = issuerModule(b)
    const recipient = await paymentOutput(assetId, 600n)
    const result = await send(b, module, {
      labels: planLabels(assetId),
      outputs: [recipient],
      options: { noSend: true }
    })

    expect(b.created).toHaveLength(1)
    const [args] = b.created
    expect(args.inputs!.map(input => input.outpoint)).toEqual(held)
    expect(args.outputs).toHaveLength(2)
    expect(args.outputs![0]).toEqual(recipient)
    expect(args.outputs![1]).toMatchObject({
      basket: assetBasket(assetId, 'value'),
      tags: [COLOR_OFFLINE_TAG]
    })
    expect(OneColor.decode(LockingScript.fromHex(args.outputs![1].lockingScript)).amount).toBe(400n)
    const tx = Transaction.fromAtomicBEEF(result.tx!)
    expect(b.wallet.outputs.get(`${tx.id('hex')}.1`)?.tags).toEqual([COLOR_OFFLINE_TAG])
    // Never submitted: not to the routed provider, not to the default one.
    expect(b.ap.submissions).toEqual([])
    expect(b.fallback.submissions).toEqual([])
  })

  it('strips caller color_* tags from owned outputs', async () => {
    const assetId = await issuerAsset(b)
    const module = issuerModule(b)
    const custody = {
      outputIndex: 1,
      assetId,
      derivationPrefix: 'cHJlZml4cHJlZml4cHJlZg==',
      derivationSuffix: 'c3VmZml4c3VmZml4c3VmZg==',
      senderIdentityKey: b.wallet.identityKey
    }
    const { publicKey } = await b.wallet.getPublicKey({
      protocolID: colorProtocolID(assetId, custody.derivationPrefix, custody.derivationSuffix),
      keyID: COLOR_KEY_ID,
      counterparty: b.wallet.identityKey,
      forSelf: true
    })
    const mine = {
      lockingScript: new OneColor().lock(assetId, 400n, hash160(toArray(publicKey, 'hex'))).toHex(),
      satoshis: 1,
      outputDescription: 'To myself',
      tags: ['color_offline', 'color_state_available', 'mine']
    }
    const funded = await plan(module, {
      labels: planLabels(assetId, { ownedOutputs: [custody] }),
      outputs: [await paymentOutput(assetId, 600n), mine],
      options: { noSend: true }
    })
    expect(funded.outputs![1].tags).toEqual(['mine'])
  })

  it('a plain-nosend action cannot mix with a baseline asset', async () => {
    const assetId = await issuerAsset(b)
    const plain = (await deployAsset(new FakeWallet(), b.fallback, 1000n)).assetId
    await holdTokens(b.wallet, b.fallback, plain, [100n])
    const module = issuerModule(b)
    await expect(
      plan(module, {
        labels: planLabels(assetId, {
          assets: [assetId, plain],
          operations: [
            { assetId, operation: 'transfer' },
            { assetId: plain, operation: 'transfer' }
          ]
        }),
        outputs: [await paymentOutput(assetId, 600n), await paymentOutput(plain, 100n)],
        options: { noSend: true }
      })
    ).rejects.toMatchObject({ name: 'ProfileParamsError' })
    expect(b.created).toEqual([])
    expect(selected(module).size).toBe(0)
  })

  it('A.157 checkPlanData runs at createAction with the leaf and the view', async () => {
    const assetId = await issuerAsset(b)
    const calls: Array<{ leaf: JsonValue | undefined; view: ProfileTxView }> = []
    const leaf = { note: 'x', n: 1 }
    const spying: RequiredProfileHandler = {
      ...issuerLikeProfile({ K: SIGNER, provider: b.ap }),
      checkPlanData: async (ctx, value, view) => {
        expect(ctx.assetId).toBe(assetId)
        expect(ctx.profileId).toBe(ISSUER_LIKE_ID)
        calls.push({ leaf: value, view })
      }
    }
    const recipient = await paymentOutput(assetId, 600n)
    await plan(issuerModule(b, spying), {
      labels: planLabels(assetId, { profileData: { [ISSUER_LIKE_ID]: { [assetId]: leaf } } }),
      outputs: [recipient],
      options: { noSend: true }
    })
    expect(calls).toHaveLength(1)
    const [{ leaf: seen, view }] = calls
    expect(seen).toEqual(leaf)
    expect(view.planLeaf).toEqual(leaf)
    expect(view.tx).toBeUndefined()
    expect(view.assetId).toBe(assetId)
    expect(view.inputs).toEqual([
      expect.objectContaining({ inputIndex: 0, role: 'value', amount: 1000n })
    ])
    expect(view.inputs[0].custody).toMatchObject({ assetId })
    expect(view.outputs.map(output => [output.outputIndex, output.amount])).toEqual([
      [0, 600n],
      [1, 400n]
    ])
    expect(view.outputs[0].custody).toBeUndefined()
    expect(view.outputs[1].custody).toMatchObject({
      assetId,
      senderIdentityKey: b.wallet.identityKey
    })

    // Absent leaf: the hook still runs, with undefined.
    calls.length = 0
    await plan(issuerModule(b, spying), {
      labels: planLabels(assetId),
      outputs: [recipient],
      options: { noSend: true }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].leaf).toBeUndefined()
    expect(calls[0].view.planLeaf).toBeUndefined()

    // A refusing handler: createAction rejects and no reservation remains.
    const refusing: RequiredProfileHandler = {
      ...spying,
      checkPlanData: async () => {
        throw new ProfileDataError('BRC-207: the issuer leaf is invalid')
      }
    }
    const module = issuerModule(b, refusing)
    await expect(
      plan(module, {
        labels: planLabels(assetId, { profileData: { [ISSUER_LIKE_ID]: { [assetId]: leaf } } }),
        outputs: [recipient],
        options: { noSend: true }
      })
    ).rejects.toMatchObject({ name: 'ProfileDataError' })
    expect(selected(module).size).toBe(0)
  })

  it('an attested plan leaf resolves a never-seen asset from its declarationTx', async () => {
    const { tx: deploy, assetId } = b.g.deploy(2000n, issuerLikePayload(SIGNER))
    await holdTokens(b.wallet, b.ap, assetId, [1000n])
    const leaf = { declarationTx: deploy.toHex(), transactions: [], attestations: [] }
    const funded = await plan(issuerModule(b), {
      labels: planLabels(assetId, { profileData: { [ATTESTED_PROFILE_ID]: { [assetId]: leaf } } }),
      outputs: [await paymentOutput(assetId, 600n)],
      options: { noSend: true }
    })
    expect(funded.inputs).toHaveLength(1)
    // No provider was asked for the deploy.
    expect(b.fallback.calls.admission).toBe(0)
    expect(b.ap.calls.admission).toBe(0)
    // A leaf naming another deploy fails before anything is selected.
    const other = b.g.deploy(5n, issuerLikePayload(SIGNER)).tx
    await expect(
      plan(issuerModule(b), {
        labels: planLabels(assetId, {
          profileData: {
            [ATTESTED_PROFILE_ID]: { [assetId]: { ...leaf, declarationTx: other.toHex() } }
          }
        }),
        outputs: [await paymentOutput(assetId, 600n)],
        options: { noSend: true }
      })
    ).rejects.toMatchObject({ name: 'AttestationEvidenceError' })
  })

  it('the plan view carries a foreign token input without custody', async () => {
    const assetId = await issuerAsset(b)
    const pool = await tokenPayment(new FakeWallet(), new FakeWallet(), assetId, 300n)
    b.ap.admit(assetId, pool.tx, 0)
    const inputBEEF = new Beef()
    inputBEEF.mergeTransaction(pool.tx)
    const outpoint = `${pool.tx.id('hex')}.0`
    const views: ProfileTxView[] = []
    const spying: RequiredProfileHandler = {
      ...issuerLikeProfile({ K: SIGNER, provider: b.ap }),
      checkPlanData: async (_ctx, _leaf, view) => {
        views.push(view)
      }
    }
    await plan(issuerModule(b, spying), {
      labels: planLabels(assetId),
      inputBEEF: inputBEEF.toBinary(),
      inputs: [{ outpoint, unlockingScriptLength: 1, inputDescription: 'Pool' }],
      outputs: [await paymentOutput(assetId, 600n)],
      options: { noSend: true }
    })
    expect(views).toHaveLength(1)
    expect(views[0].inputs.map(input => [input.inputIndex, input.amount])).toEqual([
      [0, 300n],
      [1, 1000n]
    ])
    expect(views[0].inputs[0]).toEqual({ inputIndex: 0, outpoint, role: 'value', amount: 300n })
    expect(views[0].inputs[1].custody).toMatchObject({ assetId })
    expect(views[0].outputs.map(output => [output.outputIndex, output.amount])).toEqual([
      [0, 600n],
      [1, 700n]
    ])
  })

  it('a module-built deploy with a non-empty req fails explicitly', async () => {
    const module = issuerModule(b)
    const key = PrivateKey.fromRandom()
    await expect(
      plan(module, {
        labels: planLabels(ISSUE, { operations: [{ assetId: ISSUE, operation: 'deploy-fixed' }] }),
        outputs: [
          {
            lockingScript: new OneColor()
              .lock(null, 1000n, key.toPublicKey().toHash() as number[], issuerLikePayload(SIGNER))
              .toHex(),
            satoshis: 1,
            outputDescription: 'Deploy'
          }
        ]
      })
    ).rejects.toMatchObject({
      name: 'ProfileParamsError',
      message: expect.stringMatching(/built outside this module/)
    })
  })

  it('createSignature refuses assets whose profiles define sendPolicy or submissionData', async () => {
    const assetId = await issuerAsset(b, [])
    const sender = new FakeWallet()
    const payment = await tokenPayment(sender, b.wallet, assetId, 40n)
    b.ap.admit(assetId, payment.tx, 0)
    const custody = JSON.parse(payment.customInstructions)
    const tx = new Transaction()
    tx.addInput({
      sourceTransaction: payment.tx,
      sourceOutputIndex: 0,
      unlockingScript: new UnlockingScript()
    })
    tx.addOutput({
      lockingScript: LockingScript.fromHex((await paymentOutput(assetId, 40n)).lockingScript),
      satoshis: 1
    })
    const args = {
      protocolID: colorProtocolID(assetId, custody.derivationPrefix, custody.derivationSuffix),
      keyID: COLOR_KEY_ID,
      counterparty: sender.identityKey,
      data: toArray(
        JSON.stringify({
          version: 1,
          tx: Array.from(tx.toAtomicBEEF()),
          inputIndex: 0,
          sighashType: TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID,
          ownedOutputs: []
        }),
        'utf8'
      )
    }
    const next = jest.fn(async (forwarded: object) => forwarded)
    const { sendPolicy: _sendPolicy, ...withoutPolicy } = issuerLikeProfile({
      K: SIGNER,
      provider: b.ap
    })
    for (const handler of [undefined, withoutPolicy]) {
      await expect(
        issuerModule(b, handler).handleRequest(
          { method: 'createSignature', args, originator: APP },
          next
        )
      ).rejects.toMatchObject({ name: 'ProfileParamsError' })
    }
    expect(next).not.toHaveBeenCalled()
    expect(b.prompts).toEqual([])
  })

  it('the BRC-177 handoff path is unchanged for profile-free assets', async () => {
    const plain = (await deployAsset(new FakeWallet(), b.fallback, 1000n)).assetId
    await holdTokens(b.wallet, b.fallback, plain, [300n])
    const result = await send(b, issuerModule(b), {
      labels: [HANDOFF_LABEL, ...planLabels(plain)],
      outputs: [await paymentOutput(plain, 100n)],
      options: { noSend: true }
    })
    const handoff = Transaction.fromAtomicBEEF(result.tx!)
    const split = handoff.inputs[0].sourceTransaction!
    expect(b.created).toHaveLength(2)
    expect(handoff.inputs).toHaveLength(1)
    expect(handoff.outputs).toHaveLength(1)
    expect(split.outputs.map(output => OneColor.decode(output.lockingScript).amount)).toEqual([
      100n,
      200n
    ])
    expect(b.fallback.submissions).toEqual([{ topics: [colorTopic(plain)], txid: split.id('hex') }])
    expect(b.prompts.map(prompt => [prompt.type, prompt.handoff])).toEqual([['color_send', true]])
  })

  it('a plain-nosend color_send carries handoff true', async () => {
    const assetId = await issuerAsset(b)
    await send(b, issuerModule(b), {
      labels: planLabels(assetId),
      outputs: [await paymentOutput(assetId, 600n)],
      options: { noSend: true }
    })
    expect(b.prompts).toHaveLength(1)
    expect(b.prompts[0]).toMatchObject({ type: 'color_send', handoff: true, seekPermission: true })
    expect(Object.keys(b.prompts[0]).slice(0, 3)).toEqual(['type', 'handoff', 'seekPermission'])
  })

  it('forwards the plan labels to the underlying createAction unchanged', async () => {
    const assetId = await issuerAsset(b)
    const labels = planLabels(assetId, {
      profileData: { [ISSUER_LIKE_ID]: { [assetId]: { note: 'carried' } } }
    })
    await send(b, issuerModule(b), {
      labels: ['app label', ...labels],
      outputs: [await paymentOutput(assetId, 600n)],
      options: { noSend: true }
    })
    expect(b.created).toHaveLength(1)
    const forwarded = b.created[0].labels ?? []
    for (const label of labels) expect(forwarded).toContain(label)
    expect(forwarded.filter(label => label.startsWith('p color plan '))).toEqual(labels)
  })
})
