import 'fake-indexeddb/auto'
import { verifyIdbSnapshotSyncProvenTxReqs } from './IdbSnapshotSyncProvenTxReqs.browser.case'

// Authored UNRUN emulated component case. The actual browser, complete
// frozen implementation and original qualification controller remain required.
test('occupied requests preserve legacy history, IDs, reset-only writes and durable atomic acknowledgement', async () => {
  const started = performance.now()
  await verifyIdbSnapshotSyncProvenTxReqs(Date.now() + 30000, phase =>
    console.info(`Request component ${Math.round(performance.now() - started)}ms: ${phase}`)
  )
}, 30000)
