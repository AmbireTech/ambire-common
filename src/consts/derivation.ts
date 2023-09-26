// The "standard" default one for many, including MetaMask
export const BIP44_HD_PATH = "m/44'/60'/0'/0"

export const LEDGER_BIP44_HD_PATH = BIP44_HD_PATH
export const LEDGER_LEGACY_HD_PATH = "m/44'/60'/0'"
export const LEDGER_LIVE_HD_PATH = "m/44'/60'/0'/0/0"
export const TREZOR_HD_PATH = BIP44_HD_PATH
export const TREZOR_PATH_BASE = 'm'
export const LATTICE_STANDARD_HD_PATH = "m/44'/60'/0'/0/x"

export const HD_PATHS: { [key: string]: string } = {
  BIP44: "m/44'/60'/0'/0",
  'Ledger Legacy': "m/44'/60'/0'",
  'Ledger Live': "m/44'/60'/0'/0/0",
  'Trezor Base': 'm',
  'Lattice Standard': "m/44'/60'/0'/0/x"
}
