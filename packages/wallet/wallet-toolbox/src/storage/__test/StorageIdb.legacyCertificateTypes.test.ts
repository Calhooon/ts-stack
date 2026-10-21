import { randomUUID } from 'node:crypto'
import 'fake-indexeddb/auto'
import { PrivateKey, Utils } from '@bsv/sdk'
import { StorageIdb } from '../StorageIdb'
import { StorageProvider } from '../StorageProvider'
import { TableCertificateX } from '../schema/tables'

const identity = '42'.repeat(32)
const bytes = (length: number, fill: number): string =>
  Utils.toBase64(Array.from({ length }, (_, index) => (index * fill + 1) & 0xff))
const canonicalType = bytes(32, 7)
const legacyType = bytes(16, 5)
const certifier = PrivateKey.fromRandom().toPublicKey().toString()
const subject = PrivateKey.fromRandom().toPublicKey().toString()

function certificate(certificateId: number, type: string, serial: number): TableCertificateX {
  const now = new Date('2026-01-01T00:00:00Z')
  return {
    certificateId,
    created_at: now,
    updated_at: now,
    userId: 1,
    type,
    serialNumber: bytes(32, serial),
    certifier,
    subject,
    revocationOutpoint: `${'00'.repeat(32)}.0`,
    signature: '3006020101020101',
    isDeleted: false
  }
}

describe('StorageIdb certificate type filters', () => {
  test('legacyTypes excludes or isolates non-BRC-52 records for find and count', async () => {
    const storage = new StorageIdb(StorageProvider.createStorageBaseOptions('main'))
    storage.dbName = `legacy-certificate-types-${randomUUID()}`
    await storage.migrate('Legacy certificate types', identity)
    await storage.makeAvailable()
    try {
      await storage.insertCertificate(certificate(1, canonicalType, 2))
      await storage.insertCertificate(certificate(2, legacyType, 3))

      const all = await storage.findCertificates({ partial: { userId: 1 } })
      expect(all.map(c => c.type).sort()).toEqual([canonicalType, legacyType].sort())

      const compliant = await storage.findCertificates({ partial: { userId: 1 }, legacyTypes: 'exclude' })
      expect(compliant.map(c => c.type)).toEqual([canonicalType])
      expect(await storage.countCertificates({ partial: { userId: 1 }, legacyTypes: 'exclude' })).toBe(1)

      const legacy = await storage.findCertificates({ partial: { userId: 1 }, legacyTypes: 'only' })
      expect(legacy.map(c => c.type)).toEqual([legacyType])
      expect(await storage.countCertificates({ partial: { userId: 1 }, legacyTypes: 'only' })).toBe(1)
    } finally {
      await storage.destroy()
    }
  })
})
