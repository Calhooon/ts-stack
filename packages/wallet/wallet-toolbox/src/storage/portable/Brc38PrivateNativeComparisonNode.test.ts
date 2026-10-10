import { nativeTestExecutable } from './Brc38NativeTestPath'
import { previewPrivateFixture } from './Brc38ImportPreviewFixture'

// UNRUN actual factory/kernel lifecycle cases. This small synthetic SQL table
// proves admission and physical resume only; it does not qualify an all47 merge,
// reconstructed fields, a publication copy or primary selection.
describe('actual private native comparison phase', () => {
  let fixture: Awaited<ReturnType<typeof previewPrivateFixture>> | undefined
  afterEach(async () => {
    await fixture?.close()
    fixture = undefined
  })
  async function open(streamedStructured = false) {
    fixture = streamedStructured
      ? await previewPrivateFixture(undefined, undefined, 65536, 16777216, 16777216, true)
      : await previewPrivateFixture()
    const { root, selected, value } = fixture
    await value.reservation.store.close()
    const reservation = await root.resumeNative(
      value.reservation.id,
      selected.limits,
      selected.binding,
      nativeTestExecutable()
    )
    fixture.held.push(reservation)
    const store = reservation.store
    await store.knex.raw('CREATE TABLE comparison_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
    await store.knex('comparison_probe').insert({ id: 1, value: 'original semantic data' })
    return { store, root, selected, id: reservation.id }
  }
  test('fresh negotiation needs drained writers; frozen rows and schemas cannot change and existing reads/settlement remain', async () => {
    const { store } = await open()
    await expect(store.requirePrivateNativeComparison()).rejects.toThrow('comparison phase')
    await store.knex.transaction(async writer => {
      await expect(store.beginPrivateNativeComparison()).rejects.toThrow('drained writers')
      await writer('comparison_probe').where({ id: 1 }).update({ value: 'prepared original data' })
    })
    await store.beginPrivateNativeComparison()
    await store.beginPrivateNativeComparison()
    await store.requirePrivateNativeComparison()
    const expected = [{ id: 1, value: 'prepared original data' }]
    for (const effect of [
      () => store.knex('comparison_probe').where({ id: 1 }).update({ value: 'changed' }),
      () => store.knex('comparison_probe').where({ id: 1 }).delete(),
      () => store.knex('comparison_probe').insert({ id: 2, value: 'new' }),
      () => store.knex.raw('DROP TABLE comparison_probe'),
      () => store.knex.raw('ALTER TABLE comparison_probe ADD COLUMN other TEXT'),
      () => store.knex.raw('CREATE TEMP TABLE cannot_add_schema(id INTEGER)'),
      () => store.knex.raw('PRAGMA writable_schema=ON')
    ]) {
      await expect(effect()).rejects.toMatchObject({ code: 'SQLITE_AUTH' })
      expect(await store.knex('comparison_probe').orderBy('id')).toEqual(expected)
    }
    await store.knex.transaction(async reader => {
      expect(await reader('comparison_probe').select('*')).toEqual(expected)
    })
    await store.requirePrivateNativeComparison()
  })
  test('frozen authenticated structured validation uses a drained physical query-only lease without reopening writer settings', async () => {
    const { store, selected } = await open(true)
    const stopped = new Error('Independent structured read callback completed')
    await store.beginPrivateNativeComparison()
    await store.withAuthenticatedPrivateStructuredDestination(async (header, metadata) => {
      expect(header.user.identityKey).toBe(selected.binding.identityKey)
      expect(metadata.rows).toBeGreaterThan(0)
      await store.withPrivateNativeDatabase(true, async database => {
        await database.transaction(async reader => {
          store.assertPrivateNativeReadTransaction(reader)
          expect(await reader.raw('PRAGMA query_only')).toEqual([{ query_only: 1 }])
          expect(await reader('comparison_probe').select('*')).toEqual([{ id: 1, value: 'original semantic data' }])
          await expect(reader.raw('PRAGMA query_only=OFF')).rejects.toMatchObject({ code: 'SQLITE_AUTH' })
          await expect(
            reader('comparison_probe').where({ id: 1 }).update({ value: 'not admitted' })
          ).rejects.toMatchObject({ code: 'SQLITE_AUTH' })
        })
      })
      await expect(store.knex.raw('PRAGMA query_only=OFF')).rejects.toMatchObject({ code: 'SQLITE_AUTH' })
    })
    await expect(store.withPrivateNativeDatabase(true, async () => {})).rejects.toThrow('authenticated receiver scope')
    await expect(
      store.withAuthenticatedPrivateStructuredDestination(async () => {
        throw stopped
      })
    ).rejects.toBe(stopped)
    await store.withAuthenticatedPrivateStructuredDestination(async () => {
      await store.withPrivateNativeDatabase(true, async database => {
        expect(await database('comparison_probe').select('*')).toEqual([{ id: 1, value: 'original semantic data' }])
      })
    })
    await store.requirePrivateNativeComparison()
  }, 120000)
  test('physical original-reservation resume restores a new mutable kernel without renewing the original custody or expiry', async () => {
    const { store, root, selected, id } = await open(),
      originalBinding = await store.knex('private_binding').select('*')
    await store.beginPrivateNativeComparison()
    await store.close()
    await expect(store.beginPrivateNativeComparison()).rejects.toThrow()
    const resumed = await root.resumeNative(id, selected.limits, selected.binding, nativeTestExecutable())
    fixture!.held.push(resumed)
    expect(resumed.id).toBe(id)
    expect(resumed.store.limits).toEqual(selected.limits)
    expect(await resumed.store.knex('private_binding').select('*')).toEqual(originalBinding)
    await expect(resumed.store.requirePrivateNativeComparison()).rejects.toThrow('comparison phase')
    await resumed.store.knex('comparison_probe').where({ id: 1 }).update({ value: 'next original-owner attempt' })
    expect(await resumed.store.knex('comparison_probe').select('*')).toEqual([
      { id: 1, value: 'next original-owner attempt' }
    ])
    await resumed.store.beginPrivateNativeComparison()
    await expect(
      resumed.store.knex('comparison_probe').where({ id: 1 }).update({ value: 'cannot change frozen attempt' })
    ).rejects.toMatchObject({ code: 'SQLITE_AUTH' })
  })
})
