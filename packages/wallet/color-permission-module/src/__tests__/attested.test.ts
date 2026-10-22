import { describe, expect, it, jest } from '@jest/globals'
import { LockingScript, PrivateKey, Transaction } from '@bsv/sdk'
import { toArray } from '@bsv/sdk/primitives/utils'
import { encodeStrictCbor, OneColor, readOneColorAttributes, StrictCborLink } from '@bsv/templates'
import type { StrictCborValue } from '@bsv/templates'
import { ATTESTED_PROFILE_ID } from '../attestation.js'
import {
  assertCoverage,
  createAttestedProfile,
  parseAttestedLeaf,
  parseAttestedParams,
  qualifyingSigner,
  trustSnapshot,
  TRUSTED_IDENTITIES,
  type FrontierAnchor
} from '../attested.js'
import {
  resolveRequirements,
  validateProfileHandlers,
  type AttestedParams,
  type ProfileDescriptor,
  type RequiredProfileHandler
} from '../profiles.js'
import { FakeProvider, FakeWallet } from './fixtures.js'
import { parseStrictJson, type JsonValue } from '../strictJson.js'
import {
  A141A,
  C0,
  F_REQ_HEX,
  FakeStore,
  fixtureDeploy,
  MANDALA_ISSUER_ID,
  TestModule
} from './profileFixtures.js'

const K = C0.SIGNER
const EVIDENCE = 'urn:example:evidence'
const attested = createAttestedProfile()
const req = (params: StrictCborValue): Map<string, ProfileDescriptor> =>
  new Map([[ATTESTED_PROFILE_ID, { version: 1, params }]])
type PayloadMap = Parameters<typeof encodeStrictCbor>[0]
const paramsError = expect.objectContaining({ name: 'ProfileParamsError' })

/** A handler for an id, accepting every descriptor. */
const stub = (id: string): RequiredProfileHandler => ({
  id,
  versions: [1],
  checkDescriptor: () => {}
})

/** The attributes of a payload map, as the deploy reader returns them. */
const attributesOf = (map: PayloadMap): ReturnType<typeof readOneColorAttributes> =>
  readOneColorAttributes(encodeStrictCbor(map))

/** A BRC-162 deploy whose payload is `map`, as its own one-output transaction. */
function payloadDeploy(map: PayloadMap): { tx: Transaction; assetId: string } {
  const tx = new Transaction()
  tx.addOutput({
    lockingScript: new OneColor().lock(null, 100n, Array(20).fill(0x22), encodeStrictCbor(map)),
    satoshis: 1000
  })
  return { tx, assetId: `${tx.id('hex')}_0` }
}

function moduleWith(profiles: Record<string, RequiredProfileHandler>): TestModule {
  return new TestModule({
    wallet: new FakeWallet().asWallet(),
    provider: new FakeProvider(),
    requestTokenAccess: async () => true,
    profiles,
    store: new FakeStore()
  })
}

describe('attested profile descriptor (C05, C38, C39)', () => {
  it('is the attested v1 handler with a 16 MiB receipt limit, accepted by the registry', () => {
    expect(attested.id).toBe(ATTESTED_PROFILE_ID)
    expect(attested.versions).toEqual([1])
    expect(attested.maxReceiptBytes).toBe(16_777_216)
    expect(attested.checkExt).toBeUndefined()
    expect(attested.checkReceiptData).toBeUndefined()
    expect(attested.admitReceipt).toBeUndefined()
    expect(attested.provider).toBeUndefined()
    expect(Object.isFrozen(attested)).toBe(true)
    expect(Object.isFrozen(attested.versions)).toBe(true)
    expect(
      validateProfileHandlers({ [ATTESTED_PROFILE_ID]: attested }).get(ATTESTED_PROFILE_ID)
    ).toBe(attested)
  })

  it('carries trustedIdentities under TRUSTED_IDENTITIES, also through a spread', () => {
    const trustedIdentities = async (): Promise<{ snapshot: string; identityKeys: string[] }> => ({
      snapshot: 's',
      identityKeys: [K]
    })
    const handler = createAttestedProfile({ trustedIdentities })
    const carried = (h: RequiredProfileHandler): unknown =>
      (h as unknown as Record<symbol, unknown>)[TRUSTED_IDENTITIES]
    expect(carried(handler)).toBe(trustedIdentities)
    expect(carried({ ...handler })).toBe(trustedIdentities)
    expect(carried(attested)).toBeUndefined()
    expect(TRUSTED_IDENTITIES in attested).toBe(true)
  })

  it('rejects a trustedIdentities option that is not a function', () => {
    expect(() =>
      createAttestedProfile({ trustedIdentities: 'list' as unknown as () => Promise<never> })
    ).toThrow(TypeError)
    expect(() => createAttestedProfile(null as unknown as undefined)).not.toThrow()
  })

  it('accepts {} (any), identity with a key, and evidenceProfile naming a declared companion', () => {
    expect(parseAttestedParams({})).toEqual({ trustMode: 'any' })
    expect(parseAttestedParams({ trustMode: 'identity', identityKey: K })).toEqual({
      trustMode: 'identity',
      identityKey: K
    })
    for (const trustMode of ['any', 'same', 'all'] as const) {
      expect(parseAttestedParams({ trustMode })).toEqual({ trustMode })
    }
    const nullProto = Object.assign(Object.create(null) as Record<string, StrictCborValue>, {
      trustMode: 'same'
    })
    expect(parseAttestedParams(nullProto)).toEqual({ trustMode: 'same' })
    const delegated = { evidenceProfile: EVIDENCE }
    expect(parseAttestedParams(delegated)).toEqual({ trustMode: 'any', evidenceProfile: EVIDENCE })
    const withCompanion = new Map([...req(delegated), [EVIDENCE, { version: 1, params: null }]])
    expect(() =>
      attested.checkDescriptor({ version: 1, params: delegated }, withCompanion)
    ).not.toThrow()
    expect(() => attested.checkDescriptor({ version: 1, params: {} }, req({}))).not.toThrow()
  })

  it.each([
    ['null params', null],
    ['array params', []],
    ['bytes params', new Uint8Array([1])],
    ['link params', new StrictCborLink(new Uint8Array([1]))],
    ['text params', 'any'],
    ['unknown member', { trustMode: 'any', extra: 1 }],
    ['bad mode', { trustMode: 'some' }],
    ['non-text mode', { trustMode: 1 }],
    ['identity without key', { trustMode: 'identity' }],
    ['key without identity', { trustMode: 'any', identityKey: K }],
    ['key without mode', { identityKey: K }],
    [
      'non-text key',
      { trustMode: 'identity', identityKey: toArray(K, 'hex') as unknown as string }
    ],
    ['uppercase key', { trustMode: 'identity', identityKey: K.toUpperCase() }],
    ['off-curve key', { trustMode: 'identity', identityKey: '02' + 'ff'.repeat(32) }],
    ['evidenceProfile with trustMode', { evidenceProfile: EVIDENCE, trustMode: 'any' }],
    ['evidenceProfile with identityKey', { evidenceProfile: EVIDENCE, identityKey: K }],
    ['evidenceProfile naming itself', { evidenceProfile: ATTESTED_PROFILE_ID }],
    ['evidenceProfile not a profile id', { evidenceProfile: 'not a uri' }],
    ['non-text evidenceProfile', { evidenceProfile: 7 }]
  ] as Array<[string, StrictCborValue]>)('C05/C39 rejects %s', (_, params) => {
    expect(() => attested.checkDescriptor({ version: 1, params }, req(params))).toThrow(paramsError)
    expect(() => parseAttestedParams(params)).toThrow(paramsError)
  })

  it('C39 evidenceProfile not in req fails', () => {
    const params = { evidenceProfile: EVIDENCE }
    expect(() => attested.checkDescriptor({ version: 1, params }, req(params))).toThrow(
      expect.objectContaining({
        name: 'ProfileParamsError',
        message: expect.stringMatching(/^\[ProfileParamsError\] .*evidenceProfile/)
      })
    )
  })

  it('C05 version 2 fails through the registry and its own ext entry fails', () => {
    const registry = validateProfileHandlers({ [ATTESTED_PROFILE_ID]: attested })
    const v2 = attributesOf({ req: { [ATTESTED_PROFILE_ID]: { version: 2, params: {} } } })
    expect(() => resolveRequirements(v2, registry)).toThrow(
      expect.objectContaining({ name: 'UnsupportedProfileError' })
    )
    const v1 = attributesOf({ req: { [ATTESTED_PROFILE_ID]: { version: 1, params: {} } } })
    expect(resolveRequirements(v1, registry).handlers).toHaveLength(1)
    const ext = attributesOf({
      req: { [ATTESTED_PROFILE_ID]: { version: 1, params: {} } },
      ext: { [ATTESTED_PROFILE_ID]: 1 }
    })
    expect(() => resolveRequirements(ext, registry)).toThrow(paramsError)
  })

  it('Mandala F-REQ payload resolves both profiles in canonical order', () => {
    expect(F_REQ_HEX).toHaveLength(656)
    const payload =
      'a4636465630263726571' + F_REQ_HEX + '6373796d6454555344656c6162656c6b5465737420446f6c6c6172'
    expect(payload).toHaveLength(730)
    const registry = validateProfileHandlers({
      [ATTESTED_PROFILE_ID]: attested,
      [MANDALA_ISSUER_ID]: stub(MANDALA_ISSUER_ID)
    })
    const resolved = resolveRequirements(readOneColorAttributes(toArray(payload, 'hex')), registry)
    expect(resolved.handlers.map(({ handler }) => handler.id)).toEqual([
      ATTESTED_PROFILE_ID,
      MANDALA_ISSUER_ID
    ])
    expect(parseAttestedParams(resolved.handlers[0].descriptor.params)).toEqual({
      trustMode: 'identity',
      identityKey: K
    })
  })

  it('advertises brc207-color-attested=1 only when registered', () => {
    expect(moduleWith({ [ATTESTED_PROFILE_ID]: attested }).capabilities).toEqual({
      'brc207-color': '4',
      'brc207-color-attested': '1'
    })
    expect(moduleWith({ [EVIDENCE]: stub(EVIDENCE) }).capabilities).toEqual({
      'brc207-color': '4'
    })
  })

  it('resolution sets attested from the descriptor, and leaves it unset with evidenceProfile', async () => {
    const identity = payloadDeploy({
      req: {
        [ATTESTED_PROFILE_ID]: { version: 1, params: { trustMode: 'identity', identityKey: K } }
      }
    })
    const module = moduleWith({ [ATTESTED_PROFILE_ID]: attested, [EVIDENCE]: stub(EVIDENCE) })
    const a = await module.resolveAssetForTest(identity.assetId, {
      declarationTx: identity.tx.toHex()
    })
    expect(a.attested).toEqual({ trustMode: 'identity', identityKey: K })
    expect(a.maxReceiptBytes).toBe(16_777_216)

    const delegated = payloadDeploy({
      req: {
        [ATTESTED_PROFILE_ID]: { version: 1, params: { evidenceProfile: EVIDENCE } },
        [EVIDENCE]: { version: 1, params: null }
      }
    })
    const d = await module.resolveAssetForTest(delegated.assetId, {
      declarationTx: delegated.tx.toHex()
    })
    expect(d.handlers).toHaveLength(2)
    expect(d).not.toHaveProperty('attested')

    const plain = payloadDeploy({ req: { [EVIDENCE]: { version: 1, params: null } } })
    const p = await module.resolveAssetForTest(plain.assetId, { declarationTx: plain.tx.toHex() })
    expect(p).not.toHaveProperty('attested')
  })
})

describe('trust coverage', () => {
  const key = (n: number): string => new PrivateKey(n).toPublicKey().toString()
  const P = key(7001)
  const Q = key(7002)
  const R = key(7003)
  const X = `${'aa'.repeat(32)}.0`
  const Y = `${'bb'.repeat(32)}.1`
  const a = (outpoint: string, ...signers: string[]): FrontierAnchor => ({ outpoint, signers })
  const any: AttestedParams = { trustMode: 'any' }
  const same: AttestedParams = { trustMode: 'same' }
  const all: AttestedParams = { trustMode: 'all' }
  const identity: AttestedParams = { trustMode: 'identity', identityKey: R }
  const rejected = (reason: string): unknown =>
    expect.objectContaining({ name: 'AttestationEvidenceError', reason })

  it('C06 any: distributed signers pass', () =>
    expect(() => assertCoverage(any, [a(X, P), a(Y, Q)], [P, Q])).not.toThrow())
  it('C07 any: an untrusted-only anchor fails', () => {
    expect(() => assertCoverage(any, [a(X, P), a(Y, R)], [P, Q])).toThrow(
      /AttestationEvidenceError|attested evidence/
    )
    expect(() => assertCoverage(any, [a(X, P), a(Y, R)], [P, Q])).toThrow(
      rejected('anchor lacks a trusted signer') as Error
    )
  })
  it.each([any, same, all])('C08 empty snapshot fails %o', mode =>
    expect(() => assertCoverage(mode, [a(X, P)], [])).toThrow(rejected('empty trust list') as Error)
  )
  it.each([any, same, all])('a list mode without a snapshot fails %o', mode =>
    expect(() => assertCoverage(mode, [a(X, P)], undefined)).toThrow(
      rejected('trust list unavailable') as Error
    )
  )
  it('C09 same with no common signer fails', () =>
    expect(() => assertCoverage(same, [a(X, P), a(Y, Q)], [P, Q])).toThrow(
      rejected('no trusted signer covers every anchor') as Error
    ))
  it('C10 same with a common signer passes', () =>
    expect(() => assertCoverage(same, [a(X, P, Q), a(Y, P)], [P, Q])).not.toThrow())
  it('same ignores a common signer outside the snapshot', () =>
    expect(() => assertCoverage(same, [a(X, R, P), a(Y, R, Q)], [P, Q])).toThrow(
      rejected('no trusted signer covers every anchor') as Error
    ))
  it('C11 all with a missing signer fails', () =>
    expect(() => assertCoverage(all, [a(X, P, Q), a(Y, P)], [P, Q])).toThrow(
      rejected('anchor lacks a listed signer') as Error
    ))
  it('C12 all passes when every listed identity signs every anchor', () =>
    expect(() => assertCoverage(all, [a(X, P, Q), a(Y, P, Q)], [P, Q])).not.toThrow())
  it('all counts a duplicated snapshot entry once and ignores extra signers', () =>
    expect(() => assertCoverage(all, [a(X, P, Q, R)], [P, Q, P])).not.toThrow())
  it('C13 identity passes with an empty list', () => {
    expect(() => assertCoverage(identity, [a(X, R), a(Y, R)], undefined)).not.toThrow()
    expect(() => assertCoverage(identity, [a(X, R), a(Y, R)], [])).not.toThrow()
  })
  it('C14 identity rejects other signers', () => {
    expect(() => assertCoverage(identity, [a(X, P, Q)], undefined)).toThrow(
      rejected('anchor lacks the declared identity') as Error
    )
    // A listed identity does not stand in for the declared key.
    expect(() => assertCoverage(identity, [a(X, R), a(Y, P)], [P, Q, R])).toThrow(
      rejected('anchor lacks the declared identity') as Error
    )
  })
  it('C15 duplicate signatures do not inflate coverage', () =>
    expect(() => assertCoverage(all, [a(X, P, P)], [P, Q])).toThrow(
      rejected('anchor lacks a listed signer') as Error
    ))
  it.each([any, same, all, identity])('no anchors never passes vacuously %o', mode =>
    expect(() => assertCoverage(mode, [], [P, Q, R])).toThrow(rejected('no anchors') as Error)
  )

  it('malformed params fail closed', () => {
    const keyless = { trustMode: 'identity' } as AttestedParams
    expect(() => assertCoverage(keyless, [a(X, R)], undefined)).toThrow(
      rejected('anchor lacks the declared identity') as Error
    )
    const unknown = { trustMode: 'some' } as unknown as AttestedParams
    expect(() => assertCoverage(unknown, [a(X, P)], [P])).toThrow(
      rejected('unknown trust mode') as Error
    )
  })

  it('list modes without trustedIdentities fail closed; identity never calls it', async () => {
    await expect(trustSnapshot(createAttestedProfile(), any)).rejects.toMatchObject({
      name: 'AttestationEvidenceError',
      reason: 'trust list unavailable'
    })
    const spy = jest.fn(async () => ({ snapshot: 's', identityKeys: [P] }))
    await expect(
      trustSnapshot(createAttestedProfile({ trustedIdentities: spy }), identity)
    ).resolves.toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })
  it('a handler that is not the attested one has no trust list', async () =>
    await expect(trustSnapshot(stub(ATTESTED_PROFILE_ID), same)).rejects.toMatchObject({
      reason: 'trust list unavailable'
    }))
  it('the snapshot is the distinct valid keys, and survives a spread handler', async () => {
    const offCurve = '02' + 'ff'.repeat(32)
    const trustedIdentities = jest.fn(async () => ({
      snapshot: 'v7',
      identityKeys: [
        P,
        'not a key',
        Q.toUpperCase(),
        P,
        offCurve,
        R.slice(0, 64),
        42 as unknown as string
      ]
    }))
    const handler = {
      ...createAttestedProfile({ trustedIdentities }),
      provider: () => new FakeProvider()
    }
    await expect(trustSnapshot(handler, all)).resolves.toEqual({
      snapshot: 'v7',
      identityKeys: [P, Q]
    })
    expect(trustedIdentities).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['a rejecting callback', async () => await Promise.reject(new Error('locked'))],
    [
      'a throwing callback',
      () => {
        throw new Error('boom')
      }
    ],
    ['a null result', async () => null],
    ['a non-string snapshot', async () => ({ snapshot: 7, identityKeys: [] })],
    ['a non-array identityKeys', async () => ({ snapshot: 's', identityKeys: 'P' })]
  ])(
    '%s is an unavailable trust list',
    async (_, trustedIdentities) =>
      await expect(
        trustSnapshot(
          createAttestedProfile({
            trustedIdentities: trustedIdentities as unknown as () => Promise<{
              snapshot: string
              identityKeys: string[]
            }>
          }),
          any
        )
      ).rejects.toMatchObject({
        name: 'AttestationEvidenceError',
        reason: 'trust list unavailable'
      })
  )

  it('qualifyingSigner: identity ⇒ exactly the key; list ⇒ snapshot membership', () => {
    const exact = qualifyingSigner(identity, [P, Q])
    expect(exact(R)).toBe(true)
    expect(exact(P)).toBe(false)
    expect(exact(R.toUpperCase())).toBe(false)
    const listed = qualifyingSigner(same, [P, Q])
    expect([P, Q, R].map(listed)).toEqual([true, true, false])
    expect(qualifyingSigner(any, undefined)(P)).toBe(false)
    expect(qualifyingSigner(all, [])(P)).toBe(false)
  })
})

describe('attested leaf', () => {
  const deploy = fixtureDeploy(A141A.M)
  const assetId = deploy.assetId
  const declarationTx = deploy.tx.toHex()
  const first = fixtureDeploy(A141A.U).tx
  const second = fixtureDeploy(A141A.V).tx
  const firstHex = first.toHex()
  const secondHex = second.toHex()
  const tipTxid = 'cc'.repeat(32)
  const attestation = {
    txid: C0.TXID,
    outputs: [...C0.OUTPUTS],
    signer: C0.SIGNER,
    signature: C0.HIGH_S
  }
  const valid = {
    declarationTx,
    transactions: [firstHex, secondHex],
    attestations: [attestation],
    submissions: [
      { txid: first.id('hex'), offChainValues: '7b7d' },
      { txid: tipTxid, offChainValues: '' }
    ]
  }
  type Leaf = Record<string, unknown>
  /** The leaf as the strict JSON parser returns it (prototype-free objects). */
  const json = (leaf: unknown): JsonValue => parseStrictJson(JSON.stringify(leaf), 'leaf')
  const variant = (edit: (leaf: Leaf) => void): JsonValue => {
    const leaf = structuredClone(valid) as unknown as Leaf
    edit(leaf)
    return json(leaf)
  }
  const named = (fields: Record<string, string>): Error =>
    expect.objectContaining(fields) as unknown as Error
  const evidenceError = named({ name: 'AttestationEvidenceError' })

  const variants: Record<string, JsonValue> = {
    'unknown member': variant(leaf => {
      leaf.extra = 1
    }),
    'lifecycles present (not supported by 0.2.0)': variant(leaf => {
      leaf.lifecycles = []
    }),
    'declarationTx of another tx': variant(leaf => {
      leaf.declarationTx = firstHex
    }),
    'declarationTx uppercase hex': variant(leaf => {
      leaf.declarationTx = declarationTx.toUpperCase()
    }),
    'duplicate transaction body': variant(leaf => {
      leaf.transactions = [firstHex, secondHex, firstHex]
    }),
    'transaction hex with trailing bytes': variant(leaf => {
      leaf.transactions = [`${firstHex}00`]
    }),
    'attestation with an unknown member': variant(leaf => {
      leaf.attestations = [{ ...attestation, note: 'x' }]
    }),
    'submissions duplicate txid': variant(leaf => {
      leaf.submissions = [
        { txid: tipTxid, offChainValues: '' },
        { txid: tipTxid, offChainValues: '7b7d' }
      ]
    }),
    'submissions odd-length hex': variant(leaf => {
      leaf.submissions = [{ txid: tipTxid, offChainValues: '7b7' }]
    }),
    'submissions noncanonical txid': variant(leaf => {
      leaf.submissions = [{ txid: tipTxid.toUpperCase(), offChainValues: '' }]
    }),
    'a missing required member': variant(leaf => {
      delete leaf.attestations
    }),
    'a leaf that is no object': json([valid]),
    'transactions that are no array': variant(leaf => {
      leaf.transactions = firstHex
    }),
    'a truncated transaction': variant(leaf => {
      leaf.transactions = [firstHex.slice(0, -2)]
    }),
    'a transaction that is no string': variant(leaf => {
      leaf.transactions = [7]
    }),
    'declarationTx with trailing bytes': variant(leaf => {
      leaf.declarationTx = `${declarationTx}00`
    }),
    'an attestation with a non-DER signature': variant(leaf => {
      leaf.attestations = [{ ...attestation, signature: '3000' }]
    }),
    'submissions that are no array': variant(leaf => {
      leaf.submissions = { txid: tipTxid, offChainValues: '' }
    }),
    'a submission with an unknown member': variant(leaf => {
      leaf.submissions = [{ txid: tipTxid, offChainValues: '', topic: 'x' }]
    }),
    'a submission missing offChainValues': variant(leaf => {
      leaf.submissions = [{ txid: tipTxid }]
    }),
    'a submission that is no object': variant(leaf => {
      leaf.submissions = [tipTxid]
    }),
    'a submission uppercase hex': variant(leaf => {
      leaf.submissions = [{ txid: tipTxid, offChainValues: '7B7D' }]
    })
  }

  it('parses the exact carrier', () => {
    const leaf = parseAttestedLeaf(json(valid), assetId)
    expect(leaf.declarationTx).toBeInstanceOf(Transaction)
    expect(leaf.declarationTx.id('hex')).toBe(deploy.tx.id('hex'))
    expect(leaf.transactions.map(tx => tx.toHex())).toEqual([firstHex, secondHex])
    expect(leaf.attestations).toEqual([attestation])
    expect(leaf.submissions).toBeInstanceOf(Map)
    expect([...leaf.submissions.entries()]).toEqual([
      [first.id('hex'), [0x7b, 0x7d]],
      [tipTxid, []]
    ])
  })

  it('accepts a leaf with no submissions and empty arrays (an attested tip, D28)', () => {
    const leaf = parseAttestedLeaf(
      json({ declarationTx, transactions: [], attestations: [] }),
      assetId
    )
    expect(leaf.transactions).toEqual([])
    expect(leaf.attestations).toEqual([])
    expect(leaf.submissions.size).toBe(0)
  })

  it('keeps every attestation, including repeats, unverified', () => {
    const forged = { ...attestation, signature: C0.LOW_S }
    const leaf = parseAttestedLeaf(
      variant(l => {
        l.attestations = [attestation, attestation, forged]
      }),
      assetId
    )
    expect(leaf.attestations).toEqual([attestation, attestation, forged])
    expect(leaf.attestations[0]).not.toBe(leaf.attestations[1])
  })

  it.each(Object.keys(variants))('C36 rejects %s', name => {
    expect(() => parseAttestedLeaf(variants[name], assetId)).toThrow(evidenceError)
  })

  it('rejects lifecycles with the pinned reason (D28)', () => {
    expect(() =>
      parseAttestedLeaf(variants['lifecycles present (not supported by 0.2.0)'], assetId)
    ).toThrow(named({ name: 'AttestationEvidenceError', reason: 'lifecycles are not supported' }))
  })

  it('binds declarationTx to the asset id: its txid and an existing output', () => {
    const txid = deploy.tx.id('hex')
    const twoOutputs = new Transaction()
    for (const script of [A141A.M, A141A.U]) {
      twoOutputs.addOutput({ lockingScript: LockingScript.fromHex(script), satoshis: 1000 })
    }
    const twoHex = twoOutputs.toHex()
    const second = `${twoOutputs.id('hex')}_1`
    expect(
      parseAttestedLeaf(json({ ...valid, declarationTx: twoHex }), second).declarationTx.toHex()
    ).toBe(twoHex)
    expect(() => parseAttestedLeaf(json(valid), `${txid}_1`)).toThrow(evidenceError)
    expect(() => parseAttestedLeaf(json(valid), `${'00'.repeat(32)}_0`)).toThrow(evidenceError)
  })

  it('rejects ISSUE as an asset key (module-built profile deploys are unsupported in 0.2.0)', () => {
    const dataError = named({ name: 'ProfileDataError' })
    expect(() => parseAttestedLeaf(json(valid), 'ISSUE')).toThrow(dataError)
    expect(() => parseAttestedLeaf(json(valid), 'ISSUE')).toThrow(/^\[ProfileDataError\] /)
    for (const key of [`${deploy.tx.id('hex')}.0`, assetId.toUpperCase(), `${assetId}0`, '']) {
      expect(() => parseAttestedLeaf(json(valid), key)).toThrow(dataError)
    }
  })
})
