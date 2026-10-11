'use strict'
// Internal immutable build DATA shared by source preparation, candidate builders
// and packed artifacts. A supported recipe is never a host qualification,
// runtime pin, compiler/process admission or wallet capability grant.
const sqlite = Object.freeze({
  bytes: 9516284,
  sha256: '6a2805f8c1ef020a7086e62258519323cf98b219e9fe87a42065d916cfebaefc',
  version: '3.53.4',
  sourceId: '2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc'
})
const driverSources = Object.freeze([
  'native_contract.c',
  'brc38_quota.c',
  'brc38_runtime.c',
  'profile_contract.c',
  'native_driver.c',
  'shared_quota_sources.h',
  'shared_quota_contract.c',
  'cell_change_contract.c',
  'local_observer_contract.c',
  'local_pointer_projection_contract.c',
  'local_pointer_group_contract.c',
  'local_observer_names_contract.c',
  'blob_write.c',
  'blob_read.c',
  'recovery_copy.c',
  'private_stage.c',
  'private_stage_contract.c',
  'native_fixture.c',
  'range_contract.c',
  'brc38_windows_handles.c',
  'brc38_quota_windows.c',
  'brc38_runtime_windows.c',
  'runtime_contract.c'
])
const windowsAddonSources = Object.freeze(['windows_bridge.c', 'windows_image.c', 'windows_build_supervisor.c'])
const sqliteFiles = Object.freeze([
  Object.freeze({
    name: 'sqlite3.c',
    bytes: 9516284,
    sha256: '6a2805f8c1ef020a7086e62258519323cf98b219e9fe87a42065d916cfebaefc'
  }),
  Object.freeze({
    name: 'sqlite3.h',
    bytes: 690838,
    sha256: '919e7f2e8ed1d8f56ac17b412b8971c76aa5d1a879752cc6058f75e7d5910e1d'
  }),
  Object.freeze({
    name: 'sqlite3ext.h',
    bytes: 39175,
    sha256: 'ac9645e5c9ff0cf176efdd6e75cb5e98f46295d38e02db5c4d208826a39ab4be'
  })
])
const linuxFlags = Object.freeze([
  '-O2',
  '-pipe',
  '-std=c11',
  '-D_GNU_SOURCE',
  '-DSQLITE_THREADSAFE=1',
  '-DSQLITE_DEFAULT_MEMSTATUS=1',
  '-DSQLITE_DQS=0',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-I.',
  'native_driver.c',
  '-o',
  'native-candidate',
  '-lpthread',
  '-ldl',
  '-lm'
])

function unixCompilerArguments(platform, architecture) {
  if (!['linux', 'darwin'].includes(platform) || !['arm64', 'x64'].includes(architecture))
    throw new Error('Native candidate recipe requires a controlled supported Unix worker')
  // Darwin's loader functions are in libSystem; all other original flags stay.
  return Object.freeze(
    platform === 'darwin' ? linuxFlags.filter(flag => flag !== '-ldl' && flag !== '-D_GNU_SOURCE') : [...linuxFlags]
  )
}
module.exports = Object.freeze({ sqlite, sqliteFiles, driverSources, windowsAddonSources, unixCompilerArguments })
