import { previewPrivateFixture } from './Brc38ImportPreviewFixture'
import { verifyBrc38PrivateNativeCandidateSchemaOrder } from './Brc38PrivateNativeCandidateSchemaNode.case'
import { restoreProofFixture } from '../../../test/utils/Brc38ImportEntityRestoreFixture'

test.each([false, true])(
  'actual private candidate seals after its selected layouts, local=%s',
  async local => {
    const fixture = await previewPrivateFixture()
    let failed = false,
      failure: unknown
    try {
      await fixture.value.reservation.store.close()
      const reservation = await fixture.root.resumeNative(
        fixture.value.reservation.id,
        fixture.selected.limits,
        fixture.selected.binding,
        '/work/native-contract'
      )
      fixture.held.push(reservation)
      const check = (): void => {
        if (Date.now() >= fixture.selected.limits.expiresAt)
          throw new Error('Candidate schema contract exceeded its original lifetime')
      }
      await verifyBrc38PrivateNativeCandidateSchemaOrder(
        reservation.store,
        {
          receiptPolicy: { receiptLimit: 7, receiptLifetimeMs: 123456 },
          maximumStepRows: 16,
          maximumStepBytes: 65536,
          maximumMappedIds: 1000,
          maximumJournalLogicalBytes: 516096,
          services: restoreProofFixture().services
        },
        local,
        check
      )
    } catch (cause) {
      failed = true
      failure = cause
    }
    try {
      await fixture.close()
    } catch (cause) {
      throw new AggregateError(
        failed ? [failure, cause] : [cause],
        'Candidate schema contract retains original cleanup owners'
      )
    }
    if (failed) throw failure
  },
  30000
)
