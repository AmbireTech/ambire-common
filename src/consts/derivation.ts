// The "standard" default one for many, including MetaMask
export const BIP44_HD_PATH = "m/44'/60'/0'/0"

export const LEDGER_BIP44_HD_PATH = BIP44_HD_PATH
export const LEDGER_LEGACY_HD_PATH = "m/44'/60'/0'"
export const LEDGER_LIVE_HD_PATH = "m/44'/60'/0'/0/0"
export const LATTICE_STANDARD_HD_PATH = "m/44'/60'/0'/0/x"

export enum DERIVATION {
  BIP44 = 'BIP44',
  BIP39 = 'BIP39'
}

export const BIP44_LEDGER_LIVE_TEMPLATE = "m/44'/60'/<account>'/0/0"
export const BIP44_TREZOR_TEMPLATE = "m/44'/60'/0'/0/<account>"
export const BIP44_LATTICE_TEMPLATE = "m/44'/60'/0'/0/<account>"

export interface HDPath {
  label: string
  path:
    | typeof BIP44_HD_PATH
    | typeof LEDGER_LEGACY_HD_PATH
    | typeof LEDGER_LIVE_HD_PATH
    | typeof LATTICE_STANDARD_HD_PATH
    | typeof BIP44_TREZOR_TEMPLATE
    | typeof BIP44_LEDGER_LIVE_TEMPLATE
}

export const HD_PATHS: HDPath[] = [
  { label: 'BIP44', path: BIP44_HD_PATH },
  { label: 'Ledger Legacy', path: LEDGER_LEGACY_HD_PATH },
  { label: 'Ledger Live', path: LEDGER_LIVE_HD_PATH },
  { label: 'Lattice Standard', path: LATTICE_STANDARD_HD_PATH },
  { label: 'BIP44 (MetaMask, Trezor, GridPlus)', path: BIP44_TREZOR_TEMPLATE },
  { label: 'BIP44 (Ledger Live)', path: BIP44_LEDGER_LIVE_TEMPLATE }
]
