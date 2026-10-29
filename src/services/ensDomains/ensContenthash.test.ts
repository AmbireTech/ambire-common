import { makeError } from 'ethers'
import {
  decodeFunctionData,
  encodeFunctionResult,
  Hex,
  namehash,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { expect } from '@jest/globals'

import { RPCProvider } from '../../interfaces/provider'
import {
  ENS_REGISTRY,
  ENS_REGISTRY_DEPLOYMENT_BLOCK,
  EnsWebsiteContentUpdateAbortedError,
  getEnsNameFromGatewayUrl,
  getEnsWebsiteContentUpdate
} from './ensContenthash'

const ensAbi = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function contenthash(bytes32 node) view returns (bytes)'
])
const CONTENTHASH_SELECTOR = toFunctionSelector('function contenthash(bytes32)')

const ENS_NAME = 'tornadocash.eth'
const NODE = namehash(ENS_NAME)
const LATEST_BLOCK = 25_000_000
const RESOLVER = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41'
const OLD_RESOLVER = '0xD3ddcCDD3b25A8a7423B5bEe360a42146eb4Baf3'
const IPFS_CONTENT_A: Hex = '0xe30101701220aaaa'
const IPFS_CONTENT_B: Hex = '0xe30101701220bbbb'
const IPNS_CONTENT: Hex = '0xe5010170000f6170702e756e69737761702e6f7267'

/** A record value that applies from `fromBlock` until the next entry. */
type HistoryEntry<T> = { fromBlock: number; value: T }

const valueAt = <T>(history: HistoryEntry<T>[], block: number, fallback: T) =>
  [...history].reverse().find((entry) => entry.fromBlock <= block)?.value ?? fallback

const getBlockTimestampInSeconds = (block: number) => 1_600_000_000 + block * 12

/**
 * A provider that answers `resolver()` and `contenthash()` calls as the ENS contracts would have
 * at each block, according to the given history.
 */
const createHistoricalProvider = ({
  resolverHistory,
  contenthashHistory,
  revertingResolvers = [],
  failingBlocks = []
}: {
  resolverHistory: HistoryEntry<string>[]
  contenthashHistory: { [resolver: string]: HistoryEntry<Hex>[] }
  /** Resolvers that revert on `contenthash()`, like old ones without support for it */
  revertingResolvers?: string[]
  /** Blocks where the RPC fails for a reason unrelated to the records */
  failingBlocks?: number[]
}) => {
  const calls: { to: string; blockTag: number }[] = []

  const provider = {
    getBlockNumber: async () => LATEST_BLOCK,
    getBlock: async (block: number) => ({ timestamp: getBlockTimestampInSeconds(block) }),
    call: async ({ to, data, blockTag }: { to: string; data: Hex; blockTag: number }) => {
      calls.push({ to, blockTag })
      if (failingBlocks.includes(blockTag)) throw new Error('rate limited')

      if (to === ENS_REGISTRY) {
        const { args } = decodeFunctionData({ abi: ensAbi, data })
        if (args[0] !== NODE)
          return encodeFunctionResult({
            abi: ensAbi,
            functionName: 'resolver',
            result: zeroAddress
          })
        return encodeFunctionResult({
          abi: ensAbi,
          functionName: 'resolver',
          result: valueAt(resolverHistory, blockTag, zeroAddress) as Hex
        })
      }

      if (!data.startsWith(CONTENTHASH_SELECTOR)) throw new Error('unexpected call')
      if (revertingResolvers.includes(to)) {
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: null,
          reason: null,
          transaction: { to, data },
          invocation: null,
          revert: null
        })
      }

      return encodeFunctionResult({
        abi: ensAbi,
        functionName: 'contenthash',
        result: valueAt(contenthashHistory[to] || [], blockTag, '0x')
      })
    }
  }

  return { provider: provider as unknown as RPCProvider, calls }
}

const expectUpdatedAround = (updatedAt: number | undefined, changeBlock: number) => {
  expect(updatedAt).toBeDefined()
  const foundBlock = (updatedAt! / 1000 - getBlockTimestampInSeconds(0)) / 12
  // Never before the change - that would make a recent change look older than it is
  expect(foundBlock).toBeGreaterThanOrEqual(changeBlock)
  expect(foundBlock).toBeLessThanOrEqual(changeBlock + 32)
}

describe('getEnsNameFromGatewayUrl', () => {
  it('returns the ENS name of websites opened through eth.limo and eth.link', () => {
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth.limo')).toBe('tornadocash.eth')
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth.limo/#/swap')).toBe('tornadocash.eth')
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth.link')).toBe('tornadocash.eth')
    expect(getEnsNameFromGatewayUrl('https://TornadoCash.ETH.limo')).toBe('tornadocash.eth')
  })

  it('keeps subnames', () => {
    expect(getEnsNameFromGatewayUrl('https://app.uniswap.eth.limo')).toBe('app.uniswap.eth')
  })

  it('returns null for websites not served from an ENS name', () => {
    expect(getEnsNameFromGatewayUrl('https://app.uniswap.org')).toBeNull()
    expect(getEnsNameFromGatewayUrl('https://eth.limo')).toBeNull()
    expect(getEnsNameFromGatewayUrl('https://tornadocash-eth.limo')).toBeNull()
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth')).toBeNull()
    expect(getEnsNameFromGatewayUrl('not a url')).toBeNull()
  })

  it('returns null for look-alike domains that only contain the gateway domain', () => {
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth.limo.evil.com')).toBeNull()
    expect(getEnsNameFromGatewayUrl('https://tornadocash.eth.limoevil.com')).toBeNull()
  })
})

describe('getEnsWebsiteContentUpdate', () => {
  it('finds a recent change of the website content', async () => {
    const changeBlock = LATEST_BLOCK - 1_234
    const { provider, calls } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {
        [RESOLVER]: [
          { fromBlock: 10_000_000, value: IPFS_CONTENT_A },
          { fromBlock: changeBlock, value: IPFS_CONTENT_B }
        ]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, changeBlock)
    // Stays far from scanning every block
    expect(calls.length).toBeLessThan(200)
  })

  it('finds an old change of the website content', async () => {
    const changeBlock = 12_345_678
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {
        [RESOLVER]: [
          { fromBlock: 10_000_000, value: IPFS_CONTENT_A },
          { fromBlock: changeBlock, value: IPFS_CONTENT_B }
        ]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, changeBlock)
  })

  it('finds a change made in the latest block', async () => {
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {
        [RESOLVER]: [
          { fromBlock: 10_000_000, value: IPFS_CONTENT_A },
          { fromBlock: LATEST_BLOCK, value: IPFS_CONTENT_B }
        ]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expect(result?.updatedAt).toBe(getBlockTimestampInSeconds(LATEST_BLOCK) * 1000)
  })

  it('finds the most recent of several changes', async () => {
    const lastChangeBlock = LATEST_BLOCK - 50_000
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {
        [RESOLVER]: [
          { fromBlock: 10_000_000, value: IPFS_CONTENT_A },
          { fromBlock: 15_000_000, value: IPFS_CONTENT_B },
          { fromBlock: 20_000_000, value: IPFS_CONTENT_A },
          { fromBlock: lastChangeBlock, value: IPFS_CONTENT_B }
        ]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, lastChangeBlock)
  })

  it('treats switching to a resolver with different content as a change', async () => {
    // The new resolver had its content set long before the owner switched to it
    const switchBlock = LATEST_BLOCK - 7_000
    const { provider } = createHistoricalProvider({
      resolverHistory: [
        { fromBlock: 10_000_000, value: OLD_RESOLVER },
        { fromBlock: switchBlock, value: RESOLVER }
      ],
      contenthashHistory: {
        [OLD_RESOLVER]: [{ fromBlock: 10_000_000, value: IPFS_CONTENT_A }],
        [RESOLVER]: [{ fromBlock: 11_000_000, value: IPFS_CONTENT_B }]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, switchBlock)
  })

  it('does not treat switching to a resolver with the same content as a change', async () => {
    const contentBlock = 11_000_000
    const { provider } = createHistoricalProvider({
      resolverHistory: [
        { fromBlock: 10_000_000, value: OLD_RESOLVER },
        { fromBlock: LATEST_BLOCK - 7_000, value: RESOLVER }
      ],
      contenthashHistory: {
        [OLD_RESOLVER]: [{ fromBlock: contentBlock, value: IPFS_CONTENT_A }],
        [RESOLVER]: [{ fromBlock: 10_000_000, value: IPFS_CONTENT_A }]
      }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, contentBlock)
  })

  it('treats an old resolver that cannot answer as having had no content', async () => {
    const switchBlock = 14_000_000
    const { provider } = createHistoricalProvider({
      resolverHistory: [
        { fromBlock: 10_000_000, value: OLD_RESOLVER },
        { fromBlock: switchBlock, value: RESOLVER }
      ],
      contenthashHistory: { [RESOLVER]: [{ fromBlock: 10_000_000, value: IPFS_CONTENT_A }] },
      revertingResolvers: [OLD_RESOLVER]
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expectUpdatedAround(result?.updatedAt, switchBlock)
  })

  it('returns the registry deployment time when the content never changed since', async () => {
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 0, value: RESOLVER }],
      contenthashHistory: { [RESOLVER]: [{ fromBlock: 0, value: IPFS_CONTENT_A }] }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expect(result?.updatedAt).toBe(getBlockTimestampInSeconds(ENS_REGISTRY_DEPLOYMENT_BLOCK) * 1000)
  })

  it('returns null for IPNS content, which can change without an on-chain record', async () => {
    const { provider, calls } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: { [RESOLVER]: [{ fromBlock: 10_000_000, value: IPNS_CONTENT }] }
    })

    expect(await getEnsWebsiteContentUpdate(provider, ENS_NAME)).toBeNull()
    // Only the current record is read
    expect(calls).toHaveLength(2)
  })

  it('returns null when the name has no content or no resolver', async () => {
    const { provider: noContentProvider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {}
    })
    const { provider: noResolverProvider } = createHistoricalProvider({
      resolverHistory: [],
      contenthashHistory: {}
    })

    expect(await getEnsWebsiteContentUpdate(noContentProvider, ENS_NAME)).toBeNull()
    expect(await getEnsWebsiteContentUpdate(noResolverProvider, ENS_NAME)).toBeNull()
  })

  it('fails instead of returning a wrong date when the RPC fails', async () => {
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: { [RESOLVER]: [{ fromBlock: 10_000_000, value: IPFS_CONTENT_A }] },
      failingBlocks: [LATEST_BLOCK - 1]
    })

    await expect(getEnsWebsiteContentUpdate(provider, ENS_NAME)).rejects.toThrow('rate limited')
  })

  it('returns what it found along with the checked content and block', async () => {
    const { provider } = createHistoricalProvider({
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: { [RESOLVER]: [{ fromBlock: 10_000_000, value: IPFS_CONTENT_A }] }
    })

    const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME)

    expect(result).toEqual({
      updatedAt: expect.any(Number),
      contenthash: IPFS_CONTENT_A,
      checkedAtBlock: LATEST_BLOCK
    })
  })

  describe('with the result of a previous search', () => {
    const previousCheckBlock = LATEST_BLOCK - 100_000
    const previousUpdate = {
      updatedAt: getBlockTimestampInSeconds(12_000_000) * 1000,
      contenthash: IPFS_CONTENT_A,
      checkedAtBlock: previousCheckBlock
    }

    it('only checks the blocks after it when the content is the same', async () => {
      const { provider, calls } = createHistoricalProvider({
        resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
        contenthashHistory: { [RESOLVER]: [{ fromBlock: 12_000_000, value: IPFS_CONTENT_A }] }
      })

      const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME, { previousUpdate })

      expect(result).toEqual({ ...previousUpdate, checkedAtBlock: LATEST_BLOCK })
      expect(calls.every(({ blockTag }) => blockTag >= previousCheckBlock)).toBe(true)
      expect(calls.length).toBeLessThan(50)
    })

    it('searches again when the content changed since', async () => {
      const changeBlock = LATEST_BLOCK - 5_000
      const { provider } = createHistoricalProvider({
        resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
        contenthashHistory: {
          [RESOLVER]: [
            { fromBlock: 12_000_000, value: IPFS_CONTENT_A },
            { fromBlock: changeBlock, value: IPFS_CONTENT_B }
          ]
        }
      })

      const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME, { previousUpdate })

      expectUpdatedAround(result?.updatedAt, changeBlock)
      expect(result?.contenthash).toBe(IPFS_CONTENT_B)
    })

    it('SECURITY: finds a switch to other content and back that happened since', async () => {
      // The owner served other content for a while, then switched back to the old one
      const switchBackBlock = LATEST_BLOCK - 20_000
      const { provider } = createHistoricalProvider({
        resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
        contenthashHistory: {
          [RESOLVER]: [
            { fromBlock: 12_000_000, value: IPFS_CONTENT_A },
            { fromBlock: LATEST_BLOCK - 60_000, value: IPFS_CONTENT_B },
            { fromBlock: switchBackBlock, value: IPFS_CONTENT_A }
          ]
        }
      })

      const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME, { previousUpdate })

      expectUpdatedAround(result?.updatedAt, switchBackBlock)
    })

    it('does not check blocks newer than the latest one when the RPC is behind', async () => {
      const { provider, calls } = createHistoricalProvider({
        resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
        contenthashHistory: { [RESOLVER]: [{ fromBlock: 12_000_000, value: IPFS_CONTENT_A }] }
      })

      const result = await getEnsWebsiteContentUpdate(provider, ENS_NAME, {
        previousUpdate: { ...previousUpdate, checkedAtBlock: LATEST_BLOCK + 3 }
      })

      expect(result?.updatedAt).toBe(previousUpdate.updatedAt)
      expect(calls.every(({ blockTag }) => blockTag <= LATEST_BLOCK)).toBe(true)
    })
  })

  it('stops the search once it is aborted', async () => {
    const history = {
      resolverHistory: [{ fromBlock: 10_000_000, value: RESOLVER }],
      contenthashHistory: {
        [RESOLVER]: [
          { fromBlock: 10_000_000, value: IPFS_CONTENT_A },
          { fromBlock: 12_345_678, value: IPFS_CONTENT_B }
        ]
      }
    }
    const { provider: fullSearchProvider, calls: fullSearchCalls } =
      createHistoricalProvider(history)
    await getEnsWebsiteContentUpdate(fullSearchProvider, ENS_NAME)

    const { provider, calls } = createHistoricalProvider(history)
    const abortController = new AbortController()
    const originalCall = provider.call.bind(provider)
    provider.call = async (tx) => {
      // Aborted while the first step of the search is in progress
      if (calls.length === 10) abortController.abort()
      return originalCall(tx)
    }

    await expect(
      getEnsWebsiteContentUpdate(provider, ENS_NAME, { signal: abortController.signal })
    ).rejects.toThrow(EnsWebsiteContentUpdateAbortedError)
    // Only the step that was in progress completes
    expect(calls.length).toBeLessThan(fullSearchCalls.length / 2)
  })
})
