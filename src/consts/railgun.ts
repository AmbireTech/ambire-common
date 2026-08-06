/**
 * Chains the Railgun SDK can actually run on.
 *
 * The Railgun protocol itself is deployed on more networks (Arbitrum, Polygon, BSC), but
 * `@kohaku-eth/railgun`'s `chainConfig(chainId)` only resolves a ChainConfig for these two -
 * everything else returns null and `createRailgunPlugin` throws `Unsupported chain ID`. This
 * list is therefore a mirror of the SDK's capability, not of the protocol's, and
 * `RailgunController` asserts each entry against `chainConfig()` at init time so a version
 * bump that drops (or adds) a chain fails loudly instead of silently.
 *
 * Note that these two are mutually exclusive in practice: Sepolia only exists in
 * `predefinedTestnetNetworks`, so a wallet in mainnet mode sees Ethereum and a wallet in
 * testnet mode sees Sepolia (unless the user added the other one as a custom network).
 */
export const RAILGUN_SUPPORTED_CHAIN_IDS = [1n, 11155111n]

/**
 * Railgun derives its spending and viewing keys at `m/44'/1984'/0'/0'/<index>'` and
 * `m/420'/1984'/0'/0'/<index>'` (1984 is Railgun's BIP-44 coin type). The exact paths come
 * from the SDK at runtime (`RailgunSigner.spendingKeyPath`/`viewingKeyPath`); these prefixes
 * exist so `KeystoreController.deriveRailgunKey` can refuse anything outside them.
 *
 * That refusal is the security boundary: the Railgun plugin is an unaudited alpha SDK that
 * asks the host keystore to derive arbitrary BIP-32 paths, and without this whitelist a bug
 * (or a compromised release) could ask for `m/44'/60'/...` - the user's actual EVM keys.
 */
export const RAILGUN_DERIVATION_PATH_PREFIXES = ["m/44'/1984'/", "m/420'/1984'/"]

/**
 * Which Railgun key pair to derive from the seed. Fixed at 0 on purpose: it makes the 0zk
 * address a pure function of the recovery phrase, so it is recoverable from the seed alone
 * with no extra persisted state. The consequence is that every account derived from the same
 * recovery phrase shares one Railgun identity (and one shielded balance) - the Privacy UI
 * states this explicitly.
 *
 * If per-account (or multiple) privacy identities are ever wanted, the index must be chosen
 * by the user and persisted - never inferred from the account's HD index, since an inference
 * that comes back different points the wallet at an empty identity and the user's shielded
 * funds look gone.
 */
export const RAILGUN_KEY_INDEX = 0
