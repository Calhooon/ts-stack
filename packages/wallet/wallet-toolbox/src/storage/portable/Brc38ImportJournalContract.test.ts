import { createHash } from 'node:crypto'
import {
  boundedJson,
  digest,
  admissionCopy,
  decodeReceipt,
  read,
  type Brc38ImportJournalAdmission
} from './Brc38ImportJournalContract'

// Authored UNRUN. Independent Node UTF-8/SHA oracle preserves the existing
// SQLite persisted digest domain when the portable implementation is selected.
test.each(['', 'ASCII receipt', 'é😀', 'x\ud800y\udc00', 'A'.repeat(4096)])(
  'portable journal SHA matches the original Node UTF-8 domain',
  text => {
    expect(digest(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  }
)
test('portable journal metadata preserves exact UTF-8 byte limits', () => {
  expect(boundedJson('é'.repeat(2047))).toBe(JSON.stringify('é'.repeat(2047)))
  expect(() => boundedJson('é'.repeat(2048))).toThrow('4096 bytes')
})
test('portable checkpoint parsing retains exact canonical bytes and actual mapping charge', () => {
  const expiresAt = Date.now() + 10000,
    admission: Brc38ImportJournalAdmission = {
      scope: {
        importId: '11111111-1111-4111-8111-111111111111',
        bindingSha256: 'a'.repeat(64),
        archiveSha256: 'b'.repeat(64),
        userId: -1
      },
      previewId: '22222222-2222-4222-8222-222222222222',
      expiresAt,
      originalLimitsJson: JSON.stringify([10, 65536, 1048576, 4096, 65536, expiresAt]),
      initialDestinationSha256: 'c'.repeat(64),
      totalRows: 2,
      maximumStepRows: 1,
      maximumStepBytes: 4096,
      maximumMappedIds: 1,
      maximumJournalLogicalBytes: 4608
    },
    copied = admissionCopy(admission),
    receipt = {
      protocol: 'brc38-destination-import/v1',
      state: 'COMMITTED',
      sequence: 1,
      nextRow: 1,
      mappedIds: 1,
      logicalBytes: 4608,
      destinationSha256: 'd'.repeat(64),
      lastStep: { fromRow: 0, rows: 1, bytes: 40, mappedIds: 1, pageSha256: 'e'.repeat(64) }
    },
    json = JSON.stringify(receipt),
    admissionJson = JSON.stringify(copied),
    row = {
      ...copied.scope,
      admissionJson,
      admissionSha256: createHash('sha256').update(admissionJson).digest('hex'),
      receiptJson: json,
      receiptSha256: createHash('sha256').update(json).digest('hex'),
      mappedIds: 1,
      maximumMappedIds: 1,
      cleanupAllowed: 0
    }
  expect(read(row, copied)).toEqual(receipt)
  expect(() => read({ ...row, mappedIds: 0 }, copied)).toThrow()
  expect(() => decodeReceipt(json.replace('"COMMITTED"', '"COMPLETE"'), copied)).toThrow()
  expect(() => decodeReceipt(json + ' ', copied)).toThrow()
  expect(admissionCopy(admission).scope.userId).toBe(-1)
})
