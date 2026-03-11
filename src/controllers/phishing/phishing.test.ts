import { expect } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'

const prepareTest = async () => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('domainsBlacklistedStatus', {
      'foourmemez.com': { status: 'BLACKLISTED', updatedAt: Date.now() },
      'rewards.ambire.com': { status: 'VERIFIED', updatedAt: Date.now() }
    })
    await storageCtrl.set('addressesBlacklistedStatus', {
      '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e': {
        status: 'BLACKLISTED',
        updatedAt: Date.now()
      },
      '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
        status: 'VERIFIED',
        updatedAt: Date.now()
      }
    })
  })
  return { controller: mainCtrl.phishing }
}

describe('PhishingController', () => {
  test('should initialize', async () => {
    const { controller } = await prepareTest()
    expect(controller).toBeDefined()
  })
  test('should get dapps blacklisted status', async () => {
    const { controller } = await prepareTest()
    await controller.updateDomainsBlacklistedStatus(
      ['foourmemez.com', 'rewards.ambire.com'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['foourmemez.com'] === 'BLACKLISTED')
        expect(blacklistedStatus['rewards.ambire.com'] === 'VERIFIED')
      }
    )
  })
  test('should get addresses blacklisted status', async () => {
    const { controller } = await prepareTest()

    await controller.updateAddressesBlacklistedStatus(
      ['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'] === 'BLACKLISTED')
        expect(blacklistedStatus['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'] === 'VERIFIED')
      }
    )
  })
})
