import { id, ZeroAddress } from 'ethers'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { isDeepStrictEqual as isEqual } from 'util'

import { describe, expect, test } from '@jest/globals'

import { mergeDescriptors } from '../../libs/humanizer/erc7730/descriptor'
import { Erc7730Descriptor, Erc7730Field } from '../../libs/humanizer/erc7730/types'
import { getRegistryKey } from '../../libs/humanizer/erc7730/utils'
import lifiAmendment from '../../../scripts/erc7730/amendments/lifi.json'
import { BUNDLED_ERC7730_REGISTRY } from '.'
import upstreamRegistry from './registry.json'

// Run these after refreshing `registry.json` with `npm run humanizer:update:erc7730Registry`.

const { calldataIndex, eip712Index, descriptors } = BUNDLED_ERC7730_REGISTRY

const isOwnKey = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key)

const getIncludes = (descriptor: unknown): string[] => {
  if (!descriptor || typeof descriptor !== 'object' || !('includes' in descriptor)) return []

  const { includes } = descriptor
  if (typeof includes === 'string') return [includes]

  return Array.isArray(includes) ? includes : []
}

/** A descriptor merged with everything it includes, as the wallet reads it */
const getMergedDescriptor = (name: string): Erc7730Descriptor => {
  const descriptor = descriptors[name] as Erc7730Descriptor

  return mergeDescriptors(
    getIncludes(descriptor).reduce<Erc7730Descriptor>(
      (merged, include) => mergeDescriptors(merged, getMergedDescriptor(include)),
      {}
    ),
    descriptor
  )
}

const getFields = (descriptor: Erc7730Descriptor): Erc7730Field[] => {
  const collect = (fields: Erc7730Field[] = []): Erc7730Field[] =>
    fields.flatMap((field) => [field, ...collect(field.fields)])

  return Object.values(descriptor.display?.formats ?? {}).flatMap(({ fields }) => collect(fields))
}

const getEip712Paths = () =>
  Object.values(eip712Index).flatMap((entriesByPrimaryType) =>
    Object.values(entriesByPrimaryType).flatMap((entries) => entries.map(({ path }) => path))
  )

describe('bundled ERC-7730 registry', () => {
  test('has the registry and its descriptors', () => {
    expect(upstreamRegistry.source.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(calldataIndex).length).toBeGreaterThan(0)
    expect(Object.keys(eip712Index).length).toBeGreaterThan(0)
    expect(Object.keys(descriptors).length).toBeGreaterThan(0)
  })

  test('has the descriptor of every index entry', () => {
    const paths = [...Object.values(calldataIndex), ...getEip712Paths()]
    const missingPaths = paths.filter((path) => !isOwnKey(descriptors, path))

    expect([...new Set(missingPaths)]).toEqual([])
  })

  test('has every descriptor a descriptor includes, by its path', () => {
    const missingIncludes = Object.entries(descriptors).flatMap(([path, descriptor]) =>
      getIncludes(descriptor)
        .filter((includedPath) => !isOwnKey(descriptors, includedPath))
        .map((includedPath) => `${path} -> ${includedPath}`)
    )

    expect(missingIncludes).toEqual([])
  })
})

describe("Ambire's changes to the bundled ERC-7730 registry", () => {
  const COW_SWAP_CHAIN_IDS = [1, 56, 100, 137, 8453, 9745, 42161, 43114, 57073, 59144, 11155111]

  test('has the encode type hash of a format of the descriptor in every EIP-712 index entry', () => {
    const unknownHashes = Object.entries(eip712Index).flatMap(([key, entriesByPrimaryType]) =>
      Object.values(entriesByPrimaryType)
        .flat()
        .flatMap(({ path: name, encodeTypeHashes = [] }) => {
          const formatHashes = Object.keys(getMergedDescriptor(name).display?.formats ?? {}).map(
            (format) => id(format)
          )
          return encodeTypeHashes
            .filter((hash) => !formatHashes.includes(hash.toLowerCase()))
            .map((hash) => `${key} ${name} ${hash}`)
        })
    )

    expect(unknownHashes).toEqual([])
  })

  test('shows the ETH sent to the Uniswap V3 position manager instead of refusing it', () => {
    const valueFields = getFields(
      getMergedDescriptor(
        'ambire-change/registry/uniswap/calldata-UniswapV3NonfungiblePositionManager.json'
      )
    ).filter((field) => field.path === '@.value')

    expect(valueFields.filter((field) => isEqual(field.visible, { ifNotIn: [0] }))).toHaveLength(14)
    expect(
      valueFields.filter((field) => typeof field.visible === 'object' && field.visible.mustMatch)
    ).toEqual([])
  })

  test('shows the destination network of LiFi by its name', () => {
    const lifi = getMergedDescriptor('ambire-change/registry/lifi/calldata-LIFIDiamond.json')
    const chainIdFields = getFields(lifi).filter((field) =>
      field.path?.endsWith('destinationChainId')
    )

    expect(chainIdFields.length).toBeGreaterThan(0)
    expect(chainIdFields.every((field) => field.format === 'enum')).toBe(true)
    expect((lifi.metadata?.enums as Record<string, unknown>).destinationChainId).toEqual(
      lifiAmendment.chainNames
    )
    expect(Object.keys(lifi.display?.formats ?? {})).toEqual(
      expect.arrayContaining(Object.keys(lifiAmendment.legacyFormats))
    )
  })

  test('describes CoW Swap orders and EthFlow on all of its networks', () => {
    COW_SWAP_CHAIN_IDS.forEach((chainId) => {
      const settlementKey = getRegistryKey(chainId, '0x9008d19f58aabd9ed0d60971565aa8510560ab41')
      expect(calldataIndex[settlementKey]).toBe(
        'ambire-new/registry/cow-protocol/calldata-GPv2Settlement.json'
      )
      expect(Object.keys(eip712Index[settlementKey] ?? {}).sort()).toEqual([
        'Order',
        'OrderCancellations'
      ])
      expect(
        calldataIndex[getRegistryKey(chainId, '0xba3cb449bd2b4adddbc894d8697f5170800eadec')]
      ).toBe('ambire-change/registry/cow-protocol/calldata-CoWSwapEthFlow.json')
    })

    const ethFlow = getMergedDescriptor(
      'ambire-change/registry/cow-protocol/calldata-CoWSwapEthFlow.json'
    )
    const unwrapFields = ethFlow.display?.formats?.['unwrap(uint256 amount)']?.fields

    expect(unwrapFields?.map(({ format }) => format)).toEqual(['amount'])
    // It is used on every CoW network, so no text names ETH: the native token is shown as a token
    const texts = Object.values(ethFlow.display?.formats ?? {}).flatMap((format) => [
      format.intent,
      format.interpolatedIntent,
      ...getFields({ display: { formats: { format } } }).map(({ label }) => label)
    ])
    expect(texts.filter((text) => typeof text === 'string' && /\bW?ETH\b/.test(text))).toEqual([])
    expect(ethFlow.metadata?.constants).toMatchObject({ nativeToken: ZeroAddress })
    expect(
      Object.keys(ethFlow.display?.formats ?? {}).some((format) =>
        format.startsWith('invalidateOrdersIgnoringNotAllowed(')
      )
    ).toBe(true)
  })

  test('is not imported by the code the wallet runs', () => {
    const readSources = (folder: string): string[] =>
      readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(folder, entry.name)
        if (entry.isDirectory()) return readSources(entryPath)
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
        const importsScripts = readFileSync(entryPath, 'utf8')
          .split('\n')
          .some(
            (line) =>
              (line.includes(' from ') || line.includes('require(')) &&
              line.includes('scripts/erc7730')
          )
        return importsScripts ? [entryPath] : []
      })

    expect(readSources(path.join(__dirname, '..', '..'))).toEqual([])
  })
})
