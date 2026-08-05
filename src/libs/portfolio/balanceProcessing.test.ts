import { encodeFunctionResult } from 'viem'

import { describe, expect, test } from '@jest/globals'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { networks } from '../../consts/networks'
import { processBalances, processCollections } from './balanceProcessing'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
// USDC.e on Optimism, which the oracle reports with the symbol "USDC"
const USDC_E_OPTIMISM = '0x7f5c764cbc14f9669b88837ca1490cca17c31607'

type TokenInfo = {
  symbol: string
  name: string
  amount: bigint
  decimals: number
  error: `0x${string}`
}

const tokenInfo = (over: Partial<TokenInfo> = {}): TokenInfo => ({
  symbol: 'USDC',
  name: 'USD Coin',
  amount: 1_000_000n,
  decimals: 6,
  error: '0x',
  ...over
})

const encodeBalances = (tokens: TokenInfo[], blockNumber: bigint) =>
  encodeFunctionResult({
    abi: BalanceGetter.abi,
    functionName: 'getBalances',
    result: [tokens, blockNumber]
  })

const encodeSimulatedBalances = (args: {
  before: TokenInfo[]
  beforeNonce: bigint
  after: TokenInfo[]
  afterNonce: bigint
  simulationErr?: `0x${string}`
  blockNumber?: bigint
  deltaAddressesMapping: string[]
}) =>
  encodeFunctionResult({
    abi: BalanceGetter.abi,
    functionName: 'simulateAndGetBalances',
    result: [
      { balances: args.before, nonce: args.beforeNonce },
      { balances: args.after, nonce: args.afterNonce },
      args.simulationErr ?? '0x',
      0n,
      args.blockNumber ?? 1234n,
      args.deltaAddressesMapping
    ]
  })

type NftInfo = { name: string; symbol: string; nfts: bigint[]; error: `0x${string}` }

const nftInfo = (over: Partial<NftInfo> = {}): NftInfo => ({
  name: 'Cool Cats',
  symbol: 'COOL',
  nfts: [1n, 2n],
  error: '0x',
  ...over
})

const encodeAllNfts = (collections: NftInfo[]) =>
  encodeFunctionResult({
    abi: NFTGetter.abi,
    functionName: 'getAllNFTs',
    // A single ABI output is passed unwrapped, unlike multi-output functions
    result: collections
  })

const encodeSimulatedNfts = (args: {
  before: NftInfo[]
  beforeNonce: bigint
  after: NftInfo[]
  afterNonce: bigint
  deltaAddressesMapping: string[]
}) =>
  encodeFunctionResult({
    abi: NFTGetter.abi,
    functionName: 'simulateAndGetAllNFTs',
    result: [
      { collections: args.before, nonce: args.beforeNonce },
      { collections: args.after, nonce: args.afterNonce },
      '0x',
      0n,
      0n,
      args.deltaAddressesMapping
    ]
  })

describe('processBalances — getBalances', () => {
  test('maps every token slot in call order and returns the block number', () => {
    const data = encodeBalances(
      [
        tokenInfo({ symbol: 'USDC', name: 'USD Coin', amount: 5n, decimals: 6 }),
        tokenInfo({ symbol: 'DAI', name: 'Dai Stablecoin', amount: 7n, decimals: 18 })
      ],
      999n
    )

    const result = processBalances({
      kind: 'getBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC, '0x6B175474E89094C44Da98b954EedeAC495271d0F']
    })

    expect(result.blockNumber).toBe(999n)
    expect(result.simulation).toBeNull()
    expect(result.tokens).toHaveLength(2)

    const [firstError, firstToken] = result.tokens[0]!
    const [, secondToken] = result.tokens[1]!
    expect(firstError).toBe('0x')
    expect(firstToken.address).toBe(USDC)
    expect(firstToken.symbol).toBe('USDC')
    expect(firstToken.amount).toBe(5n)
    expect(firstToken.decimals).toBe(6)
    expect(firstToken.chainId).toBe(1n)

    expect(secondToken.symbol).toBe('DAI')
    expect(secondToken.amount).toBe(7n)
    expect(secondToken.decimals).toBe(18)
  })

  test('uses the network native asset name and symbol for the zero address', () => {
    const data = encodeBalances([tokenInfo({ symbol: 'ETH', name: 'Ether', decimals: 18 })], 1n)

    const result = processBalances({
      kind: 'getBalances',
      data,
      network: ethereum,
      tokenAddrs: [ZERO_ADDRESS]
    })

    const [, token] = result.tokens[0]!
    expect(token.name).toBe(ethereum.nativeAssetName)
    expect(token.symbol).toBe(ethereum.nativeAssetSymbol)
  })

  test('overrides the symbol the oracle reports for USDC.e', () => {
    const optimism = networks.find(({ chainId }) => chainId === 10n)!
    const data = encodeBalances([tokenInfo({ symbol: 'USDC' })], 1n)

    const result = processBalances({
      kind: 'getBalances',
      data,
      network: optimism,
      tokenAddrs: [USDC_E_OPTIMISM]
    })

    const [, token] = result.tokens[0]!
    expect(token.symbol).toBe('USDC.E')
  })

  test('surfaces a per-token error without failing the whole page', () => {
    const data = encodeBalances(
      [tokenInfo({ error: '0xdeadbeef' }), tokenInfo({ symbol: 'DAI' })],
      1n
    )

    const result = processBalances({
      kind: 'getBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC, '0x6B175474E89094C44Da98b954EedeAC495271d0F']
    })

    expect(result.tokens[0]![0]).toBe('0xdeadbeef')
    expect(result.tokens[1]![0]).toBe('0x')
    expect(result.tokens[1]![1].symbol).toBe('DAI')
  })

  test('throws on empty return data rather than returning an empty page', () => {
    expect(() =>
      processBalances({ kind: 'getBalances', data: '0x', network: ethereum, tokenAddrs: [] })
    ).toThrow('empty or malformed return data for getBalances')
  })

  test('throws on undecodable return data', () => {
    expect(() =>
      processBalances({
        kind: 'getBalances',
        data: '0xdeadbeefdeadbeef',
        network: ethereum,
        tokenAddrs: [USDC]
      })
    ).toThrow()
  })

  test('adds latestAmount and pendingAmount only when the block tag is both', () => {
    const data = encodeBalances([tokenInfo({ amount: 42n })], 1n)
    const input = {
      kind: 'getBalances' as const,
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    }

    const withoutBoth = processBalances(input)
    expect(withoutBoth.tokens[0]![1]).not.toHaveProperty('latestAmount')

    const withBoth = processBalances({ ...input, blockTag: 'both' })
    expect(withBoth.tokens[0]![1]).toMatchObject({ latestAmount: 42n, pendingAmount: 42n })
  })

  test('applies the custom and hidden flags from specialErc20Hints', () => {
    const data = encodeBalances([tokenInfo()], 1n)

    const result = processBalances({
      kind: 'getBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC],
      specialErc20Hints: { custom: [USDC], hidden: [USDC], learn: [] }
    })

    expect(result.tokens[0]![1].flags.isCustom).toBe(true)
    expect(result.tokens[0]![1].flags.isHidden).toBe(true)
  })
})

describe('processBalances — simulateAndGetBalances', () => {
  test('computes simulationAmount and amountPostSimulation from the delta mapping', () => {
    // Balance before the simulation is 13, after it is 8, so the pending change
    // is -5 and the balance to display afterwards is 8
    const data = encodeSimulatedBalances({
      before: [tokenInfo({ amount: 13n })],
      beforeNonce: 1n,
      after: [tokenInfo({ amount: 8n })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    const [, token] = result.tokens[0]!
    expect(token.amount).toBe(13n)
    expect(token.simulationAmount).toBe(-5n)
    expect(token.amountPostSimulation).toBe(8n)
    expect(result.simulation).toEqual({
      simulationErrData: '0x',
      beforeNonce: 1n,
      afterNonce: 2n
    })
  })

  test('treats an unchanged nonce as no simulation having run', () => {
    const data = encodeSimulatedBalances({
      before: [tokenInfo({ amount: 13n })],
      beforeNonce: 5n,
      after: [tokenInfo({ amount: 8n })],
      afterNonce: 5n,
      deltaAddressesMapping: [USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    const [, token] = result.tokens[0]!
    expect(token.simulationAmount).toBeUndefined()
    // Falls back to the pre-simulation amount, not the after-simulation one
    expect(token.amountPostSimulation).toBe(13n)
  })

  test('leaves a token absent from the delta mapping untouched', () => {
    const data = encodeSimulatedBalances({
      before: [tokenInfo({ amount: 13n }), tokenInfo({ symbol: 'DAI', amount: 100n })],
      beforeNonce: 1n,
      after: [tokenInfo({ amount: 8n })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC, '0x6B175474E89094C44Da98b954EedeAC495271d0F']
    })

    const [, untouched] = result.tokens[1]!
    expect(untouched.simulationAmount).toBeUndefined()
    expect(untouched.amountPostSimulation).toBe(100n)
  })

  test('matches delta addresses case-sensitively, so a lowercased request address misses', () => {
    // Decoding always yields checksummed addresses, and this branch compares
    // them to the requested addresses verbatim. A caller that asked with a
    // lowercased address therefore sees no simulation for that token, unlike
    // the NFT branch below which compares case-insensitively.
    const data = encodeSimulatedBalances({
      before: [tokenInfo({ amount: 13n })],
      beforeNonce: 1n,
      after: [tokenInfo({ amount: 8n })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC.toLowerCase()]
    })

    expect(result.tokens[0]![1].simulationAmount).toBeUndefined()
    expect(result.tokens[0]![1].amountPostSimulation).toBe(13n)
  })

  test('keeps the first entry when the delta mapping repeats an address', () => {
    const data = encodeSimulatedBalances({
      before: [tokenInfo({ amount: 13n })],
      beforeNonce: 1n,
      after: [tokenInfo({ amount: 8n }), tokenInfo({ amount: 999n })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC, USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    expect(result.tokens[0]![1].amountPostSimulation).toBe(8n)
  })

  test('returns the simulation error data for the caller to handle', () => {
    const data = encodeSimulatedBalances({
      before: [tokenInfo()],
      beforeNonce: 1n,
      after: [tokenInfo()],
      afterNonce: 2n,
      simulationErr: '0xbadc0ffee0',
      deltaAddressesMapping: [USDC]
    })

    const result = processBalances({
      kind: 'simulateAndGetBalances',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    expect(result.simulation?.simulationErrData).toBe('0xbadc0ffee0')
  })
})

describe('processCollections — getAllNFTs', () => {
  test('maps every collection with its collectibles and count', () => {
    const data = encodeAllNfts([nftInfo({ nfts: [1n, 2n, 3n] })])

    const result = processCollections({
      kind: 'getAllNFTs',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    expect(result.simulation).toBeNull()
    const [, collection] = result.collections[0]!
    expect(collection.address).toBe(USDC)
    expect(collection.symbol).toBe('COOL')
    expect(collection.amount).toBe(3n)
    expect(collection.decimals).toBe(1)
    expect(collection.collectibles).toEqual([1n, 2n, 3n])
  })

  test('throws on empty return data', () => {
    expect(() =>
      processCollections({
        kind: 'getAllNFTs',
        data: '0x',
        network: ethereum,
        tokenAddrs: []
      })
    ).toThrow('empty or malformed return data for getAllNFTs')
  })
})

describe('processCollections — simulateAndGetAllNFTs', () => {
  test('splits collectibles into sending and receiving', () => {
    const data = encodeSimulatedNfts({
      before: [nftInfo({ nfts: [1n, 2n] })],
      beforeNonce: 1n,
      after: [nftInfo({ nfts: [2n, 3n] })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC]
    })

    const result = processCollections({
      kind: 'simulateAndGetAllNFTs',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    const [, collection] = result.collections[0]!
    expect(collection.postSimulation).toEqual({ sending: [1n], receiving: [3n] })
    expect(collection.amountPostSimulation).toBe(2n)
    expect(collection.simulationAmount).toBe(0n)
  })

  test('matches delta addresses case-insensitively, unlike the ERC20 branch', () => {
    const data = encodeSimulatedNfts({
      before: [nftInfo({ nfts: [1n] })],
      beforeNonce: 1n,
      after: [nftInfo({ nfts: [1n, 9n] })],
      afterNonce: 2n,
      deltaAddressesMapping: [USDC.toLowerCase()]
    })

    const result = processCollections({
      kind: 'simulateAndGetAllNFTs',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    expect(result.collections[0]![1].postSimulation).toEqual({ sending: [], receiving: [9n] })
  })

  test('reports nothing moved when the nonce is unchanged', () => {
    const data = encodeSimulatedNfts({
      before: [nftInfo({ nfts: [1n, 2n] })],
      beforeNonce: 3n,
      after: [nftInfo({ nfts: [] })],
      afterNonce: 3n,
      deltaAddressesMapping: [USDC]
    })

    const result = processCollections({
      kind: 'simulateAndGetAllNFTs',
      data,
      network: ethereum,
      tokenAddrs: [USDC]
    })

    const [, collection] = result.collections[0]!
    expect(collection.postSimulation).toEqual({ sending: [], receiving: [] })
    expect(collection.simulationAmount).toBeUndefined()
    expect(collection.amountPostSimulation).toBe(2n)
  })
})
