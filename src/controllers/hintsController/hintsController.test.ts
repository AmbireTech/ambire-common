import { expect } from '@jest/globals'

import { Storage } from '../../interfaces/storage'
import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../storage/storage'
import { HintsController } from './hintsController'

import type { IAccountsController } from '@/interfaces/accounts'
import type { IKeystoreController } from '@/interfaces/keystore'

const ETHEREUM = 1n
const ACCOUNT = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const AZUKI = '0xED5AF388653567Af2F388E6224dC7C4b3241C544'

// Only the storage matters for the preferences, the rest is used by the hints
const getController = () => {
  const storage: Storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)

  return {
    storage,
    hints: new HintsController(
      storageCtrl,
      { accounts: [] } as unknown as IAccountsController,
      {} as unknown as IKeystoreController
    )
  }
}

const getCollectibleHints = (hints: HintsController, accountId: string = ACCOUNT) =>
  hints.getAllHints(accountId, ETHEREUM, undefined).specialErc721Hints

describe('HintsController', () => {
  describe('custom collectibles', () => {
    it('adds two collectibles of one collection', async () => {
      const { hints } = getController()

      expect(
        await hints.addCustomToken({
          address: BAYC,
          chainId: ETHEREUM,
          standard: 'ERC721',
          tokenId: 1n
        })
      ).toBe(true)
      expect(
        await hints.addCustomToken({
          address: BAYC,
          chainId: ETHEREUM,
          standard: 'ERC721',
          tokenId: 2n
        })
      ).toBe(true)

      expect(hints.customTokens).toHaveLength(2)
      expect(getCollectibleHints(hints).custom[BAYC]).toEqual([1n, 2n])
    })

    it('refuses a collectible that is already added', async () => {
      const { hints } = getController()
      const collectible = {
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721' as const,
        tokenId: 1n
      }

      expect(await hints.addCustomToken(collectible)).toBe(true)
      expect(await hints.addCustomToken(collectible)).toBe(false)
      expect(hints.customTokens).toHaveLength(1)
    })

    // The address alone used to be the identity, which made the second id a duplicate
    it('adds the same id in another collection', async () => {
      const { hints } = getController()

      await hints.addCustomToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 1n
      })

      expect(
        await hints.addCustomToken({
          address: AZUKI,
          chainId: ETHEREUM,
          standard: 'ERC721',
          tokenId: 1n
        })
      ).toBe(true)
      expect(hints.customTokens).toHaveLength(2)
    })

    it('removes only the collectible it was given', async () => {
      const { hints } = getController()

      await hints.addCustomToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 1n
      })
      await hints.addCustomToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 2n
      })
      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM, tokenId: 1n }, ACCOUNT)

      expect(hints.customTokens).toHaveLength(1)
      expect(hints.customTokens[0]!.tokenId).toBe(2n)
    })

    // Otherwise the removed collectible is rediscovered and shows up again
    it('stops requesting a removed collectible', async () => {
      const { hints, storage } = getController()

      await hints.addCustomToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 1n
      })
      hints.addErc721sToBeLearned([[BAYC, [1n, 2n]]], ACCOUNT, ETHEREUM)

      expect(getCollectibleHints(hints).learn[BAYC]).toEqual([1n, 2n])

      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM, tokenId: 1n }, ACCOUNT)

      expect(getCollectibleHints(hints).learn[BAYC]).toEqual([2n])
      expect(getCollectibleHints(hints).custom[BAYC]).toBeUndefined()
      expect(await storage.get('learnedAssets', undefined)).toBeDefined()
    })

    // Collectibles added before the ids were recorded stand for the whole
    // collection, so removing one forgets all of it
    it('stops requesting a collection removed without an id', async () => {
      const { hints } = getController()

      await hints.addCustomToken({ address: BAYC, chainId: ETHEREUM, standard: 'ERC721' })
      hints.addErc721sToBeLearned([[BAYC, [1n, 2n]]], ACCOUNT, ETHEREUM)
      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM }, ACCOUNT)

      expect(getCollectibleHints(hints).learn[BAYC]).toBeUndefined()
      expect(getCollectibleHints(hints).custom[BAYC]).toBeUndefined()
    })

    it('leaves the hints of a removed token alone', async () => {
      const { hints } = getController()

      await hints.addCustomToken({ address: BAYC, chainId: ETHEREUM, standard: 'ERC20' })
      hints.addErc721sToBeLearned([[BAYC, [1n]]], ACCOUNT, ETHEREUM)
      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM }, ACCOUNT)

      expect(getCollectibleHints(hints).learn[BAYC]).toEqual([1n])
    })

    it('keeps requesting the whole collection it was asked to enumerate', async () => {
      const { hints } = getController()

      hints.addErc721sToBeLearned([[BAYC, []]], ACCOUNT, ETHEREUM)
      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM, tokenId: 1n }, ACCOUNT)

      expect(getCollectibleHints(hints).learn[BAYC]).toEqual([])
    })
  })

  describe('hidden collectibles', () => {
    it('hides one collectible of a collection', async () => {
      const { hints } = getController()

      await hints.toggleHideToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 1n
      })

      expect(hints.tokenPreferences).toHaveLength(1)
      expect(getCollectibleHints(hints).hidden[BAYC]).toEqual([1n])
    })

    it('hides a second collectible without unhiding the first', async () => {
      const { hints } = getController()

      await hints.toggleHideToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 1n
      })
      await hints.toggleHideToken({
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721',
        tokenId: 2n
      })

      expect(getCollectibleHints(hints).hidden[BAYC]).toEqual([1n, 2n])
    })

    it('unhides only the collectible it was given', async () => {
      const { hints } = getController()
      const first = {
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721' as const,
        tokenId: 1n
      }

      await hints.toggleHideToken(first)
      await hints.toggleHideToken({ ...first, tokenId: 2n })
      await hints.toggleHideToken(first)

      expect(getCollectibleHints(hints).hidden[BAYC]).toEqual([2n])
    })

    // A hidden collection has no ids, which asks for every collectible of it
    it('hides a whole collection when no id is given', async () => {
      const { hints } = getController()

      await hints.toggleHideToken({ address: BAYC, chainId: ETHEREUM, standard: 'ERC721' })

      expect(getCollectibleHints(hints).hidden[BAYC]).toEqual([])
    })

    it('keeps the standard of a removed custom collectible, so it stays hidden as an NFT', async () => {
      const { hints } = getController()
      const collectible = {
        address: BAYC,
        chainId: ETHEREUM,
        standard: 'ERC721' as const,
        tokenId: 1n
      }

      await hints.addCustomToken(collectible)
      await hints.toggleHideToken(collectible)
      await hints.removeCustomToken({ address: BAYC, chainId: ETHEREUM, tokenId: 1n }, ACCOUNT)

      expect(hints.tokenPreferences).toHaveLength(0)
    })
  })
})
