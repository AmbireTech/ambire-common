import { ExternalKey } from '../interfaces/keystore'

export const HARDWARE_WALLET_DEVICE_NAMES: { [key in ExternalKey['type']]: string } = {
  ledger: 'Ledger',
  trezor: 'Trezor',
  // Named after its only device for now (the model is also in the key's `meta.deviceModel`)
  ambire: 'Ambire Ice',
  onekey: 'OneKey',
  lattice: 'GridPlus',
  qr: 'QR-based',
  nfc: 'NFC-based',
  pq1: 'PQ1'
}
