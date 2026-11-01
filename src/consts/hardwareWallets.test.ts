import { describe, expect, test } from '@jest/globals'

import { TrezorWalletType } from '../interfaces/keystore'
import { getHardwareWalletDeviceName } from './hardwareWallets'

describe('getHardwareWalletDeviceName', () => {
  test('names a trezor key of an Ambire Ice after the Ambire Ice', () => {
    expect(getHardwareWalletDeviceName('trezor', { trezorWalletType: 'ambireIce' })).toBe(
      'Ambire Ice'
    )
  })

  test('names a trezor key without a wallet type after Trezor', () => {
    expect(getHardwareWalletDeviceName('trezor')).toBe('Trezor')
    expect(getHardwareWalletDeviceName('trezor', null)).toBe('Trezor')
    expect(getHardwareWalletDeviceName('trezor', {})).toBe('Trezor')
  })

  test('ignores a Trezor wallet type on keys of other devices', () => {
    expect(getHardwareWalletDeviceName('ledger', { trezorWalletType: 'ambireIce' })).toBe('Ledger')
    expect(getHardwareWalletDeviceName('onekey', { trezorWalletType: 'ambireIce' })).toBe('OneKey')
  })

  test('falls back to Trezor for a wallet type this version does not know', () => {
    // E.g. a key added by a newer version of the app
    const unknownTrezorWalletType = 'someFutureDevice' as unknown as TrezorWalletType

    expect(
      getHardwareWalletDeviceName('trezor', { trezorWalletType: unknownTrezorWalletType })
    ).toBe('Trezor')
  })
})
