import { MasterCertificate, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { _tu, TestWalletNoSetup } from '../../test/utils/TestUtilsWalletStorage'

/**
 * Wallet storage created before @bsv/sdk 2.8.0 can hold certificates whose
 * `type` is not the BRC-52 32 bytes. BRC-100 listings leave those records out
 * instead of failing, and the explicit recovery API lets the wallet holder
 * find and relinquish them after reissuing a compliant replacement
 * (bsv-blockchain/ts-stack#1085).
 */
describe('Wallet legacy certificate recovery', () => {
  jest.setTimeout(30000)

  const legacyType = Utils.toBase64(Array.from({ length: 16 }, (_, index) => index + 1))
  const canonicalType = Utils.toBase64(Array.from({ length: 32 }, (_, index) => index + 1))
  const serialOf = (fill: number): string => Utils.toBase64(Array.from({ length: 32 }).fill(fill) as number[])

  async function insertCertificate(
    ctx: TestWalletNoSetup,
    type: string,
    serialNumber: string,
    certifierKey: PrivateKey
  ): Promise<void> {
    const { certificateFields, masterKeyring } = await MasterCertificate.createCertificateFields(
      new ProtoWallet(certifierKey),
      ctx.identityKey,
      { name: 'Alice' }
    )
    const now = new Date()
    await ctx.activeStorage.insertCertificate({
      created_at: now,
      updated_at: now,
      certificateId: 0,
      userId: ctx.userId,
      type,
      serialNumber,
      certifier: certifierKey.toPublicKey().toString(),
      subject: ctx.identityKey,
      revocationOutpoint: `${'00'.repeat(32)}.0`,
      signature: '3006020101020101',
      isDeleted: false,
      fields: Object.keys(certificateFields).map(fieldName => ({
        created_at: now,
        updated_at: now,
        userId: ctx.userId,
        certificateId: 0,
        fieldName,
        fieldValue: certificateFields[fieldName],
        masterKey: masterKeyring[fieldName]
      }))
    })
  }

  test('listings omit a non-compliant record; the recovery API lists and relinquishes it', async () => {
    const ctx = await _tu.createSQLiteTestWallet({
      databaseName: 'legacyCertificateRecovery',
      dropAll: true
    })
    const { wallet, storage } = ctx
    try {
      const certifierKey = PrivateKey.fromRandom()
      const certifier = certifierKey.toPublicKey().toString()
      await insertCertificate(ctx, legacyType, serialOf(2), certifierKey)
      await insertCertificate(ctx, canonicalType, serialOf(3), certifierKey)

      const listed = await wallet.listCertificates({ certifiers: [], types: [] })
      expect(listed.totalCertificates).toBe(1)
      expect(listed.certificates.map(c => c.type)).toEqual([canonicalType])

      const legacy = await wallet.listLegacyCertificates()
      expect(legacy.totalCertificates).toBe(1)
      expect(legacy.certificates[0]).toMatchObject({
        type: legacyType,
        serialNumber: serialOf(2),
        certifier,
        subject: ctx.identityKey
      })
      expect(Object.keys(legacy.certificates[0].fields)).toEqual(['name'])
      expect(Object.keys(legacy.certificates[0].keyring ?? {})).toEqual(['name'])

      await expect(
        wallet.relinquishCertificate({ type: legacyType, serialNumber: serialOf(2), certifier })
      ).rejects.toThrow('exactly 32 bytes')

      await expect(
        wallet.relinquishLegacyCertificate({ type: legacyType, serialNumber: serialOf(2), certifier })
      ).resolves.toEqual({ relinquished: true })
      await expect(wallet.listLegacyCertificates()).resolves.toMatchObject({ totalCertificates: 0 })
      await expect(wallet.listCertificates({ certifiers: [], types: [] })).resolves.toMatchObject({
        totalCertificates: 1
      })
    } finally {
      await storage.destroy()
    }
  })

  test('relinquishLegacyCertificate still requires a canonical serial number and certifier', async () => {
    const ctx = await _tu.createSQLiteTestWallet({
      databaseName: 'legacyCertificateRecoveryArgs',
      dropAll: true
    })
    try {
      await expect(
        ctx.wallet.relinquishLegacyCertificate({
          type: legacyType,
          serialNumber: legacyType,
          certifier: PrivateKey.fromRandom().toPublicKey().toString()
        })
      ).rejects.toThrow('serialNumber')
    } finally {
      await ctx.storage.destroy()
    }
  })

  test('listLegacyCertificates pages and filters what an older storage server returns', async () => {
    const ctx = await _tu.createSQLiteTestWallet({
      databaseName: 'legacyCertificateRecoveryPaging',
      dropAll: true
    })
    try {
      const certifierKey = PrivateKey.fromRandom()
      const longLegacyType = Utils.toBase64(Array.from({ length: 39 }, (_, index) => index + 1))
      await insertCertificate(ctx, legacyType, serialOf(4), certifierKey)
      await insertCertificate(ctx, longLegacyType, serialOf(5), certifierKey)

      const page = await ctx.wallet.listLegacyCertificates({ limit: 1, offset: 1 })
      expect(page.totalCertificates).toBe(2)
      expect(page.certificates).toHaveLength(1)
      expect([legacyType, longLegacyType]).toContain(page.certificates[0].type)

      // A storage server that predates `legacyTypes` ignores the filter and
      // returns every record, possibly without fields; the wallet filters again.
      const now = new Date()
      const row = (certificateId: number, type: string, serialNumber: string) => ({
        certificateId,
        created_at: now,
        updated_at: now,
        userId: ctx.userId,
        type,
        serialNumber,
        certifier: certifierKey.toPublicKey().toString(),
        subject: ctx.identityKey,
        revocationOutpoint: `${'00'.repeat(32)}.0`,
        signature: '3006020101020101',
        isDeleted: false
      })
      jest
        .spyOn(ctx.wallet.storage, 'findCertificates')
        .mockResolvedValue([row(7, canonicalType, serialOf(6)), row(8, legacyType, serialOf(7))])

      const filtered = await ctx.wallet.listLegacyCertificates()
      expect(filtered.totalCertificates).toBe(1)
      expect(filtered.certificates[0]).toMatchObject({ type: legacyType, fields: {}, keyring: {} })
    } finally {
      jest.restoreAllMocks()
      await ctx.storage.destroy()
    }
  })
})
