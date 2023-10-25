// The "standard" default one for many, including MetaMask
export const BIP44_HD_PATH = "m/44'/60'/0'/0"

/**
 * BIP44 as everyone implements it (MetaMask, Trezor, Lattice, EthersJS),
 * iterating over the `address_index` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
export const BIP44_STANDARD_DERIVATION_TEMPLATE = "m/44'/60'/0'/0/<account>"
/**
 * BIP44 as Ledger (Live) currently implements it. They iterate over the
 * `account'` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
export const BIP44_LEDGER_DERIVATION_TEMPLATE = "m/44'/60'/<account>'/0/0"
/**
 * Legacy (but popular) one, which is BIP44-like, but not BIP44 exactly and
 * there is no standard that describes it. Closely related to the BIP44
 * standard, but it does not include the last "/0" which is typically used to
 * distinguish between addresses (change addresses). Used previously by
 * Ledger and by other Ethereum wallets like MyEtherWallet (MEW) and MyCrypto.
 */
export const LEGACY_POPULAR_DERIVATION_TEMPLATE = "m/44'/60'/0'/<account>"

export interface HDPath {
  label: string
  path:
    | typeof BIP44_STANDARD_DERIVATION_TEMPLATE
    | typeof BIP44_LEDGER_DERIVATION_TEMPLATE
    | typeof LEGACY_POPULAR_DERIVATION_TEMPLATE
}

export const HD_PATHS: HDPath[] = [
  { label: 'BIP44 (MetaMask, Trezor, GridPlus)', path: BIP44_STANDARD_DERIVATION_TEMPLATE },
  { label: 'BIP44 (Ledger Live)', path: BIP44_LEDGER_DERIVATION_TEMPLATE },
  { label: 'Legacy (Ledger, MyEtherWallet, MyCrypto)', path: LEGACY_POPULAR_DERIVATION_TEMPLATE }
]
