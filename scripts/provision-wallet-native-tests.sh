#!/usr/bin/env bash
# Test delivery only. Requires Linux ARM64, the frozen installation and ordinary
# wallet build. The original qualification tool never changes runtime pins.
set -euo pipefail
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then
  echo 'Native tests require the qualified Linux ARM64 worker' >&2
  exit 1
fi
repo=$(git rev-parse --show-toplevel)
base_image='node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d'
private=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ts-wallet-native-tests.XXXXXX")
chmod 700 "$private"
container="ts-wallet-native-tests-$(basename "$private")"
cleanup() {
  local result=$? remaining
  remaining=$(docker container ls --all --filter "name=^/${container}$" --format '{{.ID}}') || exit 1
  if [[ -n $remaining ]]; then
    docker rm --force "$container" >/dev/null || exit 1
  fi
  remaining=$(docker container ls --all --filter "name=^/${container}$" --format '{{.ID}}') || exit 1
  [[ -z $remaining ]] || exit 1
  exit "$result"
}
trap cleanup EXIT
if [[ -n ${TS_STACK_NATIVE_SQLITE_SOURCE:-} ]]; then
  cp -- "$TS_STACK_NATIVE_SQLITE_SOURCE" "$private/sqlite3.c"
else
  curl --fail --silent --show-error --location --proto '=https' --max-time 60 \
    --max-filesize 4194304 https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip \
    --output "$private/sqlite.zip"
  unzip -p "$private/sqlite.zip" sqlite-amalgamation-3530400/sqlite3.c > "$private/sqlite3.c"
fi
[[ $(stat --format=%s "$private/sqlite3.c") == 9516284 ]]
printf '%s  %s\n' 6a2805f8c1ef020a7086e62258519323cf98b219e9fe87a42065d916cfebaefc \
  "$private/sqlite3.c" | sha256sum --check --status
# Fail on any compiler/build mismatch. Source capture and all thirteen original
# standalone native modes precede exclusive immutable executable delivery.
timeout --signal=TERM --kill-after=10s 600s docker run --rm --init \
  --name "$container" --platform linux/arm64 --network none --read-only \
  --memory 12g --cpus 4 --pids-limit 512 --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --mount "type=bind,source=$repo,target=/workspace,readonly" \
  --mount "type=bind,source=$private,target=/native-tests" \
  --workdir /workspace/packages/wallet/wallet-toolbox \
  "$base_image" node --max-old-space-size=1536 tools/Brc38NativeQualification.cjs \
    --sqlite-source /native-tests/sqlite3.c --destination /native-tests/native-contract \
  > "$private/component-delivery.json"
[[ -f $private/native-contract && ! -L $private/native-contract ]]
printf 'TS_STACK_NATIVE_TEST_EXECUTABLE=%s\n' "$private/native-contract"
if [[ -n ${GITHUB_ENV:-} ]]; then
  printf 'TS_STACK_NATIVE_TEST_EXECUTABLE=%s\n' "$private/native-contract" >> "$GITHUB_ENV"
fi
