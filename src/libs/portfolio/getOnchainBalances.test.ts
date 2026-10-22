import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { getDeploylessOpts, getNFTs, getTokens, planMetaRequest } from './getOnchainBalances'
import { TOKEN_METADATA_MAX_AGE_MS } from './helpers'
import {
  CollectionMetadataFetchPlan,
  CollectionResult,
  KnownCollectionMetadata,
  KnownTokenMetadata,
  LimitsOptions,
  TokenError,
  TokenMetadataFetchPlan,
  TokenResult
} from './interfaces'

const ETHEREUM = networks.find(({ chainId }) => chainId === 1n)!
const ACCOUNT_ADDR = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ADX = '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const PUNKS = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'
const APES = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const NO_ERROR = '0x'

const NFT_LIMITS: LimitsOptions = {
  erc20: 100,
  erc20Simulation: 50,
  erc721: 10,
  erc721TokensInput: 5,
  erc721Tokens: 50
}

type RecordedCall = { method: string; args: any[] }

/**
 * A Deployless stand-in that records what was asked of it and replies with
 * canned decoded results, so the fetch split can be tested without a chain.
 */
const makeDeployless = (resultsByMethod: { [method: string]: any }) => {
  const calls: RecordedCall[] = []

  const deployless = {
    isLimitedAt24kbData: false,
    call: async (method: string, args: any[]) => {
      calls.push({ method, args })

      if (!(method in resultsByMethod)) throw new Error(`unexpected call to ${method}`)

      return resultsByMethod[method]
    }
  } as unknown as Deployless

  return { calls, deployless }
}

/**
 * getTokens is declared as returning a list of result pairs while it in fact
 * returns a single one, so the tokens are pulled out and typed here once instead
 * of in every test.
 */
const fetchTokens = async (
  deployless: Deployless,
  opts: Parameters<typeof getTokens>[2],
  tokenAddrs: string[]
): Promise<[TokenError, TokenResult][]> => {
  const result = await getTokens(ETHEREUM, deployless, opts, ACCOUNT_ADDR, tokenAddrs)

  return result[0] as unknown as [TokenError, TokenResult][]
}

/**
 * The getNFTs counterpart of fetchTokens.
 */
const fetchCollections = async (
  deployless: Deployless,
  opts: Parameters<typeof getNFTs>[2],
  collections: [string, bigint[]][]
): Promise<[TokenError, CollectionResult][]> => {
  const result = await getNFTs(ETHEREUM, deployless, opts, ACCOUNT_ADDR, collections, NFT_LIMITS)

  return result[0] as unknown as [TokenError, CollectionResult][]
}

const knownEntry = (symbol: string, name: string, decimals: number, fetchedAt = Date.now()) => ({
  symbol,
  name,
  decimals,
  fetchedAt
})

const makePlan = (
  known: [string, ReturnType<typeof knownEntry>][],
  needsMetadata: string[]
): TokenMetadataFetchPlan => ({
  known: new Map(known) as KnownTokenMetadata,
  needsMetadata: new Set(needsMetadata)
})

const knownCollectionEntry = (symbol: string, name: string, fetchedAt = Date.now()) => ({
  symbol,
  name,
  fetchedAt
})

const makeCollectionPlan = (
  known: [string, ReturnType<typeof knownCollectionEntry>][],
  needsMetadata: string[]
): CollectionMetadataFetchPlan => ({
  known: new Map(known) as KnownCollectionMetadata,
  needsMetadata: new Set(needsMetadata)
})

const balance = (amount: bigint, error = NO_ERROR) => ({ amount, error })
const meta = (symbol: string, name: string, decimals: number) => ({ symbol, name, decimals })
const nfts = (ids: bigint[], error = NO_ERROR) => ({ nfts: ids, error })
const collectionMeta = (symbol: string, name: string) => ({ symbol, name })

const simulationOf = (accountAddr: string) => {
  const account = {
    addr: accountAddr,
    associatedKeys: [accountAddr],
    initialPrivileges: [],
    creation: null
  }

  return {
    accountOps: [{ nonce: 1n, calls: [] }],
    baseAccount: {
      getAccount: () => account,
      shouldStateOverrideDuringSimulations: () => false
    },
    state: {}
  } as any
}

describe('getDeploylessOpts', () => {
  test('uses explicit deployless contract options before simulation state override options', () => {
    const verifierTo = '0x3f58D86408988FBD8aeEA5AD063173F249f5B214'

    expect(
      getDeploylessOpts('0x0000000000000000000000000000000000000001', ETHEREUM, {
        blockTag: 123,
        deployless: {
          mode: DeploylessMode.Predeployed,
          to: verifierTo
        },
        simulation: {} as any
      })
    ).toEqual({
      blockTag: 123,
      from: DEPLOYLESS_SIMULATION_FROM,
      mode: DeploylessMode.Predeployed,
      to: verifierTo,
      stateToOverride: null
    })
  })
})

describe('getTokens metadata split', () => {
  test('asks the chain for metadata only for the tokens missing from the plan', async () => {
    const { calls, deployless } = makeDeployless({
      getBalances: [
        [balance(10n), balance(20n), balance(30n)],
        [meta('ADX', 'AdEx Network', 18)],
        123
      ]
    })
    const plan = makePlan(
      [
        [USDT, knownEntry('USDT', 'Tether USD', 6)],
        [USDC, knownEntry('USDC', 'USD Coin', 6)]
      ],
      [ADX]
    )

    const tokens = await fetchTokens(deployless, { blockTag: 'latest', metadataPlan: plan }, [
      USDT,
      ADX,
      USDC
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('getBalances')
    // Balances for the whole page, metadata for ADX alone
    expect(calls[0]!.args[1]).toEqual([USDT, ADX, USDC])
    // Only ADX, which sits at index 1 of the page, is flagged
    expect(calls[0]!.args[2]).toBe('0x0001')

    expect(tokens.map(([, token]) => [token.symbol, token.decimals, token.amount])).toEqual([
      ['USDT', 6, 10n],
      ['ADX', 18, 20n],
      ['USDC', 6, 30n]
    ])
    expect(tokens.every(([error]) => error === NO_ERROR)).toBe(true)
  })

  test('asks for every token on the page when nothing is known yet', async () => {
    const { calls, deployless } = makeDeployless({
      getBalances: [[balance(10n)], [meta('USDT', 'Tether USD', 6)], 123]
    })

    const tokens = await fetchTokens(
      deployless,
      { blockTag: 'latest', metadataPlan: makePlan([], [USDT]) },
      [USDT]
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.args[2]).toBe('0x01')
    expect(tokens[0]![1].symbol).toBe('USDT')
  })

  test('keys the metadata by address, so a plan covering other pages still lines up', async () => {
    const { calls, deployless } = makeDeployless({
      getBalances: [[balance(10n), balance(20n)], [meta('USDC', 'USD Coin', 6)], 123]
    })
    // A plan covering tokens from other pages too. Only the ones on this page count.
    const plan = makePlan([[ADX, knownEntry('ADX', 'AdEx Network', 18)]], [USDT, USDC])

    const tokens = await fetchTokens(deployless, { blockTag: 'latest', metadataPlan: plan }, [
      USDC,
      ADX
    ])

    expect(calls[0]!.args[2]).toBe('0x01')
    expect(tokens.map(([, token]) => token.symbol)).toEqual(['USDC', 'ADX'])
  })

  test('reports a token whose read failed as errored, with an empty metadata entry', async () => {
    // The chain reads a token's balance and metadata with one call, so a failure of
    // either comes back as the balance error and an empty metadata entry
    const { deployless } = makeDeployless({
      getBalances: [[balance(10n), balance(0n, '0xdeadbeef')], [meta('', '', 0)], 123]
    })
    const plan = makePlan([[USDT, knownEntry('USDT', 'Tether USD', 6)]], [ADX])

    const tokens = await fetchTokens(deployless, { blockTag: 'latest', metadataPlan: plan }, [
      USDT,
      ADX
    ])

    expect(tokens[0]![0]).toBe(NO_ERROR)
    expect(tokens[1]![0]).toBe('0xdeadbeef')
    expect(tokens[1]![1].symbol).toBe('')
  })

  test('reports a failed balance read for a token whose metadata is known', async () => {
    const { deployless } = makeDeployless({
      getBalances: [[balance(0n, '0xbadbad'), balance(20n)], [meta('ADX', 'AdEx Network', 18)], 123]
    })
    const plan = makePlan([[USDT, knownEntry('USDT', 'Tether USD', 6)]], [ADX])

    const tokens = await fetchTokens(deployless, { blockTag: 'latest', metadataPlan: plan }, [
      USDT,
      ADX
    ])

    expect(tokens[0]![0]).toBe('0xbadbad')
    expect(tokens[1]![0]).toBe(NO_ERROR)
  })

  test('keeps the native token name and symbol coming from the network', async () => {
    const { deployless } = makeDeployless({
      getBalances: [[balance(5n), balance(20n)], [meta('ADX', 'AdEx Network', 18)], 123]
    })
    const plan = makePlan([[ZeroAddress, knownEntry('ETH', 'Ether', 18)]], [ADX])

    const tokens = await fetchTokens(deployless, { blockTag: 'latest', metadataPlan: plan }, [
      ZeroAddress,
      ADX
    ])

    expect(tokens[0]![1].symbol).toBe(ETHEREUM.nativeAssetSymbol)
    expect(tokens[0]![1].name).toBe(ETHEREUM.nativeAssetName)
  })
})

describe('getTokens metadata split during simulation', () => {
  const simulation = simulationOf(ACCOUNT_ADDR)

  test('lines the delta up with the right token when hits and misses are mixed', async () => {
    // USDT is known and its balance moves, ADX is unknown and its balance does not
    const { calls, deployless } = makeDeployless({
      simulateAndGetBalances: [
        { balances: [balance(13n), balance(20n)], nonce: 1n },
        { balances: [balance(8n)], nonce: 2n },
        [meta('ADX', 'AdEx Network', 18)],
        NO_ERROR,
        0,
        123,
        [USDT]
      ]
    })
    const plan = makePlan([[USDT, knownEntry('USDT', 'Tether USD', 6)]], [ADX])

    const tokens = await fetchTokens(
      deployless,
      { blockTag: 'latest', simulation, metadataPlan: plan },
      [USDT, ADX]
    )

    expect(calls[0]!.method).toBe('simulateAndGetBalances')
    expect(calls[0]!.args[2]).toEqual([USDT, ADX])
    expect(calls[0]!.args[3]).toBe('0x0001')

    const [usdt, adx] = tokens.map(([, token]) => token)

    expect(usdt!.symbol).toBe('USDT')
    expect(usdt!.amount).toBe(13n)
    expect(usdt!.simulationAmount).toBe(-5n)
    expect(usdt!.amountPostSimulation).toBe(8n)

    expect(adx!.symbol).toBe('ADX')
    expect(adx!.amount).toBe(20n)
    expect(adx!.simulationAmount).toBeUndefined()
    expect(adx!.amountPostSimulation).toBe(20n)
  })

  test('lines the delta up when the unknown token is the one that moves', async () => {
    const { deployless } = makeDeployless({
      simulateAndGetBalances: [
        { balances: [balance(13n), balance(20n)], nonce: 1n },
        { balances: [balance(50n)], nonce: 2n },
        [meta('ADX', 'AdEx Network', 18)],
        NO_ERROR,
        0,
        123,
        [ADX]
      ]
    })
    const plan = makePlan([[USDT, knownEntry('USDT', 'Tether USD', 6)]], [ADX])

    const tokens = await fetchTokens(
      deployless,
      { blockTag: 'latest', simulation, metadataPlan: plan },
      [USDT, ADX]
    )

    const [usdt, adx] = tokens.map(([, token]) => token)

    expect(usdt!.simulationAmount).toBeUndefined()
    expect(usdt!.amountPostSimulation).toBe(13n)

    expect(adx!.symbol).toBe('ADX')
    expect(adx!.simulationAmount).toBe(30n)
    expect(adx!.amountPostSimulation).toBe(50n)
  })

  test('makes a single call with every address when the whole page is unknown', async () => {
    const { calls, deployless } = makeDeployless({
      simulateAndGetBalances: [
        { balances: [balance(20n)], nonce: 1n },
        { balances: [], nonce: 2n },
        [meta('ADX', 'AdEx Network', 18)],
        NO_ERROR,
        0,
        123,
        []
      ]
    })

    const tokens = await fetchTokens(
      deployless,
      { blockTag: 'latest', simulation, metadataPlan: makePlan([], [ADX]) },
      [ADX]
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('simulateAndGetBalances')
    expect(calls[0]!.args[3]).toBe('0x01')
    expect(tokens[0]![1].symbol).toBe('ADX')
  })
})

describe('getNFTs metadata split', () => {
  test('asks the chain for metadata only for the collections missing from the plan', async () => {
    const { calls, deployless } = makeDeployless({
      getAllNFTs: [[nfts([1n, 2n]), nfts([7n])], [collectionMeta('APE', 'Bored Ape Yacht Club')]]
    })
    const plan = makeCollectionPlan([[PUNKS, knownCollectionEntry('PUNK', 'CryptoPunks')]], [APES])

    const collections = await fetchCollections(
      deployless,
      { blockTag: 'latest', metadataPlan: plan },
      [
        [PUNKS, [1n, 2n]],
        [APES, [7n]]
      ]
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('getAllNFTs')
    expect(calls[0]!.args[1]).toEqual([PUNKS, APES])
    expect(calls[0]!.args[4]).toBe('0x0001')

    const [punks, apes] = collections.map(([, collection]) => collection)

    expect(punks!.name).toBe('CryptoPunks')
    expect(punks!.symbol).toBe('PUNK')
    expect(punks!.collectibles).toEqual([1n, 2n])
    expect(punks!.amount).toBe(2n)
    expect(punks!.decimals).toBe(1)

    expect(apes!.name).toBe('Bored Ape Yacht Club')
    expect(apes!.symbol).toBe('APE')
    expect(apes!.amount).toBe(1n)
    expect(collections.every(([error]) => error === NO_ERROR)).toBe(true)
  })

  test('caps the passed token ids at the input limit', async () => {
    const { calls, deployless } = makeDeployless({
      getAllNFTs: [[nfts([1n])], [collectionMeta('APE', 'Bored Ape Yacht Club')]]
    })
    const tooManyIds = [1n, 2n, 3n, 4n, 5n, 6n, 7n]

    await fetchCollections(
      deployless,
      { blockTag: 'latest', metadataPlan: makeCollectionPlan([], [APES]) },
      [[APES, tooManyIds]]
    )

    expect(calls[0]!.args[2]).toEqual([tooManyIds.slice(0, NFT_LIMITS.erc721TokensInput)])
    expect(calls[0]!.args[4]).toBe('0x01')
  })

  test('reports a collection whose read failed as errored, with an empty metadata entry', async () => {
    const { deployless } = makeDeployless({
      getAllNFTs: [[nfts([1n]), nfts([], '0xdeadbeef')], [collectionMeta('', '')]]
    })
    const plan = makeCollectionPlan([[PUNKS, knownCollectionEntry('PUNK', 'CryptoPunks')]], [APES])

    const collections = await fetchCollections(
      deployless,
      { blockTag: 'latest', metadataPlan: plan },
      [
        [PUNKS, [1n]],
        [APES, [7n]]
      ]
    )

    expect(collections[0]![0]).toBe(NO_ERROR)
    expect(collections[1]![0]).toBe('0xdeadbeef')
    expect(collections[1]![1].name).toBe('')
  })

  test('reports a failed token ids read for a collection whose metadata is known', async () => {
    const { deployless } = makeDeployless({
      getAllNFTs: [
        [nfts([], '0xbadbad'), nfts([7n])],
        [collectionMeta('APE', 'Bored Ape Yacht Club')]
      ]
    })
    const plan = makeCollectionPlan([[PUNKS, knownCollectionEntry('PUNK', 'CryptoPunks')]], [APES])

    const collections = await fetchCollections(
      deployless,
      { blockTag: 'latest', metadataPlan: plan },
      [
        [PUNKS, [1n]],
        [APES, [7n]]
      ]
    )

    expect(collections[0]![0]).toBe('0xbadbad')
    expect(collections[1]![0]).toBe(NO_ERROR)
  })

  test('leaves the name and symbol empty when nothing is stored and nothing was asked for', async () => {
    const { calls, deployless } = makeDeployless({
      getAllNFTs: [[nfts([1n])], []]
    })

    const collections = await fetchCollections(
      deployless,
      { blockTag: 'latest', metadataPlan: makeCollectionPlan([], []) },
      [[PUNKS, [1n]]]
    )

    expect(calls[0]!.args[4]).toBe('0x')
    expect(collections[0]![1].name).toBe('')
    expect(collections[0]![1].symbol).toBe('')
  })
})

describe('getNFTs metadata split during simulation', () => {
  const simulation = simulationOf(ACCOUNT_ADDR)

  test('works out what is sent and received, with metadata from both sources', async () => {
    // PUNKS is known and its collectibles change, APES is unknown and unchanged
    const { calls, deployless } = makeDeployless({
      simulateAndGetAllNFTs: [
        { collections: [nfts([1n, 2n]), nfts([7n])], nonce: 1n },
        { collections: [nfts([2n, 3n])], nonce: 2n },
        [collectionMeta('APE', 'Bored Ape Yacht Club')],
        NO_ERROR,
        0,
        123,
        [PUNKS]
      ]
    })
    const plan = makeCollectionPlan([[PUNKS, knownCollectionEntry('PUNK', 'CryptoPunks')]], [APES])

    const collections = await fetchCollections(
      deployless,
      { blockTag: 'latest', simulation, metadataPlan: plan },
      [
        [PUNKS, [1n, 2n, 3n]],
        [APES, [7n]]
      ]
    )

    expect(calls[0]!.method).toBe('simulateAndGetAllNFTs')
    expect(calls[0]!.args[5]).toBe('0x0001')

    const [punks, apes] = collections.map(([, collection]) => collection)

    expect(punks!.name).toBe('CryptoPunks')
    expect(punks!.amount).toBe(2n)
    expect(punks!.amountPostSimulation).toBe(2n)
    expect(punks!.simulationAmount).toBe(0n)
    expect(punks!.postSimulation).toEqual({ sending: [1n], receiving: [3n] })

    expect(apes!.name).toBe('Bored Ape Yacht Club')
    expect(apes!.simulationAmount).toBeUndefined()
    expect(apes!.amountPostSimulation).toBe(1n)
    expect(apes!.postSimulation).toEqual({ sending: [], receiving: [] })
  })

  test('counts a received collectible in the post simulation amount', async () => {
    const { deployless } = makeDeployless({
      simulateAndGetAllNFTs: [
        { collections: [nfts([1n])], nonce: 1n },
        { collections: [nfts([1n, 5n])], nonce: 2n },
        [collectionMeta('PUNK', 'CryptoPunks')],
        NO_ERROR,
        0,
        123,
        [PUNKS]
      ]
    })

    const collections = await fetchCollections(
      deployless,
      {
        blockTag: 'latest',
        simulation,
        metadataPlan: makeCollectionPlan([], [PUNKS])
      },
      [[PUNKS, [1n, 5n]]]
    )

    const punks = collections[0]![1]

    expect(punks.simulationAmount).toBe(1n)
    expect(punks.amountPostSimulation).toBe(2n)
    expect(punks.postSimulation).toEqual({ sending: [], receiving: [5n] })
  })

  test('leaves the simulation fields alone when the nonce did not move', async () => {
    const { deployless } = makeDeployless({
      simulateAndGetAllNFTs: [
        { collections: [nfts([1n])], nonce: 5n },
        { collections: [], nonce: 5n },
        [collectionMeta('PUNK', 'CryptoPunks')],
        NO_ERROR,
        0,
        123,
        []
      ]
    })

    const collections = await fetchCollections(
      deployless,
      {
        blockTag: 'latest',
        simulation: { ...simulation, accountOps: [] },
        metadataPlan: makeCollectionPlan([], [PUNKS])
      },
      [[PUNKS, [1n]]]
    )

    const punks = collections[0]![1]

    expect(punks.simulationAmount).toBeUndefined()
    expect(punks.amountPostSimulation).toBe(1n)
  })
})

describe('TOKEN_METADATA_MAX_AGE_MS', () => {
  test('is long enough to spare repeat reads but short enough to catch a rename', () => {
    const oneDay = 24 * 60 * 60 * 1000

    expect(TOKEN_METADATA_MAX_AGE_MS).toBeGreaterThanOrEqual(oneDay)
    expect(TOKEN_METADATA_MAX_AGE_MS).toBeLessThanOrEqual(30 * oneDay)
  })
})

describe('planMetaRequest', () => {
  test('flags the assets that need metadata and nothing else', () => {
    const { metaFlags, metaIndexByAddress } = planMetaRequest(
      [USDT, ADX, USDC],
      new Set([USDT, USDC])
    )

    expect(metaFlags).toBe('0x010001')
    // The contract packs the metadata in page order, so USDT comes before USDC
    expect([...metaIndexByAddress]).toEqual([
      [USDT, 0],
      [USDC, 1]
    ])
  })

  test('asks for nothing when everything is known', () => {
    expect(planMetaRequest([USDT, ADX], new Set()).metaFlags).toBe('0x')
  })

  test('leaves the trailing known assets out of the flags', () => {
    expect(planMetaRequest([USDT, ADX, USDC], new Set([USDT])).metaFlags).toBe('0x01')
  })

  test('ignores addresses that are not on the page', () => {
    const { metaFlags, metaIndexByAddress } = planMetaRequest([USDT], new Set([USDT, ADX]))

    expect(metaFlags).toBe('0x01')
    expect(metaIndexByAddress.has(ADX)).toBe(false)
  })

  test('handles a page longer than a word of flags', () => {
    const page = Array.from({ length: 300 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`)
    const { metaFlags, metaIndexByAddress } = planMetaRequest(page, new Set([page[0]!, page[299]!]))

    // One byte per asset up to the last one flagged
    expect(metaFlags.length).toBe(2 + 300 * 2)
    expect(metaFlags.startsWith('0x0100')).toBe(true)
    expect(metaFlags.endsWith('01')).toBe(true)
    expect([...metaIndexByAddress.values()]).toEqual([0, 1])
  })
})
