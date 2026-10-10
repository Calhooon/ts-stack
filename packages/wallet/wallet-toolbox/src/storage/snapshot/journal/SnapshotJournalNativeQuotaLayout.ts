import type { Knex } from 'knex'
import { isOwnedNativeSqlite } from '../../schema/ownedNativeSqliteRuntimeNode'
import { WERR_INVALID_OPERATION } from '../../../sdk/WERR_errors'
import { snapshotJournalSharedQuotaTriggers, SNAPSHOT_JOURNAL_SHARED_QUOTA } from './SnapshotJournalSharedQuota'
import { nativeQuotaDispatchDdl, nativeQuotaDispatchTriggers } from './SnapshotJournalNativeQuotaSql'

/** Choose from complete freshly observed definitions. Existing native layouts
 * are never converted. Every remaining definition must belong to one layout;
 * subsequent complete installation/erasure validation retains its own scope. */
export async function snapshotJournalQuotaLayout(k: Knex, ddl: readonly string[]) {
  const historical = snapshotJournalSharedQuotaTriggers(k, ddl)
  if (!isOwnedNativeSqlite(k)) return { ddl, triggers: historical, dispatch: [] as readonly string[] }
  const reduced = nativeQuotaDispatchTriggers(ddl)
  const expected = (sql: readonly string[]) =>
    new Map(
      sql.map(value => {
        const match = /^CREATE (TRIGGER|VIEW) (\w+)/.exec(value)
        if (match === null) throw new WERR_INVALID_OPERATION('Invalid native quota definition')
        return [match[2], { type: match[1].toLowerCase(), sql: value }]
      })
    )
  const old = expected(historical.map(trigger => trigger.sql))
  const current = expected([...reduced.map(trigger => trigger.sql), ...nativeQuotaDispatchDdl])
  const prefix = 'snapshot_reconciliation_quota_'
  const actual: Array<{ name: unknown; type: unknown; sql: unknown }> = await k('sqlite_schema')
    .whereRaw('lower(substr(name,1,?))=?', [prefix.length, prefix])
    .select(
      'name',
      'type',
      k.raw("CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql ELSE 0 END AS sql")
    )
    .limit(current.size + 1)
  let oldPresent = false
  let currentPresent = false
  for (const row of actual) {
    const legacy = typeof row.name === 'string' ? old.get(row.name) : undefined
    const compact = typeof row.name === 'string' ? current.get(row.name) : undefined
    if (legacy !== undefined && legacy.type === row.type && legacy.sql === row.sql) oldPresent = true
    else if (compact !== undefined && compact.type === row.type && compact.sql === row.sql) currentPresent = true
    else throw new WERR_INVALID_OPERATION('Shared journal quota differs from its owned source')
  }
  if (oldPresent && currentPresent) throw new WERR_INVALID_OPERATION('Mixed native quota definitions')
  if (!oldPresent && !currentPresent) {
    // Absence of observers cannot reclassify an occupied historical counter.
    // A fresh native installation chooses dispatch before creating any tables.
    const counter = await k('sqlite_schema').where({ type: 'table', name: SNAPSHOT_JOURNAL_SHARED_QUOTA }).first('name')
    oldPresent = counter !== undefined
  }
  if (!oldPresent) {
    // A historical qualified executable lacks the guarded dispatch. It cannot
    // acquire this layout merely because the newer TypeScript source exists.
    // Check the genuine current kernel on every selection, never cache it.
    const protocol: Array<{ protocol: unknown }> = await k.raw('SELECT brc38_shared_quota_event_protocol() AS protocol')
    if (protocol.length !== 1 || protocol[0].protocol !== 'brc38-shared-quota-event/v1')
      throw new WERR_INVALID_OPERATION('Native shared quota dispatch requires its guarded kernel')
  }
  if (oldPresent) return { ddl, triggers: historical, dispatch: [] as readonly string[] }
  return {
    ddl,
    triggers: reduced,
    dispatch: nativeQuotaDispatchDdl
  }
}
