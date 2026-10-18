import { PRIVACY_POOLS_SIGNING_KEY_PATH } from '../../consts/privacyPools'
import { TORNADO_CASH_ACCOUNT_KEY_PATH } from '../../consts/tornadoCash'
import { isAllowedPrivacyKeyPath } from './keyPaths'

describe('isAllowedPrivacyKeyPath', () => {
  it('allows only the Privacy Pools signing key for Privacy Pools', () => {
    expect(isAllowedPrivacyKeyPath('privacyPools', PRIVACY_POOLS_SIGNING_KEY_PATH)).toBe(true)
    expect(isAllowedPrivacyKeyPath('privacyPools', `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/0'`)).toBe(
      false
    )
  })

  it("allows every Tornado Cash note key of the wallet's account", () => {
    for (const kind of [0, 1, 2]) {
      for (const depositIndex of [0, 1, 99, 2 ** 31 - 1]) {
        const path = `${TORNADO_CASH_ACCOUNT_KEY_PATH}/${kind}'/${depositIndex}'`
        expect(isAllowedPrivacyKeyPath('tornadoCash', path)).toBe(true)
      }
    }
  })

  it('refuses any other path for Tornado Cash, however it is spelled', () => {
    const refusedPaths = [
      "m/44'/60'/0'/0/0",
      PRIVACY_POOLS_SIGNING_KEY_PATH,
      TORNADO_CASH_ACCOUNT_KEY_PATH,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/3'/0'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0/0'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/0`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/01'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/-1'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/1e3'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/${2 ** 31}'`,
      `${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/0'/0'`,
      ` ${TORNADO_CASH_ACCOUNT_KEY_PATH}/0'/0'`,
      "m/29795'/1'/1'/0'/0'"
    ]
    for (const path of refusedPaths) {
      expect(isAllowedPrivacyKeyPath('tornadoCash', path)).toBe(false)
    }
  })
})
