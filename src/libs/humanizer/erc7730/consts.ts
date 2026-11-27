// people don't change their singleton on a whim
export const SAFE_SINGLETON_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

// the max time we wait to visualize erc-7730 before going to the fallback
export const ERC7730_DESCRIPTOR_WAIT_MS = 4000

/**
 * The versions of ERC-7730 the wallet can show, by the file name of the `$schema` a descriptor
 * declares. A descriptor of any other version, or of none, is not used: it can hold rules the
 * wallet would silently ignore. Add a version only once the humanizer supports it
 */
export const SUPPORTED_ERC7730_SCHEMA_FILES: ReadonlySet<string> = new Set([
  'erc7730-v2.schema.json'
])

/**
 * The prefix of a descriptor Ambire amended: the amended copy of `registry/x.json` is
 * `ambire-change/registry/x.json` (see `scripts/erc7730/amend.ts`), so it is clear which descriptors
 * are not upstream's as they are. The upstream registry has no such paths
 */
export const ERC7730_AMBIRE_CHANGE_PATH_PREFIX = 'ambire-change/'

/**
 * The prefix of a descriptor Ambire wrote itself: `scripts/erc7730/descriptors/registry/x.json` is
 * bundled as `ambire-new/registry/x.json`, so it never takes the path of an upstream descriptor
 */
export const ERC7730_AMBIRE_NEW_PATH_PREFIX = 'ambire-new/'

/**
 * The path a bundled descriptor has, or would have, in the upstream registry: its path without
 * Ambire's prefix (`ambire-change/` or `ambire-new/`)
 */
export const getErc7730RegistryPath = (bundledPath: string): string => {
  const prefix = [ERC7730_AMBIRE_CHANGE_PATH_PREFIX, ERC7730_AMBIRE_NEW_PATH_PREFIX].find((one) =>
    bundledPath.startsWith(one)
  )

  return prefix ? bundledPath.slice(prefix.length) : bundledPath
}

/** Whether a bundled descriptor is Ambire's: an amended copy or one Ambire wrote itself */
export const isAmbireErc7730Path = (bundledPath: string): boolean =>
  getErc7730RegistryPath(bundledPath) !== bundledPath

export const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
export const PERMIT2_APPROVE_SELECTOR = '0x87517c45'
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'
export const SAFE_TX_PRIMARY_TYPE = 'SafeTx'
export const SAFE_PROXY_SINGLETON_SLOT = 0n

// How many levels of calls embedded in other calls are shown in the UI. The humanizer
// itself decodes all the levels, so that the warnings of the deeply embedded calls are
// not lost, but showing all of them makes the transaction impossible to read.
export const MAX_DISPLAYED_NESTED_CALLDATA_DEPTH = 4
