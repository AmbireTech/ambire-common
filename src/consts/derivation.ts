// The "standard" default one for many, including MetaMask
export const BIP44_HD_PATH = "m/44'/60'/0'/0"

export const LEDGER_BIP44_HD_PATH = BIP44_HD_PATH
export const LEDGER_LEGACY_HD_PATH = "m/44'/60'/0'"
export const LEDGER_LIVE_HD_PATH = "m/44'/60'/0'/0/0"
export const TREZOR_HD_PATH = BIP44_HD_PATH
export const TREZOR_PATH_BASE = 'm'
export const LATTICE_STANDARD_HD_PATH = "m/44'/60'/0'/0/x"

interface HDPath {
  label: string
  path:
    | typeof BIP44_HD_PATH
    | typeof LEDGER_LEGACY_HD_PATH
    | typeof LEDGER_LIVE_HD_PATH
    | typeof LATTICE_STANDARD_HD_PATH
}

export const HD_PATHS: HDPath[] = [
  { label: 'BIP44', path: BIP44_HD_PATH },
  { label: 'Ledger Legacy', path: LEDGER_LEGACY_HD_PATH },
  { label: 'Ledger Live', path: LEDGER_LIVE_HD_PATH },
  { label: 'Lattice Standard', path: LATTICE_STANDARD_HD_PATH }
]
