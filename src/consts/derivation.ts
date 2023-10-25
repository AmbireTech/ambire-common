// The "standard" default one for many, including MetaMask
export const BIP44_HD_PATH = "m/44'/60'/0'/0"

export const BIP44_LEDGER_LIVE_TEMPLATE = "m/44'/60'/<account>'/0/0"
export const BIP44_TREZOR_TEMPLATE = "m/44'/60'/0'/0/<account>"
export const BIP44_LATTICE_TEMPLATE = "m/44'/60'/0'/0/<account>"
// Closely related to the BIP44 standard, but it does not include the last "/0"
// which is typically used to distinguish between external and internal
// addresses (change addresses). There isn't a specific, universally recognized
// name for this path beyond its association with Ethereum and the
// Ethereum wallets like MyEtherWallet (MEW) and MyCrypto.
export const MEW_LEGACY_TEMPLATE = "m/44'/60'/0'/<account>"

export interface HDPath {
  label: string
  path:
    | typeof BIP44_HD_PATH
    | typeof MEW_LEGACY_TEMPLATE
    | typeof BIP44_TREZOR_TEMPLATE
    | typeof BIP44_LEDGER_LIVE_TEMPLATE
}

export const HD_PATHS: HDPath[] = [
  { label: 'BIP44', path: BIP44_HD_PATH },
  { label: 'Legacy (MyEtherWallet, MyCrypto)', path: MEW_LEGACY_TEMPLATE },
  { label: 'BIP44 (MetaMask, Trezor, GridPlus)', path: BIP44_TREZOR_TEMPLATE },
  { label: 'BIP44 (Ledger Live)', path: BIP44_LEDGER_LIVE_TEMPLATE }
]
