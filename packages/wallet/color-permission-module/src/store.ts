import type { ColorModuleStore } from './types.js'

/** Every key the module writes starts with this prefix. */
export const STORE_PREFIX = 'color.v1.'

/**
 * Typed records over the host's `ColorModuleStore`, all under `color.v1.`. Only constructed
 * when profiles are registered.
 */
export class ColorStore {
  constructor(protected readonly store: ColorModuleStore) {}

  /** The cached deploy transaction of an asset, as raw hex; the caller verifies it by hash. */
  async getDeploy(assetId: string): Promise<string | undefined> {
    return await this.store.get(deployKey(assetId))
  }

  async putDeploy(assetId: string, hex: string): Promise<void> {
    await this.store.set(deployKey(assetId), hex)
  }

  async deleteDeploy(assetId: string): Promise<void> {
    await this.store.delete(deployKey(assetId))
  }
}

function deployKey(assetId: string): string {
  return `${STORE_PREFIX}deploy.${assetId}`
}
