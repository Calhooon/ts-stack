import { beforeEach, describe, expect, it } from '@jest/globals'
import {
  Beef,
  Curve,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Signature,
  Transaction,
  type InternalizeActionArgs
} from '@bsv/sdk'
import { hash160 } from '@bsv/sdk/primitives/Hash'
import { OneColor } from '@bsv/templates'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import { ATTESTED_PROFILE_ID } from '../attestation.js'
import { createAttestedProfile } from '../attested.js'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { ColorProviderError } from '../errors.js'
import { assetBasket, COLOR_KEY_ID, colorProtocolID } from '../identifiers.js'
import type {
  ColorAttestation,
  ProfileAssetContext,
  ReceiptAdmission,
  ReceiptGraph,
  RequiredProfileHandler
} from '../profiles.js'
import { ColorStore } from '../store.js'
import type { ColorPermissionModuleOptions } from '../types.js'
import {
  createModule,
  deployAsset,
  FakeProvider,
  FakeWallet,
  remittanceString,
  tokenPayment
} from './fixtures.js'
import {
  A141A,
  AttestingProvider,
  attestedAsset,
  attestedReceipt,
  C0,
  exampleProfile,
  FakeStore,
  fixtureDeploy,
  graph,
  ISSUER_LIKE_ID,
  issuerLikePayload,
  issuerLikeProfile,
  jsonInscription,
  signAttestation,
  TestModule,
  type AttestedReceipt,
  type GraphBuilder
} from './profileFixtures.js'

const APP = 'app.example'
const K = new PrivateKey(C0.PRIV)
const SIGNER = C0.SIGNER
const MIB16 = 16_777_216
const txKey = (txid: string): string => `color.v1.tx.${txid}`

/** A provider whose every call is a transport failure (fully offline). */
function offline(provider: FakeProvider): void {
  const unavailable = (): never => {
    throw new ColorProviderError('ERR_UNAVAILABLE', true, true, 'offline')
  }
  provider.admission = async () => {
    provider.calls.admission++
    return unavailable()
  }
  provider.spendability = async () => {
    provider.calls.spendability++
    return unavailable()
  }
  provider.submit = async () => {
    provider.calls.submit++
    return unavailable()
  }
}

describe('attested receipts', () => {
  let wallet: FakeWallet
  let provider: FakeProvider
  let store: FakeStore
  let colorStore: ColorStore
  let g: GraphBuilder
  let prompts: Array<Record<string, unknown>>
  let approve: boolean
  /** `store.writes.length` at each underlying wallet internalizeAction. */
  let walletCalls: number[]

  function moduleWith(options: Partial<ColorPermissionModuleOptions> = {}): TestModule {
    const attested = createAttestedProfile()
    return new TestModule({
      wallet: wallet.asWallet(),
      provider,
      requestTokenAccess: async (_app, message) => {
        prompts.push(JSON.parse(message) as Record<string, unknown>)
        return approve
      },
      profiles: { [attested.id]: attested },
      store,
      ...options
    })
  }

  /** The manager's flow: the module's onRequest, then the underlying wallet with the forwarded args. */
  async function receive(
    module: ColorPermissionModule,
    args: InternalizeActionArgs
  ): Promise<InternalizeActionArgs> {
    const { args: forwarded } = await module.onRequest({
      method: 'internalizeAction',
      args,
      originator: APP
    })
    walletCalls.push(store.writes.length)
    await wallet.internalizeAction(forwarded as InternalizeActionArgs)
    return forwarded as InternalizeActionArgs
  }

  function withInstructions(
    args: InternalizeActionArgs,
    customInstructions: string
  ): InternalizeActionArgs {
    const [output] = args.outputs
    return {
      ...args,
      outputs: [
        {
          ...output,
          insertionRemittance: { ...output.insertionRemittance!, customInstructions }
        }
      ]
    }
  }

  beforeEach(() => {
    wallet = new FakeWallet()
    provider = new FakeProvider()
    store = new FakeStore()
    colorStore = new ColorStore(store)
    g = graph()
    prompts = []
    approve = true
    walletCalls = []
  })

  it('A.116/C37 bounds receipt instructions at 16 MiB before parsing, then by the asset limit', async () => {
    // A profile-free asset keeps the 0.1.0 limit and text.
    const issuer = new FakeWallet()
    const { assetId: plainId } = await deployAsset(issuer, provider, 1000n)
    const paid = await tokenPayment(new FakeWallet(), wallet, plainId, 25n)
    provider.admit(plainId, paid.tx, 0)
    const padded = paid.customInstructions + ' '.repeat(1001 - paid.customInstructions.length)
    const plainArgs: InternalizeActionArgs = {
      tx: paid.tx.toAtomicBEEF(),
      description: 'Receive tokens',
      outputs: [
        {
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: { basket: assetBasket(plainId, 'value'), customInstructions: padded }
        }
      ]
    }
    await expect(receive(moduleWith(), plainArgs)).rejects.toThrow(
      'BRC-207: receipt customInstructions exceeds 1000 bytes'
    )

    // An attested asset accepts a 200 KB leaf.
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const big = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      attestTip: true,
      tipOffChainValues: 'ab'.repeat(100_000)
    })
    expect(big.args.outputs[0].insertionRemittance!.customInstructions!.length).toBeGreaterThan(
      200_000
    )
    await expect(receive(moduleWith(), big.args)).resolves.toBeDefined()

    // 16 MiB + 1 byte fails before any provider call, as does more than 16 MiB in aggregate.
    const fresh = new FakeProvider()
    const module = moduleWith({ provider: fresh })
    await expect(
      receive(module, withInstructions(big.args, ' '.repeat(MIB16 + 1)))
    ).rejects.toThrow(/exceeds 16777216 bytes/)
    const half = ' '.repeat(MIB16 / 2 + 1)
    const two: InternalizeActionArgs = {
      ...big.args,
      outputs: [0, 1].map(outputIndex => ({
        outputIndex,
        protocol: 'basket insertion' as const,
        insertionRemittance: {
          basket: assetBasket(big.custody.assetId, 'value'),
          customInstructions: half
        }
      }))
    }
    await expect(receive(module, two)).rejects.toThrow(/16777216 bytes/)
    expect(fresh.calls).toEqual({ spendability: 0, admission: 0, submit: 0 })
  })

  it('A.154 receipt profileData naming an undeclared profile fails', async () => {
    const { tx: deploy, assetId } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      attestTip: true,
      extraProfileData: { 'urn:example:other': { [assetId]: {} } }
    })
    await expect(receive(moduleWith(), receipt.args)).rejects.toMatchObject({
      name: 'ProfileDataError',
      message: '[ProfileDataError] BRC-207: profile data names an undeclared profile'
    })
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  it('a leaf for a profile without checkReceiptData fails', async () => {
    const ex = exampleProfile()
    const { tx: deployTx, assetId } = fixtureDeploy(A141A.C)
    provider.admit(assetId, deployTx, 0)
    const paid = await tokenPayment(new FakeWallet(), wallet, assetId, 40n)
    provider.admit(assetId, paid.tx, 0)
    const custody = JSON.parse(paid.customInstructions) as Record<string, unknown>
    const args: InternalizeActionArgs = {
      tx: paid.tx.toAtomicBEEF(),
      description: 'Receive tokens',
      outputs: [
        {
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: JSON.stringify({
              ...custody,
              profileData: { [ex.id]: { [assetId]: { revision: 1 } } }
            })
          }
        }
      ]
    }
    const module = moduleWith({ profiles: { [ex.id]: ex } })
    await expect(receive(module, args)).rejects.toMatchObject({ name: 'ProfileDataError' })

    // The same receipt without the leaf passes on the 0.1.0 spendability check.
    const forwarded = await receive(module, withInstructions(args, paid.customInstructions))
    expect(forwarded.outputs[0].insertionRemittance?.customInstructions).toBe(
      paid.customInstructions
    )
    expect(provider.calls.spendability).toBe(1)

    // A handler that checks receipt data receives the leaf with the asset context.
    const seen: unknown[] = []
    const checking: RequiredProfileHandler = {
      ...ex,
      checkReceiptData: async (ctx, leaf) => {
        seen.push({
          assetId: ctx.assetId,
          profileId: ctx.profileId,
          identityKey: ctx.identityKey,
          leaf
        })
      }
    }
    const paid2 = await tokenPayment(new FakeWallet(), wallet, assetId, 41n)
    provider.admit(assetId, paid2.tx, 0)
    await receive(moduleWith({ profiles: { [ex.id]: checking } }), {
      ...args,
      tx: paid2.tx.toAtomicBEEF(),
      outputs: [
        {
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: JSON.stringify({
              ...(JSON.parse(paid2.customInstructions) as object),
              profileData: { [ex.id]: { [assetId]: { revision: 1 } } }
            })
          }
        }
      ]
    })
    expect(seen).toEqual([
      { assetId, profileId: ex.id, identityKey: wallet.identityKey, leaf: { revision: 1 } }
    ])
  })

  it('an attested asset requires the attested leaf', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER, { admit: provider })
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    await expect(
      receive(moduleWith(), withInstructions(receipt.args, JSON.stringify(receipt.custody)))
    ).rejects.toMatchObject({
      name: 'AttestationEvidenceError',
      reason: 'missing attested evidence'
    })
  })

  it('C01/C40 accepts offline with consent, stores evidence first, forwards 5-member custody and color_offline', async () => {
    offline(provider)
    const { tx: deploy, assetId } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const tip = receipt.tip.id('hex')
    const forwarded = await receive(moduleWith(), receipt.args)

    expect(provider.calls).toEqual({ admission: 0, spendability: 0, submit: 0 })
    expect(prompts).toEqual([
      {
        type: 'color_receive_offline',
        assetId,
        outputs: [{ outputIndex: 0, amount: '600' }],
        unsettledTransactions: 1,
        signer: SIGNER,
        profiles: [ATTESTED_PROFILE_ID],
        seekPermission: true
      }
    ])
    expect(Object.keys(prompts[0])).toEqual([
      'type',
      'assetId',
      'outputs',
      'unsettledTransactions',
      'signer',
      'profiles',
      'seekPermission'
    ])

    const record = await colorStore.getTx(tip)
    expect(record).toMatchObject({
      v: 1,
      assetId,
      rawTx: receipt.tip.toHex(),
      atomicBEEF: toHex(receipt.args.tx),
      role: 'receipt',
      state: 'staged',
      inputs: [`${receipt.anchor.id('hex')}.0`],
      outputs: [0],
      offChainValues: ''
    })
    expect(store.writes.indexOf(txKey(tip))).toBeGreaterThanOrEqual(0)
    expect(store.writes.indexOf(txKey(tip))).toBeLessThan(walletCalls[0])
    // The anchor is stored with its attestation, before the tip.
    const anchor = await colorStore.getTx(receipt.anchor.id('hex'))
    expect(anchor?.role).toBe('ancestor')
    expect(anchor?.attestations).toHaveLength(1)
    expect(store.writes.indexOf(txKey(receipt.anchor.id('hex')))).toBeLessThan(
      store.writes.indexOf(txKey(tip))
    )
    expect(await colorStore.settled(tip)).toBeUndefined()

    const insertion = forwarded.outputs[0].insertionRemittance!
    expect(insertion.customInstructions).toBe(JSON.stringify(receipt.custody))
    expect(insertion.tags).toEqual(['color_offline'])
    expect(wallet.outputs.get(`${tip}.0`)?.tags).toEqual(['color_offline'])
  })

  it('an attested-only asset whose tip is attested in the leaf credits settled without consent', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      attestTip: true
    })
    const tip = receipt.tip.id('hex')
    const forwarded = await receive(moduleWith(), receipt.args)
    expect(prompts).toEqual([])
    expect(await colorStore.settled(tip)).toEqual({ outputs: [0], signer: SIGNER })
    expect(store.writes.indexOf(`color.v1.settled.${tip}`)).toBeGreaterThan(
      store.writes.indexOf(txKey(tip))
    )
    expect(forwarded.outputs[0].insertionRemittance?.tags).toBeUndefined()
    expect((await colorStore.getTx(tip))?.attestations).toHaveLength(1)
    expect(provider.calls.spendability).toBe(0)
  })

  it('stores byte-identical AtomicBEEF per tx', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      unattested: 1
    })
    expect(receipt.anchor.merklePath).toBeUndefined()
    const [A] = receipt.ancestors
    await receive(moduleWith(), receipt.args)
    expect(prompts[0]).toMatchObject({ unsettledTransactions: 2 })
    const tip = await colorStore.getTx(receipt.tip.id('hex'))
    const ancestor = await colorStore.getTx(A.id('hex'))
    expect(tip?.atomicBEEF).toBe(toHex(receipt.args.tx))
    expect(ancestor).toMatchObject({ role: 'ancestor', outputs: [], attestations: [] })
    expect(ancestor?.atomicBEEF).toBe(
      toHex(Beef.fromBinary(receipt.args.tx).toBinaryAtomic(A.id('hex')))
    )
    const parsed = Transaction.fromAtomicBEEF(toArray(ancestor!.atomicBEEF, 'hex'))
    expect(parsed.inputs[0].sourceTransaction?.id('hex')).toBe(receipt.anchor.id('hex'))
    // Ancestors are written before the tip.
    expect(store.writes.indexOf(txKey(A.id('hex')))).toBeLessThan(
      store.writes.indexOf(txKey(receipt.tip.id('hex')))
    )
  })

  it('non-identity offline consent lists sorted signers instead of signer', async () => {
    const P = new PrivateKey(7001)
    const Q = new PrivateKey(7002)
    const keys = [P, Q].map(key => key.toPublicKey().toString())
    const attested = createAttestedProfile({
      trustedIdentities: async () => ({ snapshot: 's1', identityKeys: keys })
    })
    const { tx: deploy, assetId } = attestedAsset(g, { trustMode: 'any' })
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [Q, P],
      seekPermission: false
    })
    await receive(moduleWith({ profiles: { [attested.id]: attested } }), receipt.args)
    expect(prompts).toEqual([
      {
        type: 'color_receive_offline',
        assetId,
        outputs: [{ outputIndex: 0, amount: '600' }],
        unsettledTransactions: 1,
        signers: [...keys].sort(),
        profiles: [ATTESTED_PROFILE_ID],
        seekPermission: false
      }
    ])
    expect(Object.keys(prompts[0])).toEqual([
      'type',
      'assetId',
      'outputs',
      'unsettledTransactions',
      'signers',
      'profiles',
      'seekPermission'
    ])
  })

  it('declined offline consent writes nothing', async () => {
    approve = false
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    await expect(receive(moduleWith(), receipt.args)).rejects.toMatchObject({
      name: 'ColorConsentDeclinedError',
      message: expect.stringMatching(/declined the color_receive_offline/)
    })
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
    expect(store.writes.filter(key => key.startsWith('color.v1.settled.'))).toEqual([])
    expect(store.writes.every(key => key.startsWith('color.v1.deploy.'))).toBe(true)
    expect(walletCalls).toEqual([])
    expect(wallet.outputs.size).toBe(0)
    expect(provider.submissions).toEqual([])
  })

  it('idempotent receipt retry writes one record and credits once', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const tip = receipt.tip.id('hex')
    const module = moduleWith()
    await receive(module, receipt.args)
    const first = store.entries.get(txKey(tip))
    // A crash after the store write: the retried internalize (new module instance) credits once.
    await receive(moduleWith(), receipt.args)
    await receive(module, receipt.args)
    expect([...store.entries.keys()].filter(key => key === txKey(tip))).toHaveLength(1)
    expect(store.entries.get(txKey(tip))).toBe(first)
    expect([...wallet.outputs.keys()].filter(key => key.startsWith(tip))).toEqual([`${tip}.0`])
  })

  /** A different transaction spending the receipt's attested anchor output, paying the same. */
  async function doubleSpend(receipt: AttestedReceipt): Promise<Transaction> {
    const T2 = new Transaction()
    T2.addInput({
      sourceTransaction: receipt.anchor,
      sourceOutputIndex: 0,
      unlockingScriptTemplate: new OneColor().unlock(g.owner)
    })
    T2.addOutput({ lockingScript: receipt.tip.outputs[0].lockingScript, satoshis: 1 })
    T2.lockTime = 7
    await T2.sign()
    expect(T2.id('hex')).not.toBe(receipt.tip.id('hex'))
    return T2
  }

  it('C28/C55 a second offline receipt spending the same anchored outpoint is refused', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    await receive(moduleWith(), receipt.args)
    const T2 = await doubleSpend(receipt)
    prompts.length = 0
    const writes = store.writes.length

    await expect(
      receive(moduleWith(), { ...receipt.args, tx: T2.toAtomicBEEF() })
    ).rejects.toMatchObject({ name: 'AttestationEvidenceError', reason: 'known conflicting spend' })
    expect(prompts).toEqual([])
    expect(store.writes.slice(writes).filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
    expect(wallet.outputs.has(`${T2.id('hex')}.0`)).toBe(false)
  })

  it('an attested spend of the same outpoint is not a known conflict: the overlay admitted it', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    await receive(moduleWith(), receipt.args)
    const T2 = await doubleSpend(receipt)
    const custody = JSON.parse(receipt.args.outputs[0].insertionRemittance!.customInstructions!)
    const leaf = custody.profileData[ATTESTED_PROFILE_ID][receipt.custody.assetId]
    leaf.attestations = [
      ...leaf.attestations,
      { ...(await signAttestation(K, receipt.custody.assetId, T2.id('hex'), [0])) }
    ]
    leaf.submissions = [{ txid: T2.id('hex'), offChainValues: '' }]
    await expect(
      receive(moduleWith(), {
        ...withInstructions(receipt.args, JSON.stringify(custody)),
        tx: T2.toAtomicBEEF()
      })
    ).resolves.toBeDefined()
  })

  it('a retry keeps a settled record and a credited state', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const tip = receipt.tip.id('hex')
    await receive(moduleWith(), receipt.args)
    const record = (await colorStore.getTx(tip))!
    await colorStore.putTx(tip, { ...record, state: 'credited' })
    await colorStore.markSettled(tip, { outputs: [0], signer: SIGNER })
    await receive(moduleWith(), receipt.args)
    expect((await colorStore.getTx(tip))?.state).toBe('credited')
    expect(await colorStore.settled(tip)).toEqual({ outputs: [0], signer: SIGNER })
  })

  it('strips caller color_* tags from insertions', async () => {
    const tags = ['color_offline', 'color_state_available', 'mine']
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const settled = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      attestTip: true,
      tags
    })
    const forwarded = await receive(moduleWith(), settled.args)
    expect(forwarded.outputs[0].insertionRemittance?.tags).toEqual(['mine'])
    // Another asset: a second receipt from the same deploy would spend its anchor output again.
    const unsettled = await attestedReceipt({
      g,
      deploy: attestedAsset(g, SIGNER).tx,
      recipient: wallet,
      signers: [K],
      tags
    })
    const offlineForwarded = await receive(moduleWith(), unsettled.args)
    expect(offlineForwarded.outputs[0].insertionRemittance?.tags).toEqual(['mine', 'color_offline'])
    // The caller's args are not modified.
    expect(unsettled.args.outputs[0].insertionRemittance?.tags).toEqual(tags)
  })

  it('A.79 never submits during internalization without a handler', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      unattested: 2
    })
    await receive(moduleWith(), receipt.args)
    expect(provider.submissions).toEqual([])
    expect(provider.calls.submit).toBe(0)
  })

  it('C16 a trust snapshot change during the decision fails', async () => {
    let calls = 0
    const attested = createAttestedProfile({
      trustedIdentities: async () => ({
        snapshot: calls++ === 0 ? 'a' : 'b',
        identityKeys: [SIGNER]
      })
    })
    const { tx: deploy } = attestedAsset(g, { trustMode: 'any' })
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    await expect(
      receive(moduleWith({ profiles: { [attested.id]: attested } }), receipt.args)
    ).rejects.toMatchObject({ name: 'AttestationEvidenceError', reason: 'trust snapshot changed' })
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  it('a BRC-161 mint without an authority input in the graph is not credited', async () => {
    const { tx: deploy, assetId } = attestedAsset(g, SIGNER)
    const owner = toHex(g.owner.toPublicKey().toHash() as number[])
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      unattested: 1,
      hopOutput: { lockingScript: jsonInscription('mint', assetId, '600', owner) }
    })
    await expect(receive(moduleWith(), receipt.args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError',
      reason: 'legacy mint needs an authority input'
    })
    expect(prompts.filter(prompt => prompt.type === 'color_receive_offline')).toEqual([])
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  it('rejects evidence whose coverage or graph is invalid', async () => {
    // Signed by a key other than the declared identity: no coverage.
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const other = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [new PrivateKey(9)]
    })
    await expect(receive(moduleWith(), other.args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError'
    })
    // A leaf for another asset than the receipt's.
    const valid = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const custody = JSON.parse(valid.args.outputs[0].insertionRemittance!.customInstructions!) as {
      profileData: Record<string, Record<string, unknown>>
    }
    const leaf = custody.profileData[ATTESTED_PROFILE_ID][valid.custody.assetId]
    const otherId = `${'ab'.repeat(32)}_0`
    await expect(
      receive(
        moduleWith(),
        withInstructions(
          valid.args,
          JSON.stringify({
            ...valid.custody,
            profileData: {
              [ATTESTED_PROFILE_ID]: { [valid.custody.assetId]: leaf, [otherId]: leaf }
            }
          })
        )
      )
    ).rejects.toMatchObject({ name: 'AttestationEvidenceError' })
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  it('profile-free receipts are unchanged', async () => {
    const issuer = new FakeWallet()
    const { assetId } = await deployAsset(issuer, provider, 1000n)
    const paid = await tokenPayment(new FakeWallet(), wallet, assetId, 25n)
    provider.admit(assetId, paid.tx, 0)
    const args: InternalizeActionArgs = {
      tx: paid.tx.toAtomicBEEF(),
      description: 'Receive tokens',
      outputs: [
        {
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: paid.customInstructions,
            tags: ['color_offline']
          }
        }
      ]
    }
    const module = createModule(wallet, provider)
    const { args: forwarded } = await module.onRequest({
      method: 'internalizeAction',
      args,
      originator: APP
    })
    expect(forwarded).toBe(args)
    expect(store.writes).toEqual([])

    // With profiles registered, a profile-free asset forwards the 5-member custody without color_ tags.
    const viaProfiles = await receive(moduleWith(), args)
    expect(viaProfiles.outputs[0].insertionRemittance).toEqual({
      basket: assetBasket(assetId, 'value'),
      customInstructions: paid.customInstructions
    })
  })

  /** Replaces the leaf's `transactions` and re-encodes the receipt after `mined` got proofs. */
  function reshaped(
    receipt: Awaited<ReturnType<typeof attestedReceipt>>,
    transactions: Transaction[]
  ): InternalizeActionArgs {
    const leaf = { ...receipt.leaf, transactions: transactions.map(tx => tx.toHex()) }
    return withInstructions(
      { ...receipt.args, tx: receipt.tip.toAtomicBEEF() },
      JSON.stringify({
        ...receipt.custody,
        profileData: { [ATTESTED_PROFILE_ID]: { [receipt.custody.assetId]: leaf } }
      })
    )
  }

  it('takes an anchor beyond a mined hop from the leaf and stores its body', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      unattested: 1
    })
    const [A] = receipt.ancestors
    A.merklePath = MerklePath.fromCoinbaseTxidAndHeight(A.id('hex'), 100)
    const args = reshaped(receipt, [receipt.anchor, A])
    expect(Beef.fromBinary(args.tx).findTxid(receipt.anchor.id('hex'))).toBeUndefined()
    await receive(moduleWith(), args)
    expect(prompts[0]).toMatchObject({ unsettledTransactions: 2 })
    const anchor = await colorStore.getTx(receipt.anchor.id('hex'))
    expect(anchor).toMatchObject({ role: 'ancestor', rawTx: receipt.anchor.toHex(), outputs: [] })
    expect(anchor?.attestations).toHaveLength(1)
    expect((await colorStore.getTx(A.id('hex')))?.atomicBEEF).toBe(
      toHex(Beef.fromBinary(args.tx).toBinaryAtomic(A.id('hex')))
    )
  })

  it('stores an attested deploy anchor beyond a mined hop from declarationTx', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [] })
    const P = receipt.anchor
    P.merklePath = MerklePath.fromCoinbaseTxidAndHeight(P.id('hex'), 100)
    const args = withInstructions(
      { ...receipt.args, tx: receipt.tip.toAtomicBEEF() },
      JSON.stringify({
        ...receipt.custody,
        profileData: {
          [ATTESTED_PROFILE_ID]: {
            [receipt.custody.assetId]: {
              ...receipt.leaf,
              transactions: [P.toHex()],
              attestations: [{ ...(await g.attest(K, deploy, [0])) }]
            }
          }
        }
      })
    )
    // The deploy reaches the module only as the leaf's declarationTx.
    expect(Beef.fromBinary(args.tx).findTxid(deploy.id('hex'))).toBeUndefined()
    await receive(moduleWith(), args)
    expect(prompts[0]).toMatchObject({ unsettledTransactions: 2 })
    expect(await colorStore.getTx(deploy.id('hex'))).toMatchObject({
      role: 'ancestor',
      rawTx: deploy.toHex(),
      outputs: [],
      attestations: [expect.objectContaining({ txid: deploy.id('hex'), outputs: [0] })]
    })
  })

  it('a pending hop the receipt BEEF does not carry has no submit bytes', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      unattested: 2
    })
    const [B, A] = receipt.ancestors
    A.merklePath = MerklePath.fromCoinbaseTxidAndHeight(A.id('hex'), 100)
    await expect(
      receive(moduleWith(), reshaped(receipt, [receipt.anchor, B, A]))
    ).rejects.toMatchObject({
      name: 'AttestationEvidenceError',
      reason: `no submit bytes for ${B.id('hex')}`
    })
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  /**
   * One transaction paying the bench wallet 1000 of each of two identity-mode attested assets,
   * spending their attested deploys, with a receipt and attested leaf per asset.
   */
  async function twoAssetReceipt(): Promise<{ args: InternalizeActionArgs; tip: Transaction }> {
    const assets = [attestedAsset(g, SIGNER), attestedAsset(g, SIGNER)]
    const custodies = assets.map(({ assetId }) => ({
      version: 1 as const,
      assetId,
      derivationPrefix: remittanceString(),
      derivationSuffix: remittanceString(),
      senderIdentityKey: g.owner.toPublicKey().toString()
    }))
    const outputs = await Promise.all(
      custodies.map(async custody => {
        const { publicKey } = await new ProtoWallet(g.owner).getPublicKey({
          protocolID: colorProtocolID(
            custody.assetId,
            custody.derivationPrefix,
            custody.derivationSuffix
          ),
          keyID: COLOR_KEY_ID,
          counterparty: wallet.identityKey
        })
        return {
          lockingScript: new OneColor().lock(
            custody.assetId,
            1000n,
            hash160(toArray(publicKey, 'hex'))
          )
        }
      })
    )
    const tip = await g.spend(
      assets.map(({ tx }) => ({ tx, vout: 0 })),
      outputs
    )
    const args: InternalizeActionArgs = {
      tx: tip.toAtomicBEEF(),
      description: 'Receive tokens',
      outputs: await Promise.all(
        assets.map(async ({ tx, assetId }, index) => ({
          outputIndex: index,
          protocol: 'basket insertion' as const,
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: JSON.stringify({
              ...custodies[index],
              profileData: {
                [ATTESTED_PROFILE_ID]: {
                  [assetId]: {
                    declarationTx: tx.toHex(),
                    transactions: [],
                    attestations: [{ ...(await signAttestation(K, assetId, tx.id('hex'), [0])) }],
                    submissions: [{ txid: tip.id('hex'), offChainValues: '' }]
                  }
                }
              }
            })
          }
        }))
      )
    }
    return { args, tip }
  }

  it('a receipt transaction carries one attested asset: its records are per transaction', async () => {
    const { args } = await twoAssetReceipt()
    await expect(receive(moduleWith(), args)).rejects.toMatchObject({
      name: 'ProfileParamsError',
      message: expect.stringMatching(/one attested asset/)
    })
    expect(prompts).toEqual([])
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
  })

  it('a receipt never merges into a stored record of another asset', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const txid = receipt.tip.id('hex')
    const other = `${'cd'.repeat(32)}_0`
    await colorStore.putTx(txid, {
      v: 1,
      assetId: other,
      rawTx: receipt.tip.toHex(),
      atomicBEEF: toHex(receipt.tip.toAtomicBEEF()),
      role: 'receipt',
      state: 'credited',
      inputs: [],
      outputs: [1],
      offChainValues: '',
      attestations: []
    })
    const writes = store.writes.length
    await expect(receive(moduleWith(), receipt.args)).rejects.toMatchObject({
      name: 'ProfileParamsError',
      message: expect.stringMatching(/another asset/)
    })
    expect(prompts).toEqual([])
    expect(store.writes.slice(writes).filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
    expect((await colorStore.getTx(txid))?.assetId).toBe(other)
  })

  it('two receipts of one asset must carry the same evidence', async () => {
    const { tx: deploy } = attestedAsset(g, SIGNER)
    const receipt = await attestedReceipt({ g, deploy, recipient: wallet, signers: [K] })
    const [output] = receipt.args.outputs
    const altered = JSON.parse(output.insertionRemittance!.customInstructions!) as {
      profileData: Record<string, Record<string, { submissions: unknown[] }>>
    }
    altered.profileData[ATTESTED_PROFILE_ID][receipt.custody.assetId].submissions = []
    const args: InternalizeActionArgs = {
      ...receipt.args,
      outputs: [
        output,
        {
          ...output,
          insertionRemittance: {
            ...output.insertionRemittance!,
            customInstructions: JSON.stringify(altered)
          }
        }
      ]
    }
    await expect(receive(moduleWith(), args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError',
      reason: 'receipts of one asset carry different evidence'
    })
  })

  it('applies the base receipt checks with profiles registered', async () => {
    const ex = exampleProfile()
    const { tx: deployTx, assetId } = fixtureDeploy(A141A.C)
    provider.admit(assetId, deployTx, 0)
    const paid = await tokenPayment(new FakeWallet(), wallet, assetId, 40n)
    const module = moduleWith({ profiles: { [ex.id]: ex } })
    const base: InternalizeActionArgs = {
      tx: paid.tx.toAtomicBEEF(),
      description: 'Receive tokens',
      outputs: [
        {
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: paid.customInstructions
          }
        }
      ]
    }
    const variant = (
      output: Partial<InternalizeActionArgs['outputs'][number]>
    ): InternalizeActionArgs => ({ ...base, outputs: [{ ...base.outputs[0], ...output }] })
    // Not admitted: an asset without the attested profile needs current spendability.
    await expect(receive(module, base)).rejects.toThrow('not admitted and unspent')
    provider.admit(assetId, paid.tx, 0)
    await expect(receive(module, variant({ outputIndex: 3 }))).rejects.toThrow(
      'names a missing output'
    )
    await expect(
      receive(
        module,
        variant({
          insertionRemittance: {
            basket: assetBasket(assetId, 'authority'),
            customInstructions: paid.customInstructions
          }
        })
      )
    ).rejects.toThrow('basket does not match')
    await expect(
      receive(
        module,
        variant({
          insertionRemittance: {
            basket: 'p color assets',
            customInstructions: paid.customInstructions
          }
        })
      )
    ).rejects.toThrow('per-asset value or authority basket')
    const otherId = `${'cd'.repeat(32)}_0`
    await expect(
      receive(
        module,
        variant({
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: JSON.stringify({
              ...(JSON.parse(paid.customInstructions) as object),
              profileData: { [ex.id]: { [otherId]: { revision: 1 } } }
            })
          }
        })
      )
    ).rejects.toMatchObject({
      name: 'ProfileDataError',
      message: '[ProfileDataError] BRC-207: profile data names an asset the receipt does not carry'
    })
    await expect(
      receive(
        module,
        variant({
          insertionRemittance: {
            basket: assetBasket(assetId, 'value'),
            customInstructions: JSON.stringify({
              ...(JSON.parse(paid.customInstructions) as object),
              assetId: otherId
            })
          }
        })
      )
    ).rejects.toThrow('name a different asset than the output')
    await expect(receive(module, base)).resolves.toBeDefined()
  })
})

describe('admitReceipt', () => {
  let wallet: FakeWallet
  let fallback: FakeProvider
  let ap: AttestingProvider
  let store: FakeStore
  let colorStore: ColorStore
  let g: GraphBuilder
  let prompts: Array<Record<string, unknown>>
  let walletCalls: number[]
  let graphs: ReceiptGraph[]
  let contexts: ProfileAssetContext[]

  function issuerModule(handler?: RequiredProfileHandler): TestModule {
    const attested = createAttestedProfile()
    const issuer =
      handler ??
      issuerLikeProfile({
        K: SIGNER,
        provider: ap,
        onAdmit: (ctx, graph) => {
          contexts.push(ctx)
          graphs.push(graph)
        }
      })
    return new TestModule({
      wallet: wallet.asWallet(),
      provider: fallback,
      requestTokenAccess: async (_app, message) => {
        prompts.push(JSON.parse(message) as Record<string, unknown>)
        return true
      },
      profiles: { [attested.id]: attested, [issuer.id]: issuer },
      store
    })
  }

  async function receive(
    module: ColorPermissionModule,
    args: InternalizeActionArgs
  ): Promise<InternalizeActionArgs> {
    const { args: forwarded } = await module.onRequest({
      method: 'internalizeAction',
      args,
      originator: APP
    })
    walletCalls.push(store.writes.length)
    await wallet.internalizeAction(forwarded as InternalizeActionArgs)
    return forwarded as InternalizeActionArgs
  }

  /** An issuer-like asset (attested identity K + the issuer-like profile) and a receipt of it. */
  async function issuerReceipt(
    options: { attestTip?: boolean; tipOffChainValues?: string; unattested?: number } = {}
  ): Promise<AttestedReceipt & { assetId: string }> {
    const { tx: deploy, assetId } = g.deploy(1000n, issuerLikePayload(SIGNER))
    const receipt = await attestedReceipt({
      g,
      deploy,
      recipient: wallet,
      signers: [K],
      tipOffChainValues: 'e0',
      ...options
    })
    return { ...receipt, assetId }
  }

  const nothingStored = (): void => {
    expect(store.writes.filter(key => key.startsWith('color.v1.tx.'))).toEqual([])
    expect(store.writes.filter(key => key.startsWith('color.v1.settled.'))).toEqual([])
    expect(walletCalls).toEqual([])
    expect(wallet.outputs.size).toBe(0)
  }

  beforeEach(() => {
    wallet = new FakeWallet()
    fallback = new FakeProvider()
    ap = new AttestingProvider()
    store = new FakeStore()
    colorStore = new ColorStore(store)
    g = graph()
    prompts = []
    walletCalls = []
    graphs = []
    contexts = []
  })

  it('admitReceipt: admitted ⇒ verified attestation covers the tip ⇒ settled credit, no offline tag', async () => {
    const receipt = await issuerReceipt()
    const tip = receipt.tip.id('hex')
    const forwarded = await receive(issuerModule(), receipt.args)
    expect(graphs).toHaveLength(1)
    expect(graphs[0].pending.map(entry => entry.txid)).toEqual([tip])
    expect(ap.submissions.map(entry => entry.txid)).toEqual([tip])
    expect(prompts).toEqual([])
    expect(await colorStore.settled(tip)).toEqual({ outputs: [0], signer: SIGNER })
    expect(store.writes.indexOf(`color.v1.settled.${tip}`)).toBeGreaterThan(
      store.writes.indexOf(txKey(tip))
    )
    expect(store.writes.indexOf(`color.v1.settled.${tip}`)).toBeLessThan(walletCalls[0])
    const record = await colorStore.getTx(tip)
    expect(record?.attestations).toEqual([
      expect.objectContaining({ txid: tip, outputs: [0], signer: SIGNER })
    ])
    expect(forwarded.outputs[0].insertionRemittance?.tags).toBeUndefined()
    expect(forwarded.outputs[0].insertionRemittance?.customInstructions).toBe(
      JSON.stringify(receipt.custody)
    )
    // Routed: the default provider is never asked.
    expect(fallback.calls).toEqual({ spendability: 0, admission: 0, submit: 0 })
  })

  it('admitReceipt runs for an attested tip', async () => {
    const receipt = await issuerReceipt({ attestTip: true, tipOffChainValues: 'beef01' })
    const tip = receipt.tip.id('hex')
    await receive(issuerModule(), receipt.args)
    expect(graphs).toHaveLength(1)
    expect(graphs[0].pending).toEqual([])
    expect(graphs[0].tip).toEqual({
      txid: tip,
      atomicBEEF: [...receipt.args.tx],
      offChainValues: [0xbe, 0xef, 0x01]
    })
    expect(graphs[0].outputIndexes).toEqual([0])
    expect(ap.submitted).toEqual([
      {
        topics: [`tm_color_${receipt.assetId}`],
        beef: [...receipt.args.tx],
        offChainValues: [0xbe, 0xef, 0x01]
      }
    ])
    expect(prompts).toEqual([])
    expect(await colorStore.settled(tip)).toEqual({ outputs: [0], signer: SIGNER })
  })

  it('admitReceipt runs before the coverage decision even when the hook refuses an attested tip', async () => {
    const receipt = await issuerReceipt({ attestTip: true })
    ap.refuse('ERR_FROZEN', true)
    await expect(receive(issuerModule(), receipt.args)).rejects.toMatchObject({
      name: 'ColorProviderError',
      code: 'ERR_FROZEN'
    })
    expect(ap.submitted).toHaveLength(1)
    expect(prompts).toEqual([])
    nothingStored()
  })

  it('admitReceipt unavailable ⇒ offline credit with consent', async () => {
    const receipt = await issuerReceipt({ unattested: 1 })
    const tip = receipt.tip.id('hex')
    ap.failTransport()
    const forwarded = await receive(issuerModule(), receipt.args)
    // The hook ran: the first pending submit failed on transport.
    expect(ap.submitted).toHaveLength(1)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({
      type: 'color_receive_offline',
      assetId: receipt.assetId,
      outputs: [{ outputIndex: 0, amount: '600' }],
      unsettledTransactions: 2,
      signer: SIGNER,
      seekPermission: true
    })
    expect([...(prompts[0].profiles as string[])].sort()).toEqual(
      [ATTESTED_PROFILE_ID, ISSUER_LIKE_ID].sort()
    )
    expect(forwarded.outputs[0].insertionRemittance?.tags).toEqual(['color_offline'])
    expect(await colorStore.getTx(tip)).toMatchObject({ role: 'receipt', state: 'staged' })
    expect(await colorStore.settled(tip)).toBeUndefined()
    expect(store.writes.indexOf(txKey(tip))).toBeLessThan(walletCalls[0])
  })

  it('admitReceipt unavailable for a tip the leaf attests credits it from the leaf (D7)', async () => {
    const receipt = await issuerReceipt({ attestTip: true })
    ap.failTransport()
    const forwarded = await receive(issuerModule(), receipt.args)
    expect(ap.submitted).toHaveLength(1)
    expect(prompts).toEqual([])
    expect(await colorStore.settled(receipt.tip.id('hex'))).toEqual({
      outputs: [0],
      signer: SIGNER
    })
    expect(forwarded.outputs[0].insertionRemittance?.tags).toBeUndefined()
  })

  it('admitReceipt: a typed verdict thrown by the handler ⇒ no credit, nothing stored', async () => {
    const receipt = await issuerReceipt()
    const handler: RequiredProfileHandler = {
      ...issuerLikeProfile({ K: SIGNER, provider: ap }),
      admitReceipt: async () => {
        throw new ColorProviderError('ERR_FROZEN', true, false, 'the asset is frozen')
      }
    }
    await expect(receive(issuerModule(handler), receipt.args)).rejects.toMatchObject({
      name: 'ColorProviderError',
      message: '[ColorProviderError] the asset is frozen'
    })
    expect(prompts).toEqual([])
    nothingStored()
  })

  it('admitReceipt: admitted with attestations that do not cover the output ⇒ AttestationEvidenceError', async () => {
    const receipt = await issuerReceipt({ attestTip: true })
    const admitWith = (attestations: ColorAttestation[]): RequiredProfileHandler => ({
      ...issuerLikeProfile({ K: SIGNER, provider: ap }),
      admitReceipt: async () => ({ status: 'admitted', attestations })
    })
    // A verifying statement over another output of the tip covers nothing that was received.
    const otherOutput = await g.attest(K, receipt.tip, [1])
    await expect(
      receive(issuerModule(admitWith([otherOutput])), receipt.args)
    ).rejects.toMatchObject({ name: 'AttestationEvidenceError' })
    // No attestations at all, even though the leaf attests the tip.
    await expect(receive(issuerModule(admitWith([])), receipt.args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError'
    })
    // A signer the asset does not trust.
    const stranger = await g.attest(new PrivateKey(9), receipt.tip, [0])
    await expect(receive(issuerModule(admitWith([stranger])), receipt.args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError'
    })
    // A statement that does not verify.
    const good = await g.attest(K, receipt.tip, [0])
    const forged = { ...good, signature: (await g.attest(K, receipt.anchor, [0])).signature }
    await expect(receive(issuerModule(admitWith([forged])), receipt.args)).rejects.toMatchObject({
      name: 'AttestationEvidenceError'
    })
    // A malformed attestation.
    const malformed = { ...good, extra: 1 } as unknown as ColorAttestation
    await expect(receive(issuerModule(admitWith([malformed])), receipt.args)).rejects.toMatchObject(
      { name: 'AttestationEvidenceError' }
    )
    expect(prompts).toEqual([])
    nothingStored()
  })

  it('admitReceipt: a handler answering neither admitted nor unavailable fails', async () => {
    const receipt = await issuerReceipt()
    const handler: RequiredProfileHandler = {
      ...issuerLikeProfile({ K: SIGNER, provider: ap }),
      admitReceipt: async () => ({ status: 'maybe' }) as unknown as ReceiptAdmission
    }
    await expect(receive(issuerModule(handler), receipt.args)).rejects.toMatchObject({
      name: 'ProfileDataError'
    })
    nothingStored()
  })

  it('admitReceipt: admitted with a high-S attestation is accepted (BSV Chronicle)', async () => {
    const receipt = await issuerReceipt()
    const tip = receipt.tip.id('hex')
    ap.highS = true
    await receive(issuerModule(), receipt.args)
    expect(await colorStore.settled(tip)).toEqual({ outputs: [0], signer: SIGNER })
    const [stored] = (await colorStore.getTx(tip))!.attestations
    const s = Signature.fromDER(stored.signature, 'hex').s
    expect(s.gt(new Curve().n.ushrn(1))).toBe(true)
    // Kept verbatim, never normalized.
    expect(Signature.fromDER(stored.signature, 'hex').toDER('hex')).toBe(stored.signature)
  })

  it('admitReceipt: C42 a companion requiring off-chain values rejects empty submissions', async () => {
    const receipt = await issuerReceipt({ tipOffChainValues: '' })
    const handler = issuerLikeProfile({ K: SIGNER, provider: ap, requireOffChain: true })
    await expect(receive(issuerModule(handler), receipt.args)).rejects.toMatchObject({
      name: 'ProfileDataError'
    })
    expect(ap.submitted).toEqual([])
    nothingStored()
  })

  it('admitReceipt: handler hooks receive the underlying wallet and identity key in ctx', async () => {
    const receipt = await issuerReceipt()
    await receive(issuerModule(), receipt.args)
    expect(contexts).toHaveLength(1)
    const [ctx] = contexts
    expect(ctx.wallet).toBe(wallet.asWallet())
    expect(ctx.identityKey).toBe(wallet.identityKey)
    expect(ctx.originator).toBe(APP)
    expect(ctx.assetId).toBe(receipt.assetId)
    expect(ctx.profileId).toBe(ISSUER_LIKE_ID)
    expect(ctx.descriptor).toEqual({ version: 1, params: { identityKey: SIGNER } })
    expect([...ctx.req.keys()].sort()).toEqual([ATTESTED_PROFILE_ID, ISSUER_LIKE_ID].sort())
    expect(ctx.declarationTx.id('hex')).toBe(receipt.assetId.split('_')[0])
  })

  it('admitReceipt requires the attested profile at resolution', async () => {
    const ex = exampleProfile()
    const { tx: deployTx, assetId } = fixtureDeploy(A141A.C)
    fallback.admit(assetId, deployTx, 0)
    const admitting: RequiredProfileHandler = {
      ...ex,
      admitReceipt: async () => ({ status: 'unavailable' })
    }
    const module = new TestModule({
      wallet: wallet.asWallet(),
      provider: fallback,
      requestTokenAccess: async () => true,
      profiles: { [ex.id]: admitting },
      store
    })
    await expect(module.resolveAssetForTest(assetId)).rejects.toMatchObject({
      name: 'ProfileParamsError',
      message: '[ProfileParamsError] BRC-207: admitReceipt requires the attested profile'
    })
  })
})
