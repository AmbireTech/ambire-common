import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { IPhishingController } from '../../interfaces/phishing'
import { Storage } from '../../interfaces/storage'
import { StorageController } from '../storage/storage'
import { PhishingController } from './phishing'

const storage: Storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)

let phishing: IPhishingController

describe('PhishingController', () => {
  beforeEach(async () => {
    await storageCtrl.set('dappsBlacklistedStatus', {
      'foourmemez.com': {
        status: 'BLACKLISTED',
        updatedAt: Date.now()
      },
      'rewards.ambire.com': {
        status: 'VERIFIED',
        updatedAt: Date.now()
      }
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
    phishing = new PhishingController({ fetch, storage: storageCtrl })
    await phishing.initialLoadPromise
  })
  test('should initialize', async () => {
    expect(phishing).toBeDefined()
  })
  test('should get dapps blacklisted status', async () => {
    phishing.updateDappsBlacklistedStatus(
      ['foourmemez.com', 'rewards.ambire.com'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['foourmemez.com'] === 'BLACKLISTED')
        expect(blacklistedStatus['rewards.ambire.com'] === 'VERIFIED')
      }
    )
  })
  test('should get addresses blacklisted status', async () => {
    await phishing.updateAddressesBlacklistedStatus(
      ['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'] === 'BLACKLISTED')
        expect(blacklistedStatus['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'] === 'VERIFIED')
      }
    )
  })
})
