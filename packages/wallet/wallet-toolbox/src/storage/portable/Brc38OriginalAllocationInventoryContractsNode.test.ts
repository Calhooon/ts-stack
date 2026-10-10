import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { semanticStageFixture } from './Brc38SemanticStageFixture'
import { restorePortableProof, restoreProofFixture } from '../../../test/utils/Brc38ImportEntityRestoreFixture'
import {
  authenticatedStageOptions,
  authenticatedStagePassword,
  encrypted
} from './Brc38AuthenticatedPrivateStageFixture'
import { stageAuthenticatedBrc39PrivateImport } from './Brc38AuthenticatedPrivateStageNode'
import { Brc38StagingAdmissionNode } from './Brc38StagingAdmissionNode'
import { Brc38PrivateNativeRestoreNode } from './Brc38PrivateNativeRestoreNode'
import { Brc38WorkingAllocation } from './Brc38WorkingAllocation'
import type { Brc38PrivateStructuredRestoreResources } from './Brc38StructuredRestoreResourcesNode'
import { verifyOriginal64KiBNativeInventoryOracle } from './Brc38StreamedNativeInventoryNode.case'
import { withBrc38KnexImportReadDestination } from './Brc38KnexDestinationFence'
import { StorageKnex } from '../StorageKnex'
import { StorageProvider } from '../StorageProvider'
import { previewReceiptPolicy } from './Brc38ImportPreviewFixture'

// UNRUN. The original row/working allowance is65536 at authentication, native
// handoff, restore and inventory. No enlarged stage or reissued admission can
// stand in for this fixture. Output, disk/index and crypto allocations have
// their separate original finite contracts and are not RSS qualification.
test.each([64, 256, 1024] as const)(
  'complete all13 native inventory retains its original64KiB allowance at %i-byte transfers',
  async width => {
    const directory = await mkdtemp(join(tmpdir(), 'brc38-original-allocation-')),
      data = semanticStageFixture(),
      proof = restoreProofFixture(),
      workingAllocation = new Brc38WorkingAllocation(65536),
      expiresAt = Date.now() + 180000,
      deadline = performance.now() + 180000,
      closes: Array<() => Promise<void>> = []
    let failed = false,
      failure: unknown
    const close = async (): Promise<void> => {
        while (closes.length !== 0) {
          await closes[closes.length - 1]()
          closes.pop()
        }
        await rm(directory, { recursive: true, force: true })
      },
      check = (): void => {
        if (Date.now() >= expiresAt || performance.now() >= deadline)
          throw new Error('Original allocation fixture exceeded its original lifetime')
      }
    try {
      restorePortableProof(data, proof)
      const rawTx = Buffer.from(proof.tx.toBinary()).toString('base64')
      data.tables.provenTxReqs[0].rawTx = data.tables.transactions[0].rawTx = rawTx
      data.tables.outputs[0].lockingScript = Buffer.from(proof.tx.outputs[0].lockingScript.toBinary()).toString(
        'base64'
      )
      data.tables.commissions[0].lockingScript = 'UQ=='
      // Nine numeric import entities; archived syncStates and three composite
      // families are original provenance, not additional numeric mappings.
      const expected = {
          rows: 14,
          mappedIds: 9,
          tableCounts: {
            provenTxs: 1,
            outputBaskets: 1,
            outputTags: 1,
            txLabels: 1,
            transactions: 1,
            outputs: 1,
            txLabelMaps: 1,
            outputTagMaps: 1,
            certificates: 1,
            certificateFields: 1,
            commissions: 1,
            provenTxReqs: 1,
            syncStates: 1
          },
          binaryBytes:
            3 * proof.tx.toBinary().length +
            proof.path.toBinary().length +
            proof.tx.outputs[0].lockingScript.toBinary().length +
            1
        },
        resources: Brc38PrivateStructuredRestoreResources = {
          sourcePolicy: {
            privateIndexParent: directory,
            maximumTemporaryIndexBytes: 1048576,
            maximumIndexMembers: 128,
            maximumStructuredBytes: 65536,
            maximumCanonicalBytes: 65536,
            maximumReadBytes: width,
            maximumIndexAllocationBytes: 4096,
            maximumGrammarAllocationBytes: 4096,
            workingAllocation
          },
          projectionPolicy: {
            privateParent: directory,
            maximumTemporaryFileBytes: 2097152,
            maximumMembers: 128,
            maximumOutputBytes: 65536,
            maximumScalarBytes: 4096,
            maximumReadBytes: width,
            maximumIndexAllocationBytes: 4096,
            maximumGrammarAllocationBytes: 4096,
            expiresAt,
            workingAllocation
          },
          maximumCombinedTemporaryBytes: 3145728
        },
        bytes = await encrypted(data),
        original = authenticatedStageOptions(bytes),
        selected = {
          ...original,
          limits: { ...original.limits, maximumPhysicalBytes: 16777216, maximumRowAllocationBytes: 65536, expiresAt },
          streamedFields: { maximumBinaryBytes: 65536, maximumChunkBytes: width },
          streamedTextFields: { maximumTextBytes: 65536, maximumChunkBytes: width },
          streamedStructuredFields: {
            fields: { maximumStructuredBytes: 65536, maximumChunkBytes: width },
            staging: resources.sourcePolicy
          }
        },
        root = await Brc38StagingAdmissionNode.create(directory, {
          maximumImports: 1,
          maximumPhysicalBytes: 19922944,
          maximumLogicalBytes: 1048576
        })
      closes.push(async () => await root.close())
      async function* chunks(): AsyncGenerator<Uint8Array> {
        for (let offset = 0; offset < bytes.length; offset += 137) {
          check()
          yield bytes.slice(offset, offset + 137)
        }
      }
      const staged = await stageAuthenticatedBrc39PrivateImport(chunks(), authenticatedStagePassword, root, selected)
      closes.push(async () => await staged.reservation.store.close())
      await staged.reservation.store.close()
      const native = await root.resumeNative(
          staged.reservation.id,
          selected.limits,
          selected.binding,
          '/work/native-contract'
        ),
        store = native.store
      closes.push(async () => await store.close())
      const restore = await Brc38PrivateNativeRestoreNode.openStructured(store, {
        receiptPolicy: previewReceiptPolicy,
        maximumStepRows: 1,
        maximumStepBytes: 65536,
        maximumMappedIds: 1000,
        maximumJournalLogicalBytes: 516096,
        services: proof.services,
        structuredResources: resources
      })
      closes.push(async () => await restore.close())
      let status = await restore.status()
      for (let operations = 0; status.state !== 'COMPLETE' && operations < 128; operations++) {
        check()
        status = await restore.step(status.nextRow)
      }
      expect(status.state).toBe('COMPLETE')
      const storage = new StorageKnex({
        ...StorageProvider.createStorageBaseOptions(selected.binding.chain),
        knex: store.knex,
        snapshotSync: false
      })
      storage.setServices(proof.services)
      await store.withAuthenticatedPrivateStructuredDestination(async () => {
        await storage.makeAvailable()
        await withBrc38KnexImportReadDestination(
          storage,
          { ...selected.binding, mode: 'restore' },
          previewReceiptPolicy,
          async trx =>
            await verifyOriginal64KiBNativeInventoryOracle(
              trx,
              restore.admission,
              'private',
              { ...resources, inspectionExpiresAt: expiresAt, privateSource: store },
              expected,
              () => {
                check()
                store.assertPrivateNativeReadTransaction(trx)
              }
            )
        )
      })
      expect(store.limits.maximumRowAllocationBytes).toBe(65536)
      expect(workingAllocation.maximum).toBe(65536)
      expect(workingAllocation.used).toBe(0)
    } catch (cause) {
      failed = true
      failure = cause
    }
    try {
      await close()
    } catch (cause) {
      throw new AggregateError(
        failed ? [failure, cause] : [cause],
        'Original64KiB inventory retains original physical cleanup owners'
      )
    }
    if (failed) throw failure
  },
  30000
)
