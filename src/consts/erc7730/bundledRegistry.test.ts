import { id, isHexString } from 'ethers'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

import { describe, expect, test } from '@jest/globals'

import { SUPPORTED_ERC7730_SCHEMA_FILES } from '../../libs/humanizer/erc7730/consts'
import {
  getSchemaFileName,
  mergeDescriptors,
  validateDescriptor
} from '../../libs/humanizer/erc7730/descriptor'
import { Erc7730Descriptor, Erc7730Field } from '../../libs/humanizer/erc7730/types'
import { getRegistryKey } from '../../libs/humanizer/erc7730/utils'
import { amendments } from '../../../scripts/erc7730/amendments'
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

/** Whether a key is written the way lookups build it: `eip155:{chainId}:{lowercase address}` */
const isRegistryKey = (key: string) => {
  const [, chainId = '', address = ''] = key.split(':')

  return isHexString(address, 20) && getRegistryKey(chainId, address) === key
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

  test('has the keys of both indexes written the way lookups build them', () => {
    const keys = [...Object.keys(calldataIndex), ...Object.keys(eip712Index)]

    expect(keys.filter((key) => !isRegistryKey(key))).toEqual([])
  })

  test('has a descriptor path in every index entry', () => {
    const invalidPaths = [...Object.values(calldataIndex), ...getEip712Paths()].filter(
      (path) => typeof path !== 'string'
    )

    expect(invalidPaths).toEqual([])
  })

  test('has only 32 byte hashes as the encode type hashes of the EIP-712 index', () => {
    const invalidHashes = Object.values(eip712Index)
      .flatMap((entriesByPrimaryType) => Object.values(entriesByPrimaryType).flat())
      .flatMap(({ encodeTypeHashes = [] }) => encodeTypeHashes)
      .filter((hash) => !isHexString(hash, 32))

    expect(invalidHashes).toEqual([])
  })

  test('has only valid descriptors', () => {
    const invalidPaths = Object.entries(descriptors)
      .filter(([, descriptor]) => {
        try {
          return !validateDescriptor(descriptor)
        } catch {
          return true
        }
      })
      .map(([path]) => path)

    expect(invalidPaths).toEqual([])
  })

  test('has only descriptors of a supported version of ERC-7730', () => {
    const unsupportedPaths = Object.entries(descriptors)
      .filter(
        ([, descriptor]) => !SUPPORTED_ERC7730_SCHEMA_FILES.has(getSchemaFileName(descriptor) ?? '')
      )
      .map(([path]) => path)

    expect(unsupportedPaths).toEqual([])
  })

  test('has the descriptor of every index entry', () => {
    const paths = [...Object.values(calldataIndex), ...getEip712Paths()]
    const missingPaths = paths.filter((path) => !isOwnKey(descriptors, path))

    expect([...new Set(missingPaths)]).toEqual([])
  })

  test('has every descriptor a descriptor includes, by its name', () => {
    const missingIncludes = Object.entries(descriptors).flatMap(([path, descriptor]) =>
      getIncludes(descriptor)
        .filter((includedPath) => !isOwnKey(descriptors, includedPath))
        .map((includedPath) => `${path} -> ${includedPath}`)
    )

    expect(missingIncludes).toEqual([])
  })

  test('names descriptors by their path in the upstream registry', () => {
    const otherPaths = [
      ...Object.keys(descriptors),
      ...Object.values(calldataIndex),
      ...getEip712Paths()
    ].filter((path) => !path.startsWith('registry/') && !path.startsWith('ercs/'))

    expect([...new Set(otherPaths)]).toEqual([])
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

  test('uses each added descriptor for its key', () => {
    Object.entries(amendments.addCalldataDescriptors).forEach(([key, name]) => {
      expect(calldataIndex[key]).toBe(name)
    })
  })

  test('uses each amended descriptor for the keys it lists', () => {
    Object.entries(amendments.amendCalldataDescriptors).forEach(([name, { addresses }]) => {
      addresses.forEach((key) => expect(calldataIndex[key]).toBe(name))
    })
  })

  test('shows the destination network of LiFi by its name', () => {
    const lifi = getMergedDescriptor('registry/lifi/calldata-LIFIDiamond.json')
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
        'registry/cow-protocol/calldata-GPv2Settlement.json'
      )
      expect(Object.keys(eip712Index[settlementKey] ?? {}).sort()).toEqual([
        'Order',
        'OrderCancellations'
      ])
      expect(
        calldataIndex[getRegistryKey(chainId, '0xba3cb449bd2b4adddbc894d8697f5170800eadec')]
      ).toBe('registry/cow-protocol/calldata-CoWSwapEthFlow.json')
    })

    const ethFlow = getMergedDescriptor('registry/cow-protocol/calldata-CoWSwapEthFlow.json')
    const unwrapFields = ethFlow.display?.formats?.['unwrap(uint256 amount)']?.fields

    expect(unwrapFields?.map(({ format }) => format)).toEqual(['amount'])
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
