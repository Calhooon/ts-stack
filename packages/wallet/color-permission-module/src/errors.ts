// Error classes added in 0.2.0. Hosts match them by `.name`, then by the `[ClassName] `
// message prefix (an HTTP or IPC bridge can lose `.name`), never by `instanceof`, since the
// module can be loaded more than once across bundles.

/** Prefixes `message` with `[name] ` unless it already starts with it. */
function prefixed(name: string, message: string): string {
  const prefix = `[${name}] `
  return message.startsWith(prefix) ? message : `${prefix}${message}`
}

/** A required profile's descriptor, `ext` entry or registration is invalid for an asset. */
export class ProfileParamsError extends Error {
  override readonly name = 'ProfileParamsError'
  constructor(message: string) {
    super(prefixed('ProfileParamsError', message))
  }
}

/** A plan's or receipt's `profileData` is invalid, or names an undeclared profile (A.154). */
export class ProfileDataError extends Error {
  override readonly name = 'ProfileDataError'
  constructor(message: string) {
    super(prefixed('ProfileDataError', message))
  }
}

/** Attested admission evidence (frontier, graph or signature) failed validation. */
export class AttestationEvidenceError extends Error {
  override readonly name = 'AttestationEvidenceError'
  constructor(readonly reason: string) {
    super(prefixed('AttestationEvidenceError', `BRC-207: attested evidence rejected (${reason})`))
  }
}

/** Thrown by providers, and re-thrown by the module, for an overlay or transport failure. */
export class ColorProviderError extends Error {
  override readonly name = 'ColorProviderError'
  constructor(
    /** The overlay verdict code, or `ERR_UNAVAILABLE` for a transport failure. */
    readonly code: string,
    readonly retryable: boolean,
    /** True when there is no typed verdict: network, timeout, 5xx or a typed `ERR_UNAVAILABLE`. */
    readonly transport: boolean,
    message: string
  ) {
    super(prefixed('ColorProviderError', message))
  }
}

/** The host's `requestTokenAccess` did not approve a request. */
export class ColorConsentDeclinedError extends Error {
  override readonly name = 'ColorConsentDeclinedError'
  constructor(readonly requestType: string) {
    super(
      prefixed('ColorConsentDeclinedError', `BRC-207: the user declined the ${requestType} request`)
    )
  }
}

/**
 * True when `error` is the named module error: its `name` equals `name`, or its message
 * starts with `[name] `. Never uses `instanceof`, so it works across bundles and bridges.
 */
export function isNamedError(error: unknown, name: string): boolean {
  if (error === null || typeof error !== 'object') return false
  const { name: errorName, message } = error as { name?: unknown; message?: unknown }
  if (errorName === name) return true
  return typeof message === 'string' && message.startsWith(`[${name}] `)
}
