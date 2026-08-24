/**
 * The chains `@kohaku-eth/railgun` can run on. The protocol is deployed on more networks, but
 * `chainConfig()` only resolves these two - anything else makes `createRailgunPlugin` throw.
 *
 * Mutually exclusive in practice: Sepolia only exists in the testnet network set and Ethereum only
 * in the mainnet one.
 */
export const RAILGUN_SUPPORTED_CHAIN_IDS = [1n, 11155111n]

/**
 * Railgun's BIP-44 coin type is 1984, so its spending and viewing keys live under these two
 * prefixes. `KeystoreController.deriveRailgunKey` refuses anything outside them - that whitelist is
 * the security boundary, since the plugin is an unaudited alpha that asks the host keystore to
 * derive arbitrary paths and could otherwise reach the user's EVM keys.
 */
export const RAILGUN_DERIVATION_PATH_PREFIXES = ["m/44'/1984'/", "m/420'/1984'/"]

/**
 * Which Railgun key pair to derive. Fixed at 0 so the 0zk address is a pure function of the
 * recovery phrase and needs nothing persisted to be recovered - at the cost of one shared identity
 * per phrase. Per-account identities would need a user-chosen, persisted index; never infer one,
 * since a different inference points the wallet at an empty identity.
 */
export const RAILGUN_KEY_INDEX = 0

/**
 * The upper bound stated to the user before an initial sync, and the timeout the controller gives
 * it - the same number on purpose, so the promise and the behaviour cannot disagree.
 *
 * Sized against the slowest observed case (a first mainnet scan, ~11 min) with room for pool growth.
 */
export const RAILGUN_INITIAL_SYNC_MAX_MINUTES = 20
