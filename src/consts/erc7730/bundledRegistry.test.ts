import { isHexString } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { SUPPORTED_ERC7730_SCHEMA_FILES } from '../../libs/humanizer/erc7730/consts'
import { getSchemaFileName, validateDescriptor } from '../../libs/humanizer/erc7730/descriptor'
import { getRegistryKey } from '../../libs/humanizer/erc7730/utils'
import { FALLBACK_CALLDATA_INDEX, OVERRIDE_CALLDATA_INDEX } from './ambireDescriptors'
import upstreamFallbackCalldataIndex from './fallbackCalldataIndex.json'
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

  test('has the descriptor of every Ambire fallback that points at the registry', () => {
    const missingPaths = Object.values(upstreamFallbackCalldataIndex).filter(
      (path) => !isOwnKey(descriptors, path)
    )

    expect([...new Set(missingPaths)]).toEqual([])
  })

  test("uses Ambire's overrides over the registry's descriptors", () => {
    Object.entries(OVERRIDE_CALLDATA_INDEX).forEach(([key, path]) => {
      expect(calldataIndex[key]).toBe(path)
    })
  })

  test("uses the registry's descriptors over Ambire's fallbacks", () => {
    const upstreamCalldataIndex: Record<string, string> = upstreamRegistry.calldataIndex

    Object.entries(FALLBACK_CALLDATA_INDEX)
      .filter(([key]) => !isOwnKey(OVERRIDE_CALLDATA_INDEX, key))
      .forEach(([key, path]) => {
        expect(calldataIndex[key]).toBe(upstreamCalldataIndex[key] ?? path)
      })
  })
})
