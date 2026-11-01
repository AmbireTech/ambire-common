import { ExternalKey, TrezorWalletType } from '../interfaces/keystore'

export const HARDWARE_WALLET_DEVICE_NAMES: { [key in ExternalKey['type']]: string } = {
  ledger: 'Ledger',
  trezor: 'Trezor',
  onekey: 'OneKey',
  lattice: 'GridPlus',
  qr: 'QR-based',
  nfc: 'NFC-based',
  pq1: 'PQ1'
}

/** Names of the non-Trezor devices that run Trezor's firmware (see `TrezorWalletType`) */
export const TREZOR_WALLET_DEVICE_NAMES: { [key in TrezorWalletType]: string } = {
  ambireIce: 'Ambire Ice'
}

/**
 * The name of the device behind a hardware wallet key, e.g. "Ambire Ice" for a `trezor`
 * key of an Ambire Ice, and the name of its key type (e.g. "Trezor") otherwise.
 */
export const getHardwareWalletDeviceName = (
  type: ExternalKey['type'],
  meta?: Pick<ExternalKey['meta'], 'trezorWalletType'> | null
) => {
  const trezorWalletType = type === 'trezor' ? meta?.trezorWalletType : undefined
  const trezorWalletDeviceName = trezorWalletType && TREZOR_WALLET_DEVICE_NAMES[trezorWalletType]

  return trezorWalletDeviceName || HARDWARE_WALLET_DEVICE_NAMES[type]
}
