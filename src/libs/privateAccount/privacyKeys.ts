import { HDNodeWallet } from 'ethers'

import {
  PRIVACY_POOLS_KEY_ROOT_PATH,
  PRIVACY_POOLS_SIGNING_KEY_PATH
} from '../../consts/privacyPools'
import { PrivacyKeyMaterial } from '../../interfaces/keystore'
import { PrivacyProviderId } from '../../interfaces/privateAccount'

/** How a provider's keys derive from a recovery phrase, and which of them its SDK may get. */
export type PrivacyKeyScope = {
  kind: PrivacyKeyMaterial['kind']
  /** The node stored for the provider. Hardened segments only, so it can't reach its parent */
  rootPath: string
  /**
   * Whether the SDK may get the key at `path`, always below `rootPath`. The security boundary:
   * the SDKs choose the paths, and could otherwise reach the user's EVM keys
   */
  isAllowedPath: (path: string) => boolean
}

/** Every privacy provider's key scope - see `PrivacyKeyScope`. */
export const PRIVACY_KEY_SCOPES: Record<PrivacyProviderId, PrivacyKeyScope> = {
  privacyPools: {
    kind: 'bip32Node',
    rootPath: PRIVACY_POOLS_KEY_ROOT_PATH,
    // Only account 0 for now: more accounts per phrase only widen this
    isAllowedPath: (path) => path === PRIVACY_POOLS_SIGNING_KEY_PATH
  }
}

/**
 * Checked at runtime, as the UI can call the keystore with any value: an inherited key such as
 * `__proto__` must not pass for a provider.
 */
export const isPrivacyProviderId = (providerId: string): providerId is PrivacyProviderId =>
  Object.prototype.hasOwnProperty.call(PRIVACY_KEY_SCOPES, providerId)

/** The scope of `providerId`, refusing anything that isn't a provider - see `isPrivacyProviderId`. */
export const getPrivacyKeyScope = (providerId: string): PrivacyKeyScope => {
  if (!isPrivacyProviderId(providerId))
    throw new Error(`keystore: not a privacy provider (${providerId})`)

  return PRIVACY_KEY_SCOPES[providerId]
}

/**
 * `path` relative to `rootPath`, e.g. `0'` for `m/28784'/1'/0'` below `m/28784'/1'`. Compared by
 * whole segments, so `m/28784'/1'0'` isn't taken for a path below `m/28784'/1'`.
 */
export const getPathBelow = (rootPath: string, path: string): string => {
  const rootPrefix = `${rootPath}/`
  if (!path.startsWith(rootPrefix) || path.length === rootPrefix.length)
    throw new Error(`keystore: ${path} is not below ${rootPath}`)

  return path.slice(rootPrefix.length)
}

/** The bytes to encrypt for a `privacyKeys` entry, from the phrase's master node (at `m`). */
export const encodePrivacyKeyMaterial = (
  masterNode: HDNodeWallet,
  scope: PrivacyKeyScope
): Uint8Array => {
  const material: PrivacyKeyMaterial = {
    kind: scope.kind,
    path: scope.rootPath,
    xprv: masterNode.derivePath(scope.rootPath).extendedKey
  }

  return new TextEncoder().encode(JSON.stringify(material))
}

const isPrivacyKeyMaterialOf = (
  value: unknown,
  scope: PrivacyKeyScope
): value is PrivacyKeyMaterial =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === scope.kind &&
  'path' in value &&
  value.path === scope.rootPath &&
  'xprv' in value &&
  typeof value.xprv === 'string'

/**
 * The HD node of a decrypted `privacyKeys` entry, checked to be the node of `scope`. Its errors
 * never quote the entry, unlike JSON.parse's: it is key material, and errors reach the UI and the
 * crash reports.
 */
export const decodePrivacyKeyNode = (bytes: Uint8Array, scope: PrivacyKeyScope): HDNodeWallet => {
  let material: unknown
  try {
    material = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // Rethrown without the cause on purpose, as its message quotes the decrypted text
    throw new Error('keystore: the stored privacy key is unreadable')
  }
  if (!isPrivacyKeyMaterialOf(material, scope))
    throw new Error('keystore: the stored privacy key is not the one of this provider')

  // ethers redacts the key from its own errors
  const node = HDNodeWallet.fromExtendedKey(material.xprv)
  // An extended public key can't derive private keys, and a node at another depth isn't at `path`
  const rootPathDepth = scope.rootPath.split('/').length - 1
  if (!(node instanceof HDNodeWallet) || node.depth !== rootPathDepth)
    throw new Error('keystore: the stored privacy key is not the one of this provider')

  return node
}
