import EventEmitter from 'events'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Storage } from '../../interfaces/storage'
import { StorageController } from '../storage/storage'
import { PhishingController } from './phishing'

const storage: Storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)

const event = new EventEmitter()
let windowId = 0
const windowManager = {
  event,
  focus: () => Promise.resolve(),
  open: () => {
    windowId++
    return Promise.resolve({
      id: windowId,
      top: 0,
      left: 0,
      width: 100,
      height: 100,
      focused: true
    })
  },
  remove: () => {
    event.emit('windowRemoved', windowId)
    return Promise.resolve()
  },
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

let phishing: PhishingController
const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
describe('PhishingController', () => {
  beforeEach(async () => {
    await storageCtrl.set('phishingDetection', {
      timestamp: twentyFourHoursAgo,
      // actual blacklisted domains by MetaMask/eth-phishing-detect
      metamaskBlacklist: [
        'go-blast2l.xyz',
        'insta-dapp.net',
        'l2blast-check.xyz',
        'lihea.build',
        'lidofinance.one',
        'owlto-v2.online',
        'swlifi.org',
        'pndlifi.com'
      ],
      phantomBlacklist: []
    })
    phishing = new PhishingController({ storage: storageCtrl, fetch, windowManager })
  })
  test('should initialize', async () => {
    expect(phishing).toBeDefined()
  })
  test('should fetch lists from github', async () => {
    await phishing.initialLoadPromise
    const storedPhishingDetection = await storageCtrl.get('phishingDetection', {
      timestamp: null,
      metamaskBlacklist: [],
      phantomBlacklist: []
    })
    expect(storedPhishingDetection).not.toBe(null)
    expect(phishing.lastStorageUpdate).not.toBe(null)
    if ((phishing.lastStorageUpdate as number) > twentyFourHoursAgo) {
      expect(phishing.blacklistLength).toBeGreaterThan(
        storedPhishingDetection!.metamaskBlacklist.length
      )
    } else {
      expect(phishing.blacklistLength).toEqual(storedPhishingDetection!.metamaskBlacklist.length)
    }
  })
  test('should load and update blacklists and correctly check for blacklisted urls', async () => {
    expect(await phishing.getIsBlacklisted('https://swlifi.org')).toBe(true)
    expect(await phishing.getIsBlacklisted('https://pndlifi.com')).toBe(true)
    expect(await phishing.getIsBlacklisted('https://safe.com')).toBe(false)
  })
  test('should send correct url status to the UI', async () => {
    const sendWindowUiMessageSpy = jest.spyOn(windowManager, 'sendWindowUiMessage')
    await phishing.sendIsBlacklistedToUi('https://swlifi.org')
    expect(sendWindowUiMessageSpy).toHaveBeenCalledWith({ hostname: 'BLACKLISTED' })
    sendWindowUiMessageSpy.mockClear()
    await phishing.sendIsBlacklistedToUi('https://pndlifi.com')
    expect(sendWindowUiMessageSpy).toHaveBeenCalledWith({ hostname: 'BLACKLISTED' })
    sendWindowUiMessageSpy.mockClear()
    await phishing.sendIsBlacklistedToUi('https://safe.com')
    expect(sendWindowUiMessageSpy).toHaveBeenCalledWith({ hostname: 'NOT_BLACKLISTED' })
  })
})
