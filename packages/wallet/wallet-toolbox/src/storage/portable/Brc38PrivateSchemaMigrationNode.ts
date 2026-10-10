import { isOwnedPrivateNativeSqlite } from '../schema/privateNativeSqliteRuntimeNode'
import type { Knex } from 'knex'
import { KnexBrc38StagingStore } from './KnexBrc38StagingStore'
import {
  KnexMigrations,
  SNAPSHOT_PROFILE_INDEX_MIGRATION,
  SNAPSHOT_RELATION_INDEX_MIGRATION,
  SNAPSHOT_CERTIFICATE_INDEX_MIGRATION,
  SNAPSHOT_GLOBAL_INDEX_MIGRATION,
  SNAPSHOT_JOURNAL_SOURCE_MIGRATION
} from '../schema/KnexMigrations'

type PrivateMigrationSource = Omit<Knex.MigrationSource<string>, 'getMigration'> & {
  getMigration: (migration: string) => ReturnType<KnexMigrations['getMigration']>
}

const transactional = new Set([
  SNAPSHOT_PROFILE_INDEX_MIGRATION,
  SNAPSHOT_RELATION_INDEX_MIGRATION,
  SNAPSHOT_CERTIFICATE_INDEX_MIGRATION,
  SNAPSHOT_GLOBAL_INDEX_MIGRATION
])

/** Internal migration source for the existing authenticated private-destination
 * lease. Each selected SQLite callback permits a transaction; its exact original
 * SQL and checks execute unchanged. The v2 generation retains its independent
 * bounded transactions, and every other migration keeps its original config.
 * This factory grants no kernel, quota, authentication or activation authority.
 * Public, existing-wallet and MySQL migration sources remain unchanged. */
export function createBrc38PrivateSchemaMigrationSource(
  store: KnexBrc38StagingStore,
  source: KnexMigrations,
  nativeJournalLast = false
): PrivateMigrationSource {
  if (!(store instanceof KnexBrc38StagingStore)) throw new Error('An actual private staging store is required')
  const database = store.knex
  if (
    (String(database.client.config.client) !== 'better-sqlite3' && !isOwnedPrivateNativeSqlite(database)) ||
    database.isTransaction
  )
    throw new Error('Private schema migration requires the original native SQLite pool')
  const assertOwned = () => KnexBrc38StagingStore.prototype.assertPrivateNativeDestination.call(store, database)
  assertOwned()
  return {
    getMigrations: async () => {
      assertOwned()
      const names = await source.getMigrations()
      // A fresh private candidate installs every optional layout BEFORE the
      // registered source seal. Keep the original migration name/ledger; this
      // ordering is explicit and never changes ordinary live migrations.
      return nativeJournalLast
        ? [
            ...names.filter(name => name !== SNAPSHOT_JOURNAL_SOURCE_MIGRATION),
            ...names.filter(name => name === SNAPSHOT_JOURNAL_SOURCE_MIGRATION)
          ]
        : names
    },
    getMigrationName: migration => source.getMigrationName(migration),
    getMigration: async migration => {
      assertOwned()
      const original = await source.getMigration(migration)
      if (nativeJournalLast && migration === SNAPSHOT_JOURNAL_SOURCE_MIGRATION) {
        const down = original.down
        return {
          ...original,
          // Knex's nontransactional Migrator passes a withUserParams clone.
          // The private journal starts its own bounded transactions on the
          // original claimed pool; the supplied facade grants no authority.
          up: async () => {
            assertOwned()
            return await original.up(database)
          },
          ...(down === undefined
            ? {}
            : {
                down: async () => {
                  assertOwned()
                  return await down(database)
                }
              })
        }
      }
      if (!transactional.has(migration)) return original
      return { ...original, config: { ...original.config, transaction: true } }
    }
  }
}
