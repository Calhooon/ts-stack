import { LockingScript } from '@bsv/sdk/script'
import { toArray } from '@bsv/sdk/primitives/utils'
import { isProfileId, readOneColorAttributes } from '../OneColorAttributes.js'
import type { OneColorField } from '../OneColorAttributes.js'
import { encodeStrictCbor } from '../strictCbor.js'
import { OneColor } from '../OneColor.js'

const hex = (h: string): Uint8Array => Uint8Array.from(toArray(h.replace(/\s/g, ''), 'hex'))
const cbor = (m: Parameters<typeof encodeStrictCbor>[0]): number[] => encodeStrictCbor(m)
const ABSENT = { status: 'absent' }
const valid = <T>(f: OneColorField<T>): T => {
  if (f.status !== 'valid') throw new Error(`expected a valid field, got ${JSON.stringify(f)}`)
  return f.value
}

// BRC-207 A.141a deploy locking scripts (pinned 0207, "The actual deploy locking scripts are"), verbatim.
const FIXTURE = {
  U: '00596d33a163726571a1781975726e3a6578616d706c653a636f6c6f723a756e6b6e6f776ea266706172616d73f66776657273696f6e017576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  V: '00596d34a163726571a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e027576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  C: '00596d4c60a263657874a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea1687265766973696f6e0063726571a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e0175ab76a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  D: '00596d3fa263657874a1781975726e3a6578616d706c653a646973706c61793a776f726473a2636f6e65646974656d646d616e79656974656d736373796d644954454d7576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  M: '00596d06a163726571f67576a914fc63218003683dc3305d0644a52f73eb0802e5c188ac',
  X: '00596d4c8da263657874a1781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea1687265766973696f6e0063726571a2781975726e3a6578616d706c653a636f6c6f723a756e6b6e6f776ea266706172616d73f66776657273696f6e01781a75726e3a6578616d706c653a636f6c6f723a7265766973696f6ea266706172616d73f66776657273696f6e0175ab76a914fc63218003683dc3305d0644a52f73eb0802e5c188ac'
} as const
const payloadOf = (scriptHex: string): number[] | undefined =>
  OneColor.decode(LockingScript.fromHex(scriptHex)).payload

const ATTESTED = 'https://brc.dev/207/attested'
const MANDALA = 'https://github.com/bsv-blockchain/mandala/blob/master/docs/profiles/issuer-v1.md'
const MAX_ID = 'a:' + 'x'.repeat(198)
const OVER_MAX_ID = 'a:' + 'x'.repeat(199)

describe('isProfileId', () => {
  it('pins the fixture lengths (contract §4: the Mandala id is 80 bytes; 200-byte boundary)', () => {
    expect(MANDALA.length).toBe(80)
    expect(MAX_ID.length).toBe(200)
    expect(OVER_MAX_ID.length).toBe(201)
  })

  it.each([
    ATTESTED,
    MANDALA,
    'urn:example:color:revision',
    'urn:example:color:unknown',
    'a:b',
    'a+b.c-d:x',
    MAX_ID
  ])('accepts %s', id => {
    expect(isProfileId(id)).toBe(true)
  })

  it.each([
    '',
    OVER_MAX_ID,
    'Https://x',
    '1a:b',
    ':b',
    'ab',
    'a:',
    'a:b c',
    'a:b\x7f',
    'a:bé',
    'a:b\n',
    'a:\tb'
  ])('rejects %j', id => {
    expect(isProfileId(id)).toBe(false)
  })

  it('rejects non-strings at runtime', () => {
    for (const v of [undefined, null, 42, ['a:b']]) expect(isProfileId(v as never)).toBe(false)
  })
})

describe('readOneColorAttributes: payload and display fields', () => {
  const OPAQUE = {
    payload: 'opaque',
    dec: ABSENT,
    sym: ABSENT,
    icon: ABSENT,
    req: ABSENT,
    ext: ABSENT
  }

  it('classifies absent, empty and map payloads', () => {
    expect(readOneColorAttributes(undefined)).toEqual({
      payload: 'absent',
      dec: ABSENT,
      sym: ABSENT,
      icon: ABSENT,
      req: ABSENT,
      ext: ABSENT
    })
    for (const e of [[], new Uint8Array(0)]) {
      expect(readOneColorAttributes(e)).toEqual({
        payload: 'empty',
        dec: ABSENT,
        sym: ABSENT,
        icon: ABSENT,
        req: ABSENT,
        ext: ABSENT
      })
    }
    const empty = readOneColorAttributes([0xa0])
    expect(empty.payload).toBe('map')
    expect(empty.map).toEqual({})
    expect(empty.dec).toEqual(ABSENT)
    expect(empty.sym).toEqual(ABSENT)
    expect(empty.icon).toEqual(ABSENT)
    expect(readOneColorAttributes(new Uint8Array([0xa0])).payload).toBe('map')
  })

  // RF3: hostile input is opaque, never throws, no partial recovery (0207:82-87)
  it.each([
    ['uint not map', [0x01]],
    ['valid CBOR array', [0x80]],
    ['trailing bytes', [0xa0, 0x00]],
    ['duplicate keys', [...hex('a2 6164 01 6164 02')]],
    ['unsorted keys', [...hex('a2 6173 01 6164 02')]],
    ['indefinite map', [0xbf, 0xff]],
    ['entry > 255', [0xa0, 256]],
    ['negative entry', [-1]],
    ['fractional entry', [1.5]],
    ['valid map then a dec-bearing trailer', [0xa0, ...cbor({ dec: 2n })]]
  ])('%s is opaque', (_, bytes) => {
    const a = readOneColorAttributes(bytes as number[])
    expect(a).toEqual(OPAQUE)
    expect(a.map).toBeUndefined()
    expect(a.reqBytes).toBeUndefined()
  })

  it('never throws on runtime garbage', () => {
    const revoked = Proxy.revocable([] as number[], {})
    revoked.revoke()
    const throwingIterable = Object.assign([1], {
      [Symbol.iterator]: () => {
        throw new Error('boom')
      }
    })
    for (const v of [null, 'a0', '', 42, {}, [[0xa0]], revoked.proxy, throwingIterable]) {
      expect(readOneColorAttributes(v as never)).toEqual(OPAQUE)
    }
  })

  it('is deterministic: same input, same output', () => {
    const bytes = cbor({ dec: 2n, sym: 'T', icon: ['image/png', new Uint8Array([1])] })
    expect(readOneColorAttributes(bytes)).toEqual(readOneColorAttributes(Uint8Array.from(bytes)))
  })

  // dec: uint 0..18 (0162:246-252)
  it('reads dec', () => {
    expect(readOneColorAttributes(cbor({ dec: 0n })).dec).toEqual({ status: 'valid', value: 0 })
    expect(readOneColorAttributes(cbor({ dec: 18n })).dec).toEqual({ status: 'valid', value: 18 })
    expect(valid(readOneColorAttributes(cbor({ dec: 8n })).dec)).toBe(8)
    for (const bad of [
      19n,
      -1n,
      2n ** 64n - 1n,
      'two',
      null,
      true,
      new Uint8Array([2]),
      [2n],
      { v: 2n },
      2.5
    ])
      expect(readOneColorAttributes(cbor({ dec: bad })).dec.status).toBe('malformed')
  })

  it('RF1-dec: a float64 dec (2.0) is malformed, not coerced', () => {
    const a = readOneColorAttributes(hex('a1 63646563 fb4000000000000000'))
    expect(a.payload).toBe('map')
    expect(a.dec.status).toBe('malformed')
  })

  it('reads sym as any text', () => {
    expect(readOneColorAttributes(cbor({ sym: 'TUSD' })).sym).toEqual({
      status: 'valid',
      value: 'TUSD'
    })
    expect(readOneColorAttributes(cbor({ sym: '' })).sym).toEqual({ status: 'valid', value: '' })
    for (const bad of [new Uint8Array([1]), 1n, null, ['TUSD']])
      expect(readOneColorAttributes(cbor({ sym: bad })).sym.status).toBe('malformed')
  })

  // icon: exactly [text, bytes] (0162:236-240)
  it('reads icon', () => {
    const ok = readOneColorAttributes(
      cbor({ icon: ['image/png', new Uint8Array([0x89, 0x50])] })
    ).icon
    expect(ok).toEqual({
      status: 'valid',
      value: { mediaType: 'image/png', bytes: new Uint8Array([0x89, 0x50]) }
    })
    expect(valid(ok).bytes).toBeInstanceOf(Uint8Array)
    for (const bad of [
      [],
      ['image/png'],
      ['image/png', new Uint8Array([1]), 'x'],
      [new Uint8Array([1]), 'image/png'],
      ['image/png', 'notbytes'],
      'image/png',
      null,
      { mediaType: 'image/png', bytes: new Uint8Array([1]) }
    ])
      expect(readOneColorAttributes(cbor({ icon: bad as never })).icon.status).toBe('malformed')
  })

  it('a malformed display field does not affect its siblings (0207:88-93)', () => {
    const a = readOneColorAttributes(cbor({ dec: 99n, sym: 'OK', icon: 'bad' }))
    expect(a.payload).toBe('map')
    expect(a.dec.status).toBe('malformed')
    expect(a.sym).toEqual({ status: 'valid', value: 'OK' })
    expect(a.icon.status).toBe('malformed')
  })

  it('fixture D (0207 A.141a): sym ITEM, advisory keys kept in map', () => {
    const a = readOneColorAttributes(payloadOf(FIXTURE.D))
    expect(a.payload).toBe('map')
    expect(a.sym).toEqual({ status: 'valid', value: 'ITEM' })
    expect(a.dec).toEqual(ABSENT)
    expect(a.icon).toEqual(ABSENT)
    expect(Object.keys(a.map!)).toEqual(['ext', 'sym'])
  })

  it('every A.141a fixture payload decodes as a map', () => {
    for (const script of Object.values(FIXTURE))
      expect(readOneColorAttributes(payloadOf(script)).payload).toBe('map')
  })
})
