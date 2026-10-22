import { isProfileId } from '../OneColorAttributes.js'

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
