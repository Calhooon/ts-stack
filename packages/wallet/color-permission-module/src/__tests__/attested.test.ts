import { describe, expect, it } from '@jest/globals'
import { Transaction } from '@bsv/sdk'
import { toArray } from '@bsv/sdk/primitives/utils'
import { encodeStrictCbor, OneColor, readOneColorAttributes, StrictCborLink } from '@bsv/templates'
import type { StrictCborValue } from '@bsv/templates'
import { ATTESTED_PROFILE_ID } from '../attestation.js'
import { createAttestedProfile, parseAttestedParams, TRUSTED_IDENTITIES } from '../attested.js'
import {
  resolveRequirements,
  validateProfileHandlers,
  type ProfileDescriptor,
  type RequiredProfileHandler
} from '../profiles.js'
import { FakeProvider, FakeWallet } from './fixtures.js'
import { C0, F_REQ_HEX, FakeStore, MANDALA_ISSUER_ID, TestModule } from './profileFixtures.js'

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
    expect(F_REQ_HEX.length).toBe(656)
    const payload =
      'a4636465630263726571' + F_REQ_HEX + '6373796d6454555344656c6162656c6b5465737420446f6c6c6172'
    expect(payload.length).toBe(730)
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
      'brc207-color': '5',
      'brc207-color-attested': '1'
    })
    expect(moduleWith({ [EVIDENCE]: stub(EVIDENCE) }).capabilities).toEqual({
      'brc207-color': '5'
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
