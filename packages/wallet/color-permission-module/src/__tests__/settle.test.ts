import { describe, expect, it } from '@jest/globals'
import {
  P2PKH,
  PrivateKey,
  Transaction,
  UnlockingScript,
  type CreateActionArgs,
  type CreateActionResult,
  type ListActionsArgs,
  type ListActionsResult,
  type WalletInterface
} from '@bsv/sdk'
import { toHex } from '@bsv/sdk/primitives/utils'
import { ColorProviderError } from '../errors.js'
import { colorTopic } from '../identifiers.js'
import type { ColorSettleReport, ResolvedAsset } from '../profiles.js'
import { ColorSettler, type ColorSettlerDeps } from '../settle.js'
import { ColorStore, type TxRecord } from '../store.js'
import type { AttestedSTEAK, ColorOverlayProvider } from '../types.js'
import { C0, FakeStore, signAttestation } from './profileFixtures.js'

/** Exposes the ordered, dispose-aware loop the settle steps run through. */
class ProbeSettler extends ColorSettler {
  async probe<T>(items: Iterable<T>, step: (item: T) => Promise<void>): Promise<boolean> {
    return await this.eachWhileLive(items, step)
  }
}

const settler = (): ProbeSettler => new ProbeSettler({} as unknown as ColorSettlerDeps)

describe('ColorSettler.eachWhileLive', () => {
  it('runs every step in order while live and reports no stop', async () => {
    const seen: number[] = []
    const stopped = await settler().probe([1, 2, 3], async item => {
      await Promise.resolve()
      seen.push(item)
    })
    expect(stopped).toBe(false)
    expect(seen).toEqual([1, 2, 3])
  })

  it('stops before the next step once disposed, as a loop returning on dispose would', async () => {
    const s = settler()
    const seen: number[] = []
    const stopped = await s.probe([1, 2, 3], async item => {
      seen.push(item)
      if (item === 2) s.dispose()
    })
    expect(stopped).toBe(true)
    expect(seen).toEqual([1, 2])
  })

  it('reports no stop when disposal comes during the last step', async () => {
    const s = settler()
    const stopped = await s.probe([1], async () => {
      s.dispose()
    })
    expect(stopped).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// A ColorSettler over a real ColorStore with scripted deps. The settler never verifies scripts,
// so the transactions are unsigned; only their bytes and txids matter.

const ASSET = 'ab'.repeat(32) + '_0'
const OTHER_ASSET = 'cd'.repeat(32) + '_0'
const K = new PrivateKey(C0.PRIV)
const LOCK = new P2PKH().lock(new PrivateKey(77).toPublicKey().toHash() as number[])
let nonce = 1000

/** A no-input transaction with `outputs` one-satoshi outputs. */
function root(outputs = 1): Transaction {
  const tx = new Transaction(1, [], [], nonce++)
  for (let i = 0; i < outputs; i++) tx.addOutput({ lockingScript: LOCK, satoshis: 1 })
  return tx
}

/** A one-output transaction spending `vouts` of `parent`. */
function spend(parent: Transaction, vouts: number[]): Transaction {
  const tx = new Transaction(1, [], [], nonce++)
  for (const vout of vouts) {
    tx.addInput({
      sourceTransaction: parent,
      sourceTXID: parent.id('hex'),
      sourceOutputIndex: vout,
      unlockingScript: new UnlockingScript(),
      sequence: 0xffffffff
    })
  }
  tx.addOutput({ lockingScript: LOCK, satoshis: 1 })
  return tx
}

function record(tx: Transaction, fields: Partial<TxRecord> = {}): TxRecord {
  return {
    v: 1,
    assetId: ASSET,
    rawTx: tx.toHex(),
    atomicBEEF: toHex(tx.toAtomicBEEF()),
    role: 'receipt',
    state: 'credited',
    inputs: tx.inputs.map(input => `${input.sourceTXID!}.${input.sourceOutputIndex}`),
    outputs: [0],
    offChainValues: '',
    attestations: [],
    ...fields
  }
}

/** The STEAK an attesting overlay (K) gives for `beef`, admitting `outputs` of its subject. */
async function attestedSteak(beef: number[], outputs = [0]): Promise<AttestedSTEAK> {
  const txid = Transaction.fromAtomicBEEF(beef).id('hex')
  const att = await signAttestation(K, ASSET, txid, outputs)
  return {
    [colorTopic(ASSET)]: {
      outputsToAdmit: outputs,
      coinsToRetain: [],
      admissionSignature: att.signature,
      admissionIdentityKey: att.signer
    }
  }
}

interface Bench {
  fake: FakeStore
  store: ColorStore
  settler: ColorSettler
  deps: ColorSettlerDeps
  provider: ColorOverlayProvider
  /** Subject txids of every submit, in call order. */
  submitted: string[]
  listCalls: ListActionsArgs[]
  createCalls: CreateActionArgs[]
  resolveCalls: string[]
}

function bench(
  options: {
    submit?: ColorOverlayProvider['submit']
    listActions?: (args: ListActionsArgs) => Promise<ListActionsResult>
    createAction?: (args: CreateActionArgs) => Promise<CreateActionResult>
    deps?: Partial<ColorSettlerDeps>
  } = {}
): Bench {
  const fake = new FakeStore()
  const store = new ColorStore(fake)
  const submitted: string[] = []
  const listCalls: ListActionsArgs[] = []
  const createCalls: CreateActionArgs[] = []
  const resolveCalls: string[] = []
  const submit = options.submit ?? (async () => ({}))
  const provider: ColorOverlayProvider = {
    spendability: async () => {
      throw new Error('not used')
    },
    admission: async () => [] as never,
    submit: async (topics, beef, offChainValues) => {
      submitted.push(Transaction.fromAtomicBEEF(beef).id('hex'))
      return await submit(topics, beef, offChainValues)
    }
  }
  const wallet = {
    listActions: async (args: ListActionsArgs) => {
      listCalls.push(args)
      return options.listActions === undefined
        ? { totalActions: 0, actions: [] }
        : await options.listActions(args)
    },
    createAction: async (args: CreateActionArgs) => {
      createCalls.push(args)
      return options.createAction === undefined ? {} : await options.createAction(args)
    }
  } as unknown as WalletInterface
  const deps: ColorSettlerDeps = {
    store,
    resolve: async assetId => {
      resolveCalls.push(assetId)
      return resolved(assetId, provider)
    },
    qualifies: async () => signer => signer === C0.SIGNER,
    wallet,
    holds: async () => false,
    tokenOutputs: () => [0],
    ...options.deps
  }
  return {
    fake,
    store,
    settler: new ColorSettler(deps),
    deps,
    provider,
    submitted,
    listCalls,
    createCalls,
    resolveCalls
  }
}

const resolved = (assetId: string, provider: ColorOverlayProvider): ResolvedAsset => ({
  assetId,
  req: new Map(),
  handlers: [],
  provider,
  maxReceiptBytes: 1000
})

const key = (kind: string, txid: string): string => `color.v1.${kind}.${txid}`
const id = (tx: Transaction): string => tx.id('hex')

describe('ColorSettler disposal between steps', () => {
  it('step 1: disposal while promoting stops the run before the next receipt and later steps', async () => {
    const [A, B] = [root(), root()]
    let s: ColorSettler | undefined
    const b = bench({
      deps: {
        holds: async () => {
          s!.dispose()
          return true
        }
      }
    })
    s = b.settler
    await b.store.putTx(id(A), record(A, { state: 'staged' }))
    await b.store.putTx(id(B), record(B, { state: 'staged' }))
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    // The receipt in flight is credited; the next one is never reached, nor step 2.
    const states = [(await b.store.getTx(id(A)))?.state, (await b.store.getTx(id(B)))?.state]
    expect(states.sort()).toEqual(['credited', 'staged'])
    expect(b.listCalls).toHaveLength(0)
    expect(b.submitted).toHaveLength(0)
  })

  it('step 2: disposal during abort detection stops before sendWith and submits', async () => {
    const H = root()
    let s: ColorSettler | undefined
    const b = bench({
      listActions: async () => {
        s!.dispose()
        return { totalActions: 1, actions: [{ txid: id(H) }] } as unknown as ListActionsResult
      }
    })
    s = b.settler
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined, labels: ['l'] }))
    await b.store.addUnsent(id(H))
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    expect(b.listCalls).toHaveLength(1)
    expect(b.createCalls).toHaveLength(0)
    expect(b.submitted).toHaveLength(0)
    expect((await b.store.getTx(id(H)))?.state).toBeUndefined()
  })

  it('step 3: disposal during a sendWith retry leaves the next unsent marker for later', async () => {
    const [A, B] = [root(), root()]
    let s: ColorSettler | undefined
    const b = bench({
      createAction: async () => {
        s!.dispose()
        return {}
      }
    })
    s = b.settler
    for (const tx of [A, B]) {
      await b.store.putTx(id(tx), record(tx, { role: 'handover', state: undefined }))
      await b.store.addUnsent(id(tx))
    }
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    expect(b.createCalls).toHaveLength(1)
    const sent = b.createCalls[0].options!.sendWith![0]
    expect(await b.store.unsent()).toEqual([id(A), id(B)].filter(txid => txid !== sent))
    expect(b.submitted).toHaveLength(0)
  })

  it('step 4: disposal while asking the overlay about own hand-overs submits nothing', async () => {
    const [A, B] = [root(), root()]
    let s: ColorSettler | undefined
    const b = bench()
    b.deps.resolve = async assetId => {
      b.resolveCalls.push(assetId)
      s!.dispose()
      return resolved(assetId, b.provider)
    }
    s = new ColorSettler(b.deps)
    for (const tx of [A, B]) {
      await b.store.putTx(id(tx), record(tx, { role: 'handover', state: undefined }))
    }
    await expect(s.settle()).resolves.toEqual({ results: [] })
    expect(b.resolveCalls).toHaveLength(1)
    expect(b.submitted).toHaveLength(0)
  })
})

describe('ColorSettler abort detection (listActions)', () => {
  const handover = (tx: Transaction, labels: string[] = ['color', 'plan']): TxRecord =>
    record(tx, { role: 'handover', state: undefined, labels })

  it('a listing without an actions array changes nothing (an outage never aborts)', async () => {
    const H = root()
    const b = bench({
      listActions: async () => ({}) as unknown as ListActionsResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(H), handover(H))
    await b.store.addIntent(id(H))
    await b.settler.settle()
    expect((await b.store.getTx(id(H)))?.state).toBeUndefined()
  })

  it('ignores listed actions without a txid; a listed hand-over stays live, an unlisted one aborts', async () => {
    const [live, gone] = [root(), root()]
    const b = bench({
      listActions: async () =>
        ({
          totalActions: 3,
          actions: [{}, null, { txid: id(live) }]
        }) as unknown as ListActionsResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(live), handover(live))
    await b.store.putTx(id(gone), handover(gone))
    await b.store.addIntent(id(gone))
    await b.store.addUnsent(id(gone))
    await b.settler.settle()
    expect(b.listCalls).toEqual([
      { labels: ['color', 'plan'], labelQueryMode: 'all', limit: 1000, offset: 0 }
    ])
    expect((await b.store.getTx(id(live)))?.state).toBeUndefined()
    expect((await b.store.getTx(id(gone)))?.state).toBe('aborted')
    expect(await b.store.intents()).toEqual([])
    expect(await b.store.unsent()).toEqual([])
  })

  it('reads every page: a hand-over listed on page two is live', async () => {
    const H = root()
    const filler = Array.from({ length: 1000 }, (_, i) => ({
      txid: i.toString(16).padStart(64, '0')
    }))
    const b = bench({
      listActions: async args =>
        ({
          totalActions: 1001,
          actions: args.offset === 0 ? filler : [{ txid: id(H) }]
        }) as unknown as ListActionsResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(H), handover(H))
    await b.settler.settle()
    expect(b.listCalls.map(args => args.offset)).toEqual([0, 1000])
    expect((await b.store.getTx(id(H)))?.state).toBeUndefined()
  })

  it('stops paging once offset reaches totalActions, even after a full page', async () => {
    const H = root()
    const page = Array.from({ length: 1000 }, (_, i) => ({
      txid: i.toString(16).padStart(64, '0')
    }))
    page[999] = { txid: id(H) }
    const b = bench({
      listActions: async () =>
        ({ totalActions: 1000, actions: page }) as unknown as ListActionsResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(H), handover(H))
    await b.settler.settle()
    expect(b.listCalls).toHaveLength(1)
    expect((await b.store.getTx(id(H)))?.state).toBeUndefined()
  })

  it('a hand-over without labels is never looked up, so never aborted', async () => {
    const H = root()
    const b = bench({ deps: { tokenOutputs: () => [] } })
    await b.store.putTx(id(H), handover(H, []))
    await b.settler.settle()
    expect(b.listCalls).toHaveLength(0)
    expect((await b.store.getTx(id(H)))?.state).toBeUndefined()
  })
})

describe('ColorSettler sendWith retries (step 3)', () => {
  it('a stale unsent marker for a receipt or a missing record is never sent', async () => {
    const [R, missing] = [root(), root()]
    const b = bench({ deps: { tokenOutputs: () => [] } })
    await b.store.putTx(id(R), record(R, { state: 'staged' }))
    await b.store.addUnsent(id(R))
    await b.store.addUnsent(id(missing))
    await b.settler.settle()
    expect(b.createCalls).toHaveLength(0)
    expect(await b.store.unsent()).toEqual([id(R), id(missing)].sort())
  })

  it('keeps the marker when the wallet reports the send failed', async () => {
    const H = root()
    const b = bench({
      createAction: async () =>
        ({ sendWithResults: [{ txid: id(H), status: 'failed' }] }) as CreateActionResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined }))
    await b.store.addUnsent(id(H))
    await b.settler.settle()
    expect(b.createCalls).toEqual([
      { description: 'Settle token hand-over', options: { sendWith: [id(H)] } }
    ])
    expect(await b.store.unsent()).toEqual([id(H)])
  })

  it('a resolved sendWith without sendWithResults counts as sent (D24)', async () => {
    const H = root()
    const b = bench({
      createAction: async () => undefined as unknown as CreateActionResult,
      deps: { tokenOutputs: () => [] }
    })
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined }))
    await b.store.addUnsent(id(H))
    await b.settler.settle()
    expect(b.createCalls).toHaveLength(1)
    expect(await b.store.unsent()).toEqual([])
  })
})

describe('ColorSettler candidates (step 4)', () => {
  it('a named txid without a record is ignored, and one named twice is reported once', async () => {
    const [unknown, R] = [root(), root()]
    const b = bench()
    await b.store.putTx(id(R), record(R, { state: 'staged' }))
    const report = await b.settler.settle({ txids: [id(unknown), id(R), id(R)] })
    expect(report).toEqual({
      results: [
        {
          txid: id(R),
          assetId: ASSET,
          status: 'retry',
          code: 'ERR_NOT_HELD',
          description: 'BRC-207: the wallet does not hold this receipt'
        }
      ]
    })
    expect(await b.store.intents()).toEqual([])
  })

  it('a persisted intent of another asset is kept when the run is filtered', async () => {
    const H = root()
    const b = bench()
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined }))
    await b.store.addIntent(id(H))
    await expect(b.settler.settle({ assetIds: [OTHER_ASSET] })).resolves.toEqual({ results: [] })
    expect(await b.store.intents()).toEqual([id(H)])
    expect(b.submitted).toHaveLength(0)
  })

  it('an unreadable tx record is skipped, never submitted', async () => {
    const R = root()
    const b = bench()
    await b.fake.set(key('tx', id(R)), '{"v":1')
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    expect(b.submitted).toHaveLength(0)
  })

  it('a hand-over whose rawTx is another transaction is not asked about', async () => {
    const [H, other] = [root(), root()]
    const b = bench()
    await b.store.putTx(
      id(H),
      record(H, { role: 'handover', state: undefined, rawTx: other.toHex() })
    )
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    expect(b.resolveCalls).toHaveLength(0)
  })

  it('a hand-over without token outputs of the asset is not asked about', async () => {
    const H = root()
    const b = bench({ deps: { tokenOutputs: () => [] } })
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined }))
    await expect(b.settler.settle()).resolves.toEqual({ results: [] })
    expect(b.resolveCalls).toHaveLength(0)
  })

  it('a named refused txid reports its stored refusal and drops the intent', async () => {
    const H = root()
    const b = bench()
    await b.store.putTx(id(H), record(H, { role: 'handover', state: undefined }))
    await b.store.markRefused(id(H), { code: 'ERR_DOUBLE_SPEND', description: 'spent' })
    await b.store.addIntent(id(H))
    await expect(b.settler.settle({ txids: [id(H)] })).resolves.toEqual({
      results: [
        {
          txid: id(H),
          assetId: ASSET,
          status: 'refused',
          code: 'ERR_DOUBLE_SPEND',
          description: 'spent'
        }
      ]
    })
    expect(await b.store.intents()).toEqual([])
    expect(b.submitted).toHaveLength(0)
  })
})

describe('ColorSettler ancestor closure (step 5)', () => {
  it('a child of a refused parent is refused without a submit; the parent is not expanded', async () => {
    const P = root()
    const C = spend(P, [0])
    const b = bench()
    await b.store.putTx(id(P), record(P, { role: 'ancestor', outputs: [] }))
    await b.store.markRefused(id(P), { code: 'ERR_INVALID', description: 'bad' })
    await b.store.putTx(id(C), record(C))
    await b.store.addIntent(id(C))
    const report = await b.settler.settle()
    const description = `BRC-207: parent ${id(P)} was refused`
    expect(report).toEqual({
      results: [
        { txid: id(C), assetId: ASSET, status: 'refused', code: 'ERR_PARENT_REFUSED', description }
      ]
    })
    expect(await b.store.refused(id(C))).toEqual({ code: 'ERR_PARENT_REFUSED', description })
    expect(await b.store.intents()).toEqual([])
    expect(b.submitted).toHaveLength(0)
  })

  it('an aborted parent is not followed: the child is submitted alone', async () => {
    const P = root()
    const C = spend(P, [0])
    const b = bench()
    await b.store.putTx(id(P), record(P, { role: 'handover', state: 'aborted' }))
    await b.store.putTx(id(C), record(C))
    await b.settler.settle()
    expect(b.submitted).toEqual([id(C)])
  })

  it('a settled parent is not submitted again, even when its record holds no attestation', async () => {
    const P = root()
    const C = spend(P, [0])
    const b = bench()
    await b.store.putTx(id(P), record(P, { role: 'ancestor', outputs: [] }))
    await b.store.markSettled(id(P), { outputs: [0], signer: C0.SIGNER })
    await b.store.putTx(id(C), record(C))
    await b.settler.settle()
    expect(b.submitted).toEqual([id(C)])
  })

  it('a parent spent twice by one child is submitted once, before the child', async () => {
    const P = root(2)
    const C = spend(P, [0, 1])
    const b = bench({ submit: async (_topics, beef) => await attestedSteak(beef) })
    await b.store.putTx(id(P), record(P, { role: 'ancestor', outputs: [] }))
    await b.store.putTx(id(C), record(C))
    const report = await b.settler.settle()
    expect(b.submitted).toEqual([id(P), id(C)])
    expect(report.results.map(result => [result.txid, result.status])).toEqual([
      [id(P), 'admitted'],
      [id(C), 'admitted']
    ])
  })

  it('a child waits with its parent’s retry code while the parent is not admitted', async () => {
    const P = root()
    const C = spend(P, [0])
    const b = bench()
    await b.store.putTx(id(P), record(P, { role: 'ancestor', outputs: [] }))
    await b.store.putTx(id(C), record(C))
    const report = await b.settler.settle()
    expect(b.submitted).toEqual([id(P)])
    expect(report.results[1]).toEqual({
      txid: id(C),
      assetId: ASSET,
      status: 'retry',
      code: 'ERR_NO_ATTESTATION',
      description: 'BRC-207: a parent transaction is not settled yet'
    })
  })
})

describe('ColorSettler submit failures', () => {
  const failing = (error: unknown): Partial<ColorSettlerDeps> => ({
    resolve: async () => {
      throw error
    }
  })

  it('a typed provider failure during resolution is retry with its code', async () => {
    const R = root()
    const b = bench({
      deps: failing(new ColorProviderError('ERR_TIMEOUT', true, true, 'timed out'))
    })
    await b.store.putTx(id(R), record(R))
    await expect(b.settler.settleTx(id(R))).resolves.toMatchObject({
      txid: id(R),
      status: 'retry',
      code: 'ERR_TIMEOUT'
    })
  })

  it('an untyped resolution failure is retry ERR_UNAVAILABLE with its message', async () => {
    const R = root()
    const b = bench({ deps: failing(new Error('dns failure')) })
    await b.store.putTx(id(R), record(R))
    await expect(b.settler.settleTx(id(R))).resolves.toEqual({
      txid: id(R),
      assetId: ASSET,
      status: 'retry',
      code: 'ERR_UNAVAILABLE',
      description: 'dns failure'
    })
  })

  it('a thrown non-error is described by its string form', async () => {
    const R = root()
    const b = bench({ deps: failing('offline') })
    await b.store.putTx(id(R), record(R))
    await expect(b.settler.settleTx(id(R))).resolves.toMatchObject({
      status: 'retry',
      code: 'ERR_UNAVAILABLE',
      description: 'offline'
    })
  })

  it('an error named ColorProviderError without a string code is not a final refusal', async () => {
    const R = root()
    const forged = Object.assign(new Error('refused?'), {
      name: 'ColorProviderError',
      code: 7,
      retryable: false,
      transport: false
    })
    const b = bench({
      submit: async () => {
        throw forged
      }
    })
    await b.store.putTx(id(R), record(R))
    await expect(b.settler.settleTx(id(R))).resolves.toMatchObject({
      status: 'retry',
      code: 'ERR_UNAVAILABLE',
      description: 'refused?'
    })
    expect(await b.store.refused(id(R))).toBeUndefined()
  })

  it('an untyped submit failure is retry ERR_UNAVAILABLE and records nothing', async () => {
    const R = root()
    const b = bench({
      submit: async () => {
        throw new Error('502 bad gateway')
      }
    })
    await b.store.putTx(id(R), record(R))
    await b.store.addIntent(id(R))
    await expect(b.settler.settleTx(id(R))).resolves.toEqual({
      txid: id(R),
      assetId: ASSET,
      status: 'retry',
      code: 'ERR_UNAVAILABLE',
      description: '502 bad gateway'
    })
    expect(await b.store.refused(id(R))).toBeUndefined()
    expect(await b.store.intents()).toEqual([id(R)])
  })

  it('settleTx of an aborted hand-over is refused without resolving or submitting', async () => {
    const H = root()
    const b = bench()
    await b.store.putTx(id(H), record(H, { role: 'handover', state: 'aborted' }))
    await expect(b.settler.settleTx(id(H))).resolves.toEqual({
      txid: id(H),
      assetId: ASSET,
      status: 'refused',
      code: 'ERR_ABORTED',
      description: 'BRC-207: the hand-over was aborted in the wallet'
    })
    expect(b.resolveCalls).toHaveLength(0)
    expect(b.submitted).toHaveLength(0)
  })

  it('a record removed during the submit still gets its attestation and settled marker', async () => {
    const R = root()
    let b: Bench | undefined
    b = bench({
      submit: async (_topics, beef) => {
        await b!.fake.delete(key('tx', id(R)))
        return await attestedSteak(beef)
      }
    })
    await b.store.putTx(id(R), record(R))
    await expect(b.settler.settleTx(id(R))).resolves.toEqual({
      txid: id(R),
      assetId: ASSET,
      status: 'admitted',
      outputs: [0]
    })
    expect(await b.store.settled(id(R))).toEqual({ outputs: [0], signer: C0.SIGNER })
    const stored = await b.store.getTx(id(R))
    expect(stored?.attestations).toHaveLength(1)
    expect(stored?.attestations[0]).toMatchObject({ txid: id(R), signer: C0.SIGNER })
  })
})

describe('ColorSettler overlapping runs', () => {
  const both = async (b: Bench, second?: Parameters<ColorSettler['settle']>[0]) =>
    await Promise.all([b.settler.settle(), b.settler.settle(second)])

  it('a result the overlapping run reached itself is reported once', async () => {
    const R = root()
    const b = bench()
    await b.store.putTx(id(R), record(R))
    const [first, second] = await both(b)
    expect(first.results.map(result => result.txid)).toEqual([id(R)])
    expect(second.results.map(result => [result.txid, result.code])).toEqual([
      [id(R), 'ERR_NO_ATTESTATION']
    ])
  })

  it('an overlapping run filtered to another asset leaves out the earlier run’s results', async () => {
    const R = root()
    const b = bench({ submit: async (_topics, beef) => await attestedSteak(beef) })
    await b.store.putTx(id(R), record(R))
    const [first, second] = await both(b, { assetIds: [OTHER_ASSET] })
    expect(first.results).toEqual([
      { txid: id(R), assetId: ASSET, status: 'admitted', outputs: [0] }
    ])
    expect(second).toEqual({ results: [] })
  })

  it('only final outcomes of the earlier run are repeated, not its retries', async () => {
    const R = root()
    const b = bench()
    await b.store.putTx(id(R), record(R, { state: 'staged' }))
    const runs: Array<Promise<ColorSettleReport>> = [
      b.settler.settle({ txids: [id(R)] }),
      b.settler.settle()
    ]
    const [first, second] = await Promise.all(runs)
    expect(first.results).toMatchObject([{ txid: id(R), status: 'retry', code: 'ERR_NOT_HELD' }])
    expect(second).toEqual({ results: [] })
  })
})
