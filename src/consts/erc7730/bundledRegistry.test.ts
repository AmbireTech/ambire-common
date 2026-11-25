import { describe, expect, test } from '@jest/globals'

import { SUPPORTED_ERC7730_SCHEMA_FILES } from '../../libs/humanizer/erc7730/consts'
import {
  getSchemaFileName,
  resolveIncludePath,
  validateCalldataIndex,
  validateDescriptor,
  validateEip712Index
} from '../../libs/humanizer/erc7730/registry'
import { FALLBACK_CALLDATA_INDEX, OVERRIDE_CALLDATA_INDEX } from './ambireDescriptors'
import upstreamFallbackCalldataIndex from './fallbackCalldataIndex.json'
import { BUNDLED_ERC7730_REGISTRY } from '.'
import upstreamRegistry from './registry.json'

// The script that generates `registry.json`, for its own include resolution. It runs nothing when
// imported
// eslint-disable-next-line @typescript-eslint/no-require-imports
const generatorScript = require('../../../scripts/updateErc7730Registry')
const resolveScriptIncludePath: (includePath: string, parentPath: string) => string =
  generatorScript.resolveIncludePath

// Run these after refreshing `registry.json` with `npm run humanizer:update:erc7730Registry`.

const { calldataIndex, eip712Index, descriptors } = BUNDLED_ERC7730_REGISTRY

const isOwnKey = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key)

/** The registry path an `includes` entry points at, as the wallet looks it up */
const getIncludedPath = (includePath: string, descriptorPath: string) =>
  resolveIncludePath(includePath, descriptorPath).slice(1)

const getIncludes = (descriptor: unknown): string[] => {
  if (!descriptor || typeof descriptor !== 'object' || !('includes' in descriptor)) return []

  const { includes } = descriptor
  if (typeof includes === 'string') return [includes]

  return Array.isArray(includes) ? includes : []
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

  test('has valid indexes', () => {
    expect(validateCalldataIndex(calldataIndex)).toBe(true)
    expect(validateEip712Index(eip712Index)).toBe(true)
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

  test('has every descriptor a descriptor includes', () => {
    const missingIncludes = Object.entries(descriptors).flatMap(([path, descriptor]) =>
      getIncludes(descriptor)
        .map((includePath) => getIncludedPath(includePath, path))
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

  test('resolves includes the same way as the script that bundles them', () => {
    const cases: [includePath: string, parentPath: string][] = [
      ['common.json', 'registry/morpho/calldata-vault.json'],
      ['./common.json', 'registry/morpho/calldata-vault.json'],
      ['../../ercs/eip712-erc2612-permit.json', 'registry/permit/eip712-token.json'],
      ['/ercs/calldata-erc20-tokens.json', 'registry/foo/calldata-token.json'],
      ['common a.json', 'registry/foo/calldata-token.json'],
      ['common#1.json', 'registry/foo/calldata-token.json'],
      ['common?v=1.json', 'registry/foo/calldata-token.json'],
      ['commön.json', 'registry/foo/calldata-token.json'],
      ['common%20a.json', 'registry/foo/calldata-token.json'],
      ['../../../../outside.json', 'registry/foo/calldata-token.json'],
      ['common.json', 'registry/morpho/calldata-mev_capital-USUALUSDC+.json']
    ]

    cases.forEach(([includePath, parentPath]) => {
      expect(resolveScriptIncludePath(includePath, parentPath)).toBe(
        getIncludedPath(includePath, parentPath)
      )
    })
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
