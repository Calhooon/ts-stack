'use strict'
// Maintainer-only first-artifact source contracts in an independently controlled
// Linux worker. No candidate path argument, runtime pin, installed delivery,
// wallet admission or host enrollment. The original worker owner must attest
// isolation/resources and physically stop the worker before releasing its roots.
const {
  parseBootstrapQualificationArguments,
  bootstrapBrc38NativeCandidate,
  qualificationFailureData
} = require('./Brc38NativeQualification.cjs')
if (require.main === module) {
  Promise.resolve()
    .then(() => bootstrapBrc38NativeCandidate(parseBootstrapQualificationArguments(process.argv.slice(2))))
    .then(receipt => process.stdout.write(JSON.stringify(receipt) + '\n'))
    .catch(cause => {
      process.stderr.write(JSON.stringify(qualificationFailureData(cause)) + '\n')
      process.exitCode = 1
    })
}
