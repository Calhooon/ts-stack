import type { Knex } from 'knex'
import { requireBrc38ImportSqliteTransaction } from './Brc38ImportJournalSchema'
import { runInSeries } from '../../utility/runInSeries'
import { isOwnedNativeSqlite } from '../schema/ownedNativeSqliteRuntimeNode'

/** Source-owned additive indexes must be installed by migration before preview.
 * They are not an import-capability flag and never change uniqueness contracts. */
export const brc38ImportTargetIndexes = Object.freeze({
  provenTxs: ['proven_txs', ['txid']],
  outputBaskets: ['output_baskets', ['userId', 'name']],
  outputTags: ['output_tags', ['userId', 'tag']],
  txLabels: ['tx_labels', ['userId', 'label']],
  transactions: ['transactions', ['userId', 'txid']],
  transactionReference: ['transactions', ['userId', 'reference']],
  transactionReclaim: ['transactions', ['userId', 'noSendExpiryReclaimTxid']],
  outputs: ['outputs', ['userId', 'transactionId', 'vout']],
  reclaimOutput: ['outputs', ['userId', 'txid', 'vout']],
  txLabelMaps: ['tx_labels_map', ['txLabelId', 'transactionId']],
  outputTagMaps: ['output_tags_map', ['outputTagId', 'outputId']],
  certificates: ['certificates', ['userId', 'certifier', 'serialNumber']],
  certificateFields: ['certificate_fields', ['userId', 'certificateId', 'fieldName']],
  commissions: ['commissions', ['userId', 'transactionId']],
  provenTxReqs: ['proven_tx_reqs', ['txid']],
  preparedBeefReady: ['prepared_beefs', ['state', 'preparedBeefId']],
  syncStates: ['sync_states', ['userId', 'storageIdentityKey', 'storageName']]
} as const)
export type Brc38ImportTargetIndex = keyof typeof brc38ImportTargetIndexes
// Fixed addresses only: current producer membership chooses a query spelling;
// installation and operation still inspect the actual complete owned schema.
const previousNativeSourceKeys: readonly Brc38ImportTargetIndex[] = [
  'provenTxs',
  'provenTxReqs',
  'transactions',
  'transactionReclaim',
  'txLabelMaps',
  'outputTagMaps'
]
const nativeSourceIndexes: Partial<Record<Brc38ImportTargetIndex, readonly [string, boolean, readonly string[]]>> =
  Object.freeze({
    provenTxs: ['proven_txs_txid_unique', true, ['txid']],
    provenTxReqs: ['proven_tx_reqs_txid_unique', true, ['txid']],
    transactions: ['idx_transactions_user_txid', false, ['userId', 'txid']],
    transactionReclaim: ['idx_transactions_nosend_reclaim', false, ['userId', 'noSendExpiryReclaimTxid']],
    txLabelMaps: ['tx_labels_map_txlabelid_transactionid_unique', true, ['txLabelId', 'transactionId']],
    outputTagMaps: ['output_tags_map_outputtagid_outputid_unique', true, ['outputTagId', 'outputId']],
    // These are complete equality queries, never prefix/range/order queries.
    // Reordered keys remain a point lookup. Global uniqueness bounds the other
    // three before their unchanged userId residual is evaluated.
    outputBaskets: ['output_baskets_name_userid_unique', true, ['name', 'userId']],
    outputTags: ['output_tags_tag_userid_unique', true, ['tag', 'userId']],
    txLabels: ['tx_labels_label_userid_unique', true, ['label', 'userId']],
    outputs: ['outputs_transactionid_vout_userid_unique', true, ['transactionId', 'vout', 'userId']],
    transactionReference: ['transactions_reference_unique', true, ['reference']],
    certificateFields: ['certificate_fields_fieldname_certificateid_unique', true, ['fieldName', 'certificateId']],
    commissions: ['commissions_transactionid_unique', true, ['transactionId']]
  })
export function brc38ImportTargetIndexName(key: Brc38ImportTargetIndex, k?: Knex): string {
  return k !== undefined && isOwnedNativeSqlite(k) && nativeSourceIndexes[key] !== undefined
    ? nativeSourceIndexes[key]![0]
    : `brc38_import_target_${key}`
}
function statement(key: Brc38ImportTargetIndex): string {
  const [table, columns] = brc38ImportTargetIndexes[key]
  return `CREATE INDEX ${brc38ImportTargetIndexName(key)} ON ${table} (${columns.join(', ')})`
}
function invalid(): never {
  throw new Error('Private import target indexes differ from their owned source')
}
async function verifyNativeSourceIndexes(trx: Knex.Transaction): Promise<void> {
  requireBrc38ImportSqliteTransaction(trx)
  const keys = Object.keys(nativeSourceIndexes) as Brc38ImportTargetIndex[],
    names = keys.map(key => nativeSourceIndexes[key]![0]),
    tables = [...new Set(keys.map(key => brc38ImportTargetIndexes[key][0]))]
  // Unqualified INDEXED BY must never resolve a temporary shadow instead.
  if (
    (
      await trx('sqlite_temp_schema')
        .whereIn('name', [...names, ...tables])
        .select('name')
        .limit(1)
    ).length
  )
    invalid()
  const bindings: Array<string | number> = []
  const checks = keys.map(key => {
    const [name, unique, columns] = nativeSourceIndexes[key]!,
      [table] = brc38ImportTargetIndexes[key],
      source = `CREATE ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` on \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')})`
    bindings.push(name, table, source, table, name, Number(unique), name, name)
    const parts = columns.map((column, ordinal) => {
      bindings.push(ordinal, column)
      return '(seqno=? AND cid>=0 AND name=? AND "desc"=0 AND coll=\'BINARY\')'
    })
    if (unique) bindings.push(table, ...columns)
    return `SELECT
      (SELECT count(*) FROM main.sqlite_schema WHERE type='index' AND name=? AND tbl_name=? AND CAST(sql AS BLOB)=CAST(? AS BLOB)) AS definition,
      (SELECT count(*) FROM pragma_index_list(?) WHERE name=? AND "unique"=? AND origin='c' AND partial=0) AS properties,
      (SELECT count(*) FROM pragma_index_xinfo(?) WHERE "key"=1) AS width,
      (SELECT count(*) FROM pragma_index_xinfo(?) WHERE "key"=1 AND (${parts.join(' OR ')})) AS parts,
      ${columns.length} AS expected,
      ${unique ? `(SELECT count(*) FROM pragma_table_info(?) WHERE name IN (${columns.map(() => '?').join(',')}) AND "notnull"=1)` : columns.length} AS required`
  })
  // These checks share the same actual pinned writer and SQLite statement.
  // Every invocation rechecks all original SQL, uniqueness, nullability,
  // ordering, expressions, collation and shadow constraints. Only one scalar
  // crosses the native result boundary; no generation verdict is cached.
  const result: Array<{ invalid: number }> = await trx.raw(
    `SELECT count(*) AS invalid FROM (${checks.join(' UNION ALL ')}) WHERE definition<>1 OR properties<>1 OR width<>expected OR parts<>expected OR required<>expected`,
    bindings
  )
  if (result.length !== 1 || Number(result[0].invalid) !== 0) invalid()
}
async function namedIndexes(k: Knex): Promise<Array<{ name: string; sql: string; type: string }>> {
  return await k('main.sqlite_schema')
    .whereRaw('substr(name,1,20)=?', ['brc38_import_target_'])
    // These four exact names belong to the separately verified destination
    // cleanup schema. No arbitrary cleanup-prefixed object is excluded.
    .whereNotIn('name', [
      'brc38_import_target_cleanup_transactions',
      'brc38_import_target_cleanup_spentBy',
      'brc38_import_target_cleanup_baskets',
      'brc38_import_target_cleanup_certificates'
    ])
    .select(
      'type',
      k.raw('CASE WHEN length(CAST(name AS BLOB)) <= 128 THEN name ELSE NULL END AS name'),
      k.raw('CASE WHEN length(CAST(sql AS BLOB)) <= 4096 THEN sql ELSE NULL END AS sql')
    )
    .limit(18)
}
/** Fresh native layout reuses thirteen inspected source trees. Both previous
 * eleven-tree and historical seventeen-tree layouts retain their actual trees.
 * Neither partial nor foreign layouts are adopted. */
export async function brc38ImportTargetIndexStatements(k: Knex): Promise<string[]> {
  const keys = Object.keys(brc38ImportTargetIndexes) as Brc38ImportTargetIndex[]
  if (!isOwnedNativeSqlite(k)) return keys.map(statement)
  const trx = k as Knex.Transaction
  await verifyNativeSourceIndexes(trx)
  const rows = await namedIndexes(trx),
    fresh = keys.filter(key => nativeSourceIndexes[key] === undefined),
    previous = keys.filter(key => !previousNativeSourceKeys.includes(key)),
    selected = rows.length === keys.length ? keys : rows.length === previous.length ? previous : fresh,
    expected = new Map(selected.map(key => [brc38ImportTargetIndexName(key), statement(key)]))
  if (
    rows.length !== 0 &&
    (rows.length !== selected.length || rows.some(row => row.type !== 'index' || expected.get(row.name) !== row.sql))
  )
    invalid()
  return selected.map(statement)
}
export async function verifyBrc38ImportTargetIndexes(trx: Knex.Transaction): Promise<void> {
  requireBrc38ImportSqliteTransaction(trx)
  if (isOwnedNativeSqlite(trx)) {
    const ddl = await brc38ImportTargetIndexStatements(trx),
      rows = await namedIndexes(trx),
      expected = new Map(ddl.map(sql => [/^CREATE INDEX (\w+)/.exec(sql)![1], sql]))
    if (rows.length !== expected.size || rows.some(row => row.type !== 'index' || expected.get(row.name) !== row.sql))
      invalid()
    return
  }
  const keys = Object.keys(brc38ImportTargetIndexes) as Brc38ImportTargetIndex[],
    expected = new Map(keys.map(key => [brc38ImportTargetIndexName(key), statement(key)])),
    rows: Array<{ name: string; sql: string }> = await trx('sqlite_schema')
      .where({ type: 'index' })
      .whereIn('name', [...expected.keys()])
      .select(
        trx.raw('CASE WHEN length(CAST(name AS BLOB)) <= 128 THEN name ELSE NULL END AS name'),
        trx.raw('CASE WHEN length(CAST(sql AS BLOB)) <= 4096 THEN sql ELSE NULL END AS sql')
      )
      .limit(keys.length + 1)
  if (rows.length !== keys.length || rows.some(row => expected.get(row.name) !== row.sql)) invalid()
}
export async function installBrc38ImportTargetIndexes(trx: Knex.Transaction): Promise<void> {
  requireBrc38ImportSqliteTransaction(trx)
  await runInSeries(await brc38ImportTargetIndexStatements(trx), async sql => {
    await trx.raw(sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '))
  })
  await verifyBrc38ImportTargetIndexes(trx)
}
