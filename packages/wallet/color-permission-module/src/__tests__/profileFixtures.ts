import { type PrivateKey, ProtoWallet } from '@bsv/sdk'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import type { StrictCborValue } from '@bsv/templates'
import { ProfileParamsError } from '../errors.js'
import type { ColorAttestation, RequiredProfileHandler } from '../profiles.js'
import type { ColorModuleStore } from '../types.js'

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
