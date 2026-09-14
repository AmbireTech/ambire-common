import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { isAssetMetadataStale, TOKEN_METADATA_MAX_AGE_MS } from '../../libs/portfolio/helpers'
import { CollectionMetadataEntry, TokenMetadataEntry } from '../../libs/portfolio/interfaces'
import { StorageController } from '../storage/storage'
import { HintsController } from './hintsController'

const ETHEREUM_CHAIN_ID = 1n
const BASE_CHAIN_ID = 8453n
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const PUNKS = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'
const APES = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const ADX = '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3'

const entry = (symbol: string, fetchedAt: number): TokenMetadataEntry => ({
  symbol,
  name: `${symbol} token`,
  decimals: 18,
  fetchedAt
})

const collectionEntry = (symbol: string, fetchedAt: number): CollectionMetadataEntry => ({
  symbol,
  name: `${symbol} collection`,
  fetchedAt
})

const prepareTest = async () => {
  const storageCtrl = new StorageController(produceMemoryStore())
  const hintsCtrl = new HintsController(storageCtrl, {} as any, {} as any)

  await hintsCtrl.initialLoadPromise

  return { hintsCtrl, storageCtrl }
}

describe('isAssetMetadataStale', () => {
  test('treats a token with nothing stored as stale', () => {
    expect(isAssetMetadataStale(undefined, Date.now())).toBe(true)
  })

  test('trusts an entry right up to the age limit', () => {
    const now = Date.now()

    expect(isAssetMetadataStale(entry('USDT', now - TOKEN_METADATA_MAX_AGE_MS), now)).toBe(false)
  })

  test('gives up on an entry a moment past the age limit', () => {
    const now = Date.now()

    expect(isAssetMetadataStale(entry('USDT', now - TOKEN_METADATA_MAX_AGE_MS - 1), now)).toBe(true)
  })
})

describe('HintsController token metadata', () => {
  test('remembers what it learned and keeps networks apart', async () => {
    const { hintsCtrl: controller } = await prepareTest()

    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, [[USDT, entry('USDT', Date.now())]])

    expect(controller.getKnownTokenMetadata(ETHEREUM_CHAIN_ID).get(USDT)?.symbol).toBe('USDT')
    expect(controller.getKnownTokenMetadata(BASE_CHAIN_ID).has(USDT)).toBe(false)
  })

  test('replaces an aged-out entry with the newly read one', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, [
      [USDT, entry('OLD', now - TOKEN_METADATA_MAX_AGE_MS - 1)]
    ])
    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, [[USDT, entry('NEW', now)]])

    const stored = controller.getKnownTokenMetadata(ETHEREUM_CHAIN_ID).get(USDT)

    expect(stored?.symbol).toBe('NEW')
    expect(isAssetMetadataStale(stored, now)).toBe(false)
  })

  test('drops the tokens read longest ago once a network is over the limit', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    // Well past the per-network cap, each entry read a little after the one before
    const manyTokens: [string, TokenMetadataEntry][] = Array.from({ length: 1200 }, (_, i) => [
      `0x${i.toString(16).padStart(40, '0')}`,
      entry(`T${i}`, now + i)
    ])

    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, manyTokens)

    const metadata = controller.getKnownTokenMetadata(ETHEREUM_CHAIN_ID)

    expect(metadata.size).toBe(1000)
    // The 200 oldest are gone, the newest are kept
    expect(metadata.has(manyTokens[0]![0])).toBe(false)
    expect(metadata.has(manyTokens[199]![0])).toBe(false)
    expect(metadata.has(manyTokens[200]![0])).toBe(true)
    expect(metadata.has(manyTokens[1199]![0])).toBe(true)
  })

  test('keeps every network intact when networks are learned one after another', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, [[USDT, entry('USDT', now)]])
    controller.learnTokenMetadata(BASE_CHAIN_ID, [[ADX, entry('ADX', now)]])

    expect(controller.getKnownTokenMetadata(ETHEREUM_CHAIN_ID).get(USDT)?.symbol).toBe('USDT')
    expect(controller.getKnownTokenMetadata(BASE_CHAIN_ID).get(ADX)?.symbol).toBe('ADX')
  })
})

describe('HintsController collection metadata', () => {
  test('keeps collection metadata apart from token metadata', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    controller.learnCollectionMetadata(ETHEREUM_CHAIN_ID, [[PUNKS, collectionEntry('PUNK', now)]])
    controller.learnTokenMetadata(ETHEREUM_CHAIN_ID, [[USDT, entry('USDT', now)]])

    expect(controller.getKnownCollectionMetadata(ETHEREUM_CHAIN_ID).get(PUNKS)?.symbol).toBe('PUNK')
    expect(controller.getKnownCollectionMetadata(ETHEREUM_CHAIN_ID).has(USDT)).toBe(false)
    expect(controller.getKnownTokenMetadata(ETHEREUM_CHAIN_ID).has(PUNKS)).toBe(false)
  })

  test('keeps networks apart', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    controller.learnCollectionMetadata(ETHEREUM_CHAIN_ID, [[PUNKS, collectionEntry('PUNK', now)]])
    controller.learnCollectionMetadata(BASE_CHAIN_ID, [[APES, collectionEntry('APE', now)]])

    expect(controller.getKnownCollectionMetadata(ETHEREUM_CHAIN_ID).get(PUNKS)?.name).toBe(
      'PUNK collection'
    )
    expect(controller.getKnownCollectionMetadata(ETHEREUM_CHAIN_ID).has(APES)).toBe(false)
    expect(controller.getKnownCollectionMetadata(BASE_CHAIN_ID).get(APES)?.symbol).toBe('APE')
  })

  test('drops the collections read longest ago once a network is over the limit', async () => {
    const { hintsCtrl: controller } = await prepareTest()
    const now = Date.now()

    // Well past the per-network cap, each entry read a little after the one before
    const manyCollections: [string, CollectionMetadataEntry][] = Array.from(
      { length: 1200 },
      (_, i) => [`0x${i.toString(16).padStart(40, '0')}`, collectionEntry(`C${i}`, now + i)]
    )

    controller.learnCollectionMetadata(ETHEREUM_CHAIN_ID, manyCollections)

    const metadata = controller.getKnownCollectionMetadata(ETHEREUM_CHAIN_ID)

    expect(metadata.size).toBe(1000)
    // The 200 oldest are gone, the newest are kept
    expect(metadata.has(manyCollections[0]![0])).toBe(false)
    expect(metadata.has(manyCollections[199]![0])).toBe(false)
    expect(metadata.has(manyCollections[200]![0])).toBe(true)
    expect(metadata.has(manyCollections[1199]![0])).toBe(true)
  })
})
