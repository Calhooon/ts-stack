import { beforeEach, describe, expect, it } from '@jest/globals'
import {
  Beef,
  PrivateKey,
  Transaction,
  type CreateActionArgs,
  type CreateActionResult,
  type InternalizeActionArgs,
  type ListOutputsResult,
  type SignActionResult,
  type STEAK
} from '@bsv/sdk'
import { toArray } from '@bsv/sdk/primitives/utils'
import type { PermissionsModuleAction } from '@bsv/wallet-toolbox-client'
import { createAttestedProfile } from '../attested.js'
import { ColorPlan } from '../ColorPlan.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { ColorProviderError } from '../errors.js'
import { colorTopic } from '../identifiers.js'
import type { ColorSettleReport, ColorSettleResult } from '../profiles.js'
import type { ColorSettler } from '../settle.js'
import { ColorStore } from '../store.js'
import { createModule, FakeProvider, FakeWallet, tokenPayment } from './fixtures.js'
import {
  AttestingProvider,
  attestedAsset,
  attestedReceipt,
  C0,
  FakeStore,
  graph,
  highS,
  issuerLikePayload,
  issuerLikeProfile,
  type GraphBuilder
} from './profileFixtures.js'

const APP = 'app.example'
const SIGNER = C0.SIGNER
const K = new PrivateKey(C0.PRIV)
const next = async (args: unknown): Promise<unknown> => args

interface Bench {
  wallet: FakeWallet
  /** The routed (and, for attested-only assets, default) provider: signs with K. */
  ap: AttestingProvider
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

/** A module with only the attested profile registered; `provider` is its default provider. */
function attestedModule(b: Bench, provider: FakeProvider = b.ap): ColorPermissionModule {
  const attested = createAttestedProfile()
  return new ColorPermissionModule({
    wallet: b.wallet.asWallet(),
    provider,
    requestTokenAccess: approve(b),
    profiles: { [attested.id]: attested },
    store: b.store
  })
}

/** A module with the attested and issuer-like profiles, issuer-like assets routed to `provider`. */
function issuerModule(b: Bench, provider: FakeProvider = b.ap): ColorPermissionModule {
  const attested = createAttestedProfile()
  const issuer = issuerLikeProfile({ K: SIGNER, provider })
  return new ColorPermissionModule({
    wallet: b.wallet.asWallet(),
    provider: new FakeProvider(),
    requestTokenAccess: approve(b),
    profiles: { [attested.id]: attested, [issuer.id]: issuer },
    store: b.store
  })
}

const txidOf = (submission: { beef: number[] }): string =>
  Transaction.fromAtomicBEEF(submission.beef).id('hex')

/**
 * An attested-only asset received fully offline by `module` with consent: deploy → anchor
 * (attested by K) → `unattested` hops → tip R. The wallet holds R unless `hold` is false.
 */
async function offlineReceipt(
  b: Bench,
  module: ColorPermissionModule,
  options: { unattested?: number; hold?: boolean } = {}
) {
  const { tx: deploy, assetId } = attestedAsset(b.g, SIGNER)
  const receipt = await attestedReceipt({
    g: b.g,
    deploy,
    recipient: b.wallet,
    signers: [K],
    unattested: options.unattested ?? 0,
    tipOffChainValues: 'e0'
  })
  const before = b.ap.submitted.length
  const { args } = await module.onRequest({
    method: 'internalizeAction',
    args: receipt.args,
    originator: APP
  })
  expect(b.ap.submitted).toHaveLength(before)
  const forwarded = args as InternalizeActionArgs
  if (options.hold !== false) await b.wallet.internalizeAction(forwarded)
  return { ...receipt, assetId, deploy, R: receipt.tip.id('hex'), forwarded }
}

/** The `p color assets` listing with tags, keyed by outpoint. */
async function views(
  module: ColorPermissionModule
): Promise<Map<string, { spendable: boolean; tags?: string[] }>> {
  const result = (await module.handleRequest(
    {
      method: 'listOutputs',
      originator: APP,
      args: { basket: 'p color assets', includeTags: true }
    },
    next
  )) as ListOutputsResult
  return new Map(result.outputs.map(output => [output.outpoint, output]))
}

const admitted = (txid: string, assetId: string, outputs: number[] = [0]): ColorSettleResult => ({
  txid,
  assetId,
  status: 'admitted',
  outputs
})

const keys = (b: Bench, kind: string): string[] =>
  [...b.store.entries.keys()].filter(key => key.startsWith(`color.v1.${kind}.`))

describe('settle', () => {
  let b: Bench

  beforeEach(() => {
    b = bench()
  })

  it('submits an offline receipt chain parents first with exact bytes and offChainValues', async () => {
    const module = attestedModule(b)
    const r = await offlineReceipt(b, module, { unattested: 1 })
    const { assetId, R } = r
    const A = r.ancestors[0].id('hex')
    expect((await views(module)).get(`${R}.0`)?.tags).toContain('color_offline')
    const report = await module.settle()
    expect(b.ap.submitted.map(txidOf)).toEqual([A, R])
    expect(b.ap.submitted[0]).toEqual({
      topics: [colorTopic(assetId)],
      beef: Beef.fromBinary(r.args.tx).toBinaryAtomic(A),
      offChainValues: []
    })
    expect(b.ap.submitted[1]).toEqual({
      topics: [colorTopic(assetId)],
      beef: [...r.args.tx],
      offChainValues: [0xe0]
    })
    expect(report).toEqual({ results: [admitted(A, assetId), admitted(R, assetId)] })
    // C54: the settled record clears the offline view tag; the receipt is now credited.
    expect((await views(module)).get(`${R}.0`)?.tags).toEqual(['color_state_available'])
    expect(await b.colorStore.settled(R)).toEqual({ outputs: [0], signer: SIGNER })
    expect((await b.colorStore.getTx(R))?.state).toBe('credited')
    expect((await b.colorStore.getTx(R))?.attestations).toHaveLength(1)
    // Nothing is left to do: a later settle submits nothing and reports nothing.
    await expect(module.settle()).resolves.toEqual({ results: [] })
    expect(b.ap.submitted).toHaveLength(2)
  })

  it('settle submits byte-identical AtomicBEEF to what internalize received, for an unmined attested anchor', async () => {
    const module = attestedModule(b)
    const r = await offlineReceipt(b, module, { unattested: 1 })
    expect(r.anchor.merklePath).toBeUndefined()
    const A = r.ancestors[0].id('hex')
    await module.settle()
    expect(b.ap.submitted[0].beef).toEqual(Beef.fromBinary(r.args.tx).toBinaryAtomic(A))
    expect(b.ap.submitted[1].beef).toEqual([...r.args.tx])
    // The ancestor's bytes carry the unmined anchor as its source, not a rebuilt raw tx.
    const sent = Transaction.fromAtomicBEEF(b.ap.submitted[0].beef)
    expect(sent.inputs[0].sourceTransaction?.id('hex')).toBe(r.anchor.id('hex'))
  })

  it('a failed parent stops its descendants', async () => {
    const module = attestedModule(b)
    const { assetId, R, ancestors } = await offlineReceipt(b, module, { unattested: 1 })
    const A = ancestors[0].id('hex')
    b.ap.refuse('ERR_CONSERVATION', false)
    const report = await module.settle()
    expect(report.results).toEqual([
      expect.objectContaining({ txid: A, assetId, status: 'refused', code: 'ERR_CONSERVATION' }),
      expect.objectContaining({ txid: R, assetId, status: 'refused', code: 'ERR_PARENT_REFUSED' })
    ])
    expect(b.ap.submitted.map(txidOf)).toEqual([A])
    expect((await b.colorStore.refused(A))?.code).toBe('ERR_CONSERVATION')
    expect((await b.colorStore.refused(R))?.code).toBe('ERR_PARENT_REFUSED')
    expect((await views(module)).get(`${R}.0`)?.tags).toContain('color_state_restricted')
    // A refused transaction is final: a later settle submits nothing.
    b.ap.online()
    await expect(module.settle()).resolves.toEqual({ results: [] })
    expect(b.ap.submitted).toHaveLength(1)
  })

  it('a transport failure reports retry and keeps color_offline', async () => {
    const module = attestedModule(b)
    const { assetId, R, ancestors } = await offlineReceipt(b, module, { unattested: 1 })
    const A = ancestors[0].id('hex')
    b.ap.failTransport()
    const report = await module.settle()
    expect(report.results).toEqual([
      expect.objectContaining({ txid: A, assetId, status: 'retry', code: 'ERR_UNAVAILABLE' }),
      expect.objectContaining({ txid: R, assetId, status: 'retry', code: 'ERR_UNAVAILABLE' })
    ])
    expect(b.ap.submitted.map(txidOf)).toEqual([A])
    expect(keys(b, 'settled')).toEqual([])
    expect(keys(b, 'refused')).toEqual([])
    expect((await views(module)).get(`${R}.0`)?.tags).toContain('color_offline')
  })

  it('a retryable typed verdict reports retry, never refused', async () => {
    const module = attestedModule(b)
    const { assetId, R } = await offlineReceipt(b, module)
    b.ap.refuse('ERR_PAUSED', true)
    const report = await module.settle()
    expect(report.results).toEqual([
      expect.objectContaining({ txid: R, assetId, status: 'retry', code: 'ERR_PAUSED' })
    ])
    expect(keys(b, 'refused')).toEqual([])
    expect(keys(b, 'settled')).toEqual([])
  })

  it('an admitted response without an attestation reports retry', async () => {
    const plain = new FakeProvider()
    const module = attestedModule(b, plain)
    const { assetId, R } = await offlineReceipt(b, module)
    const report = await module.settle()
    expect(plain.submissions.map(submission => submission.txid)).toEqual([R])
    expect(report.results).toEqual([
      expect.objectContaining({ txid: R, assetId, status: 'retry', code: 'ERR_NO_ATTESTATION' })
    ])
    expect(keys(b, 'settled')).toEqual([])
    expect(keys(b, 'refused')).toEqual([])
  })

  it('C51 retrying after a lost response is idempotent', async () => {
    const module = attestedModule(b)
    const { assetId, R } = await offlineReceipt(b, module)
    const submit = b.ap.submit
    let lose = true
    b.ap.submit = async (topics, beef, offChainValues) => {
      const steak = await submit(topics, beef, offChainValues)
      if (lose) {
        lose = false
        throw new ColorProviderError('ERR_UNAVAILABLE', true, true, 'response lost')
      }
      return steak
    }
    const first = await module.settle()
    expect(first.results).toEqual([
      expect.objectContaining({ txid: R, status: 'retry', code: 'ERR_UNAVAILABLE' })
    ])
    expect(await module.isSettled(R)).toBe(false)
    const second = await module.settle()
    expect(second.results).toEqual([admitted(R, assetId)])
    expect(b.ap.submitted).toHaveLength(2)
    expect(b.ap.submitted[1]).toEqual(b.ap.submitted[0])
  })

  it('assetIds filter limits the run', async () => {
    const module = attestedModule(b)
    const one = await offlineReceipt(b, module)
    const two = await offlineReceipt(b, module)
    const report = await module.settle({ assetIds: [one.assetId] })
    expect(report.results).toEqual([admitted(one.R, one.assetId)])
    expect(b.ap.submitted.map(txidOf)).toEqual([one.R])
    const rest = await module.settle()
    expect(rest.results).toEqual([admitted(two.R, two.assetId)])
    await expect(module.settle({ assetIds: ['bad'] })).rejects.toThrow(TypeError)
    await expect(module.settle({ txids: ['AB'.repeat(32)] })).rejects.toThrow(TypeError)
  })

  it('without profiles settle returns no results', async () => {
    const w = new FakeWallet()
    const p = new FakeProvider()
    const module = createModule(w, p)
    expect(await module.settle()).toEqual({ results: [] })
    expect(await module.isSettled('00'.repeat(32))).toBe(false)
    module.dispose()
    expect(p.calls).toEqual({ spendability: 0, admission: 0, submit: 0 })
  })

  it('verifies the attestation with the descriptor key and accepts high-S', async () => {
    // A statement by any other key never settles, even though it verifies.
    const stranger = new AttestingProvider(new PrivateKey(7777))
    const strangers = attestedModule(b, stranger)
    const first = await offlineReceipt(b, strangers)
    const refusedReport = await strangers.settle()
    expect(refusedReport.results).toEqual([
      expect.objectContaining({ txid: first.R, status: 'retry', code: 'ERR_ATTESTATION' })
    ])
    expect(await strangers.isSettled(first.R)).toBe(false)

    // K's high-S statement is valid under BSV Chronicle and is stored as received.
    b.ap.highS = true
    const module = attestedModule(b)
    const second = await offlineReceipt(b, module)
    const report = await module.settle({ assetIds: [second.assetId] })
    expect(report.results).toEqual([admitted(second.R, second.assetId)])
    const [att] = (await b.colorStore.getTx(second.R))!.attestations
    expect(att.signature).toBe(highS(att.signature))
    expect(att.signer).toBe(SIGNER)
  })

  it('staged receipt the wallet does not hold is never submitted', async () => {
    const module = attestedModule(b)
    const { assetId, R, forwarded } = await offlineReceipt(b, module, { hold: false })
    expect((await b.colorStore.getTx(R))?.state).toBe('staged')
    await expect(module.settle()).resolves.toEqual({ results: [] })
    expect(b.ap.submitted).toEqual([])
    // Naming it does not submit it either.
    const named = await module.settle({ txids: [R] })
    expect(named.results).toEqual([
      expect.objectContaining({ txid: R, assetId, status: 'retry', code: 'ERR_NOT_HELD' })
    ])
    expect(b.ap.submitted).toEqual([])
    expect(keys(b, 'intent')).toEqual([])
    expect((await b.colorStore.getTx(R))?.state).toBe('staged')

    await b.wallet.internalizeAction(forwarded)
    const report = await module.settle()
    expect(report.results).toEqual([admitted(R, assetId)])
    expect((await b.colorStore.getTx(R))?.state).toBe('credited')
    expect(b.ap.submitted.map(txidOf)).toEqual([R])
  })

  it('concurrent settle submits each txid once', async () => {
    const module = attestedModule(b)
    const { assetId, R } = await offlineReceipt(b, module)
    const [a, c] = await Promise.all([module.settle(), module.settle()])
    expect(b.ap.submitted.filter(s => txidOf(s) === R)).toHaveLength(1)
    expect([...a.results, ...c.results].every(r => r.status === 'admitted')).toBe(true)
    // The second call reports the first call's admission from the settled record.
    expect(a.results).toEqual([admitted(R, assetId)])
    expect(c.results).toEqual([admitted(R, assetId)])
    // A later, non-overlapping call has nothing to report.
    await expect(module.settle()).resolves.toEqual({ results: [] })
    expect(b.ap.submitted).toHaveLength(1)
  })

  it('a failing run does not poison the next one', async () => {
    const module = attestedModule(b)
    const { assetId, R } = await offlineReceipt(b, module)
    const keysOf = b.store.keys
    let failures = 1
    b.store.keys = async prefix => {
      if (failures > 0) {
        failures--
        throw new Error('store offline')
      }
      return await keysOf(prefix)
    }
    const [failing, following] = await Promise.allSettled([module.settle(), module.settle()])
    expect(failing).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'store offline' })
    })
    expect(following).toEqual({ status: 'fulfilled', value: { results: [admitted(R, assetId)] } })
  })

  it('isSettled reflects the settled record and dispose stops new submits', async () => {
    const module = attestedModule(b)
    const { R } = await offlineReceipt(b, module)
    expect(await module.isSettled(R)).toBe(false)
    expect(await module.isSettled('not a txid')).toBe(false)
    await module.settle()
    expect(await module.isSettled(R)).toBe(true)
    b.store.clear()
    expect(await module.isSettled(R)).toBe(false)

    const other = attestedModule(b)
    await offlineReceipt(b, other)
    other.dispose()
    other.dispose()
    const calls = { ...b.ap.calls }
    const submitted = b.ap.submitted.length
    const sentWith = b.wallet.sentWith.length
    await expect(other.settle()).resolves.toEqual({ results: [] })
    expect(b.ap.calls).toEqual(calls)
    expect(b.ap.submitted).toHaveLength(submitted)
    expect(b.wallet.sentWith).toHaveLength(sentWith)
  })

  it('an in-flight run finishes its current submit and resolves after dispose', async () => {
    const module = attestedModule(b)
    const { assetId, ancestors } = await offlineReceipt(b, module, { unattested: 1 })
    const A = ancestors[0].id('hex')
    const submit = b.ap.submit
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let entered!: () => void
    const inSubmit = new Promise<void>(resolve => {
      entered = resolve
    })
    b.ap.submit = async (topics, beef, offChainValues) => {
      entered()
      await gate
      return await submit(topics, beef, offChainValues)
    }
    const running = module.settle()
    await inSubmit
    module.dispose()
    release()
    const report = await running
    expect(report.results).toEqual([admitted(A, assetId)])
    expect(b.ap.submitted.map(txidOf)).toEqual([A])
  })
})

describe('settleTx', () => {
  let b: Bench

  beforeEach(() => {
    b = bench()
  })

  const settlerOf = (module: ColorPermissionModule): ColorSettler =>
    (module as unknown as { settler: ColorSettler }).settler

  it('latches one submit per txid and resubmits a settled tx on request', async () => {
    const module = attestedModule(b)
    const { assetId, R } = await offlineReceipt(b, module)
    const settler = settlerOf(module)
    const [one, two] = await Promise.all([settler.settleTx(R), settler.settleTx(R)])
    expect(one).toEqual(admitted(R, assetId))
    expect(two).toEqual(one)
    expect(b.ap.submitted.map(txidOf)).toEqual([R])
    // Task 15 resubmits a settled output the overlay no longer lists, with the same bytes.
    await expect(settler.settleTx(R)).resolves.toEqual(admitted(R, assetId))
    expect(b.ap.submitted).toHaveLength(2)
    expect(b.ap.submitted[1]).toEqual(b.ap.submitted[0])
    await expect(settler.settleTx('XY')).rejects.toThrow(TypeError)
    await expect(settler.settleTx('00'.repeat(32))).resolves.toMatchObject({
      status: 'retry',
      code: 'ERR_EVIDENCE'
    })
    module.dispose()
    await expect(settler.settleTx(R)).resolves.toMatchObject({ code: 'ERR_DISPOSED' })
    expect(b.ap.submitted).toHaveLength(2)
  })

  it('stored bytes that do not parse are never submitted', async () => {
    const module = attestedModule(b)
    const { R } = await offlineReceipt(b, module)
    const record = (await b.colorStore.getTx(R))!
    // A torn write behind an intact AtomicBEEF header.
    await b.colorStore.putTx(R, { ...record, atomicBEEF: record.atomicBEEF.slice(0, 80) + 'ff' })
    await expect(settlerOf(module).settleTx(R)).resolves.toMatchObject({
      status: 'retry',
      code: 'ERR_EVIDENCE'
    })
    expect(b.ap.submitted).toEqual([])
  })

  it('a malformed STEAK attestation reports retry', async () => {
    const plain = new FakeProvider()
    const submit = plain.submit
    plain.submit = async (topics, beef, offChainValues) => {
      const steak = await submit(topics, beef, offChainValues)
      return Object.fromEntries(
        Object.entries(steak).map(([topic, entry]) => [
          topic,
          { ...entry, admissionSignature: 'zz', admissionIdentityKey: SIGNER }
        ])
      )
    }
    const module = attestedModule(b, plain)
    const { R } = await offlineReceipt(b, module)
    const report = await module.settle()
    expect(report.results).toEqual([
      expect.objectContaining({ txid: R, status: 'retry', code: 'ERR_ATTESTATION' })
    ])
  })

  it('drops an intent without a record and rejects a malformed request', async () => {
    const module = attestedModule(b)
    await b.colorStore.addIntent('11'.repeat(32))
    await expect(module.settle()).resolves.toEqual({ results: [] })
    expect(keys(b, 'intent')).toEqual([])
    await expect(module.settle('all' as never)).rejects.toThrow(TypeError)
    await expect(module.settle({ assetIds: 'x' } as never)).rejects.toThrow(TypeError)
  })
})

/* ------------------------------------------------------------------------
 * Own plain-noSend hand-overs
 * ------------------------------------------------------------------------ */

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

/** The manager's flow for a token send: module createAction, wallet, module signAction, wallet. */
async function send(
  b: Bench,
  module: ColorPermissionModule,
  args: Partial<CreateActionArgs>
): Promise<SignActionResult> {
  const funded = (
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

describe('settle own hand-overs', () => {
  let b: Bench
  let module: ColorPermissionModule

  beforeEach(() => {
    b = bench()
    module = issuerModule(b)
  })

  /**
   * An issuer-like asset received offline (the routed overlay unreachable during receipt), then
   * handed over: 600 to a recipient, change 400 at output 1 kept `color_offline`. The settle
   * module's routed provider is `b.ap`, which lists the receipt as spendable for the send.
   */
  async function handover() {
    const { tx: deploy, assetId } = b.g.deploy(2000n, issuerLikePayload(SIGNER))
    const receipt = await attestedReceipt({
      g: b.g,
      deploy,
      recipient: b.wallet,
      signers: [K],
      amount: 1000n,
      tipOffChainValues: 'e0'
    })
    const unreachable = new AttestingProvider()
    unreachable.failTransport()
    const { args } = await issuerModule(b, unreachable).onRequest({
      method: 'internalizeAction',
      args: receipt.args,
      originator: APP
    })
    await b.wallet.internalizeAction(args as InternalizeActionArgs)
    b.ap.admit(assetId, receipt.tip, 0)
    const labels = planLabels(assetId)
    const result = await send(b, module, {
      labels,
      outputs: [await paymentOutput(assetId, 600n)],
      options: { noSend: true }
    })
    const H = result.txid!
    const tx = Transaction.fromAtomicBEEF(result.tx!)
    const reference = [...b.wallet.actions.values()].find(action => action.txid === H)!.reference
    return { assetId, R: receipt.tip.id('hex'), H, tx, labels, reference, result }
  }

  /** The recipient settled the hand-over: the overlay admitted its token outputs. */
  function recipientSettles(assetId: string, tx: Transaction): void {
    b.ap.admit(assetId, tx, 0)
    b.ap.admit(assetId, tx, 1)
  }

  const submittedTxids = (): string[] => b.ap.submitted.map(txidOf)
  const resultFor = (report: ColorSettleReport, txid: string): ColorSettleResult | undefined =>
    report.results.find(result => result.txid === txid)

  it('D27 a bare settle never submits an own hand-over the overlay has not admitted', async () => {
    const { assetId, R, H, tx } = await handover()
    const first = await module.settle()
    // The receipt is the recipient's duty and settles; the hand-over is not submitted.
    expect(first.results).toEqual([admitted(R, assetId)])
    expect(submittedTxids()).toEqual([R])
    expect(resultFor(first, H)).toBeUndefined()
    expect(b.ap.calls.admission).toBeGreaterThan(0)
    expect(b.wallet.sentWith).toEqual([])

    recipientSettles(assetId, tx)
    const second = await module.settle()
    expect(second.results).toEqual([admitted(H, assetId, [0, 1])])
    expect(submittedTxids()).toEqual([R, H])
    expect(b.ap.submitted[1]).toEqual({
      topics: [colorTopic(assetId)],
      beef: toArray((await b.colorStore.getTx(H))!.atomicBEEF, 'hex'),
      offChainValues: toArray('null', 'utf8')
    })
    expect(await module.isSettled(H)).toBe(true)
    expect(b.wallet.sentWith).toEqual([[H]])
    expect((await views(module)).get(`${H}.1`)?.tags).toEqual(['color_state_available'])
  })

  it('named txids submit an own hand-over and persist the intent', async () => {
    const { assetId, R, H } = await handover()
    b.ap.failTransport()
    const named = await module.settle({ txids: [H] })
    expect(resultFor(named, H)).toEqual(
      expect.objectContaining({ txid: H, assetId, status: 'retry', code: 'ERR_UNAVAILABLE' })
    )
    expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(true)
    expect(b.wallet.sentWith).toEqual([])

    b.ap.online()
    const report = await module.settle()
    expect(report.results).toEqual([admitted(R, assetId), admitted(H, assetId, [0, 1])])
    expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(false)
    expect(b.wallet.sentWith).toEqual([[H]])
    // A named settle of a settled hand-over reports it without submitting again.
    const again = await module.settle({ txids: [H] })
    expect(again.results).toEqual([admitted(H, assetId, [0, 1])])
    // H was submitted once: in the failed named run its parent R failed first, so H waited.
    expect(submittedTxids().filter(txid => txid === H)).toHaveLength(1)
  })

  it('D24 sendWith "already broadcast" counts as success; other errors leave an unsent marker that the next settle retries', async () => {
    const one = await handover()
    recipientSettles(one.assetId, one.tx)
    b.wallet.sendWithError = new Error('Transaction already broadcast')
    await module.settle()
    expect(b.wallet.sentWith).toEqual([[one.H]])
    expect(keys(b, 'unsent')).toEqual([])

    const two = await handover()
    recipientSettles(two.assetId, two.tx)
    b.wallet.sendWithError = new Error('broadcast service unreachable')
    const report = await module.settle()
    expect(resultFor(report, two.H)?.status).toBe('admitted')
    expect(keys(b, 'unsent')).toEqual([`color.v1.unsent.${two.H}`])

    b.wallet.sendWithError = undefined
    const submitted = b.ap.submitted.length
    await module.settle()
    expect(b.wallet.sentWith).toEqual([[one.H], [two.H], [two.H]])
    expect(keys(b, 'unsent')).toEqual([])
    expect(b.ap.submitted).toHaveLength(submitted)
    await module.settle()
    expect(b.wallet.sentWith).toHaveLength(3)
  })

  it('D24 a resolved sendWith is success unless its entry for this txid is failed', async () => {
    const one = await handover()
    recipientSettles(one.assetId, one.tx)
    b.wallet.sendWithStatus = 'sending'
    await module.settle()
    expect(keys(b, 'unsent')).toEqual([])

    const two = await handover()
    recipientSettles(two.assetId, two.tx)
    b.wallet.sendWithStatus = 'failed'
    await module.settle()
    expect(keys(b, 'unsent')).toEqual([`color.v1.unsent.${two.H}`])

    b.wallet.sendWithStatus = undefined
    await module.settle()
    expect(b.wallet.sentWith).toEqual([[one.H], [two.H], [two.H]])
    expect(keys(b, 'unsent')).toEqual([])
  })

  it('aborted hand-over is no longer polled by bare settle', async () => {
    const { assetId, H, reference } = await handover()
    b.ap.failTransport()
    await module.settle({ txids: [H] })
    expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(true)
    await b.colorStore.addUnsent(H)
    b.ap.online()
    await b.wallet.abortAction({ reference })

    const hSubmits = (): number => b.ap.submitted.filter(s => txidOf(s) === H).length
    const submits = hSubmits()
    const admissions = b.ap.calls.admission
    const report = await module.settle()
    expect(resultFor(report, H)).toBeUndefined()
    expect((await b.colorStore.getTx(H))?.state).toBe('aborted')
    expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(false)
    expect(b.store.entries.has(`color.v1.unsent.${H}`)).toBe(false)
    expect(hSubmits()).toBe(submits)
    expect(b.ap.calls.admission).toBe(admissions)
    expect(b.wallet.sentWith).toEqual([])

    await module.settle()
    expect(hSubmits()).toBe(submits)
    expect(b.ap.calls.admission).toBe(admissions)

    const named = await module.settle({ txids: [H] })
    expect(named.results).toEqual([
      expect.objectContaining({ txid: H, assetId, status: 'refused', code: 'ERR_ABORTED' })
    ])
    expect(hSubmits()).toBe(submits)
    expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(false)

    // A wallet outage never marks a hand-over aborted.
    const other = await handover()
    await b.wallet.abortAction({ reference: other.reference })
    b.wallet.listActionsError = new Error('wallet unreachable')
    await module.settle()
    expect((await b.colorStore.getTx(other.H))?.state).toBeUndefined()
  })

  it('a live nosend hand-over is never marked aborted', async () => {
    const { H } = await handover()
    for (let run = 0; run < 3; run++) {
      const admissions = b.ap.calls.admission
      await module.settle()
      expect((await b.colorStore.getTx(H))?.state).toBeUndefined()
      expect(b.ap.calls.admission).toBe(admissions + 1)
    }
    b.ap.failTransport()
    await module.settle({ txids: [H] })
    for (let run = 0; run < 3; run++) {
      await module.settle()
      expect((await b.colorStore.getTx(H))?.state).toBeUndefined()
      expect(b.store.entries.has(`color.v1.intent.${H}`)).toBe(true)
    }
  })

  it('an overlay answer that cannot be read skips the hand-over', async () => {
    const { H } = await handover()
    const admission = b.ap.admission
    b.ap.admission = async () => ({ type: 'freeform', result: {} }) as never
    const report = await module.settle()
    expect(resultFor(report, H)).toBeUndefined()
    b.ap.admission = admission
    b.ap.submit = async () => ({}) as STEAK
    await module.settle({ txids: [H] })
    expect((await b.colorStore.getTx(H))?.state).toBeUndefined()
  })
})
