import { describe, expect, test } from '@jest/globals'

import {
  buildRegistry,
  CALLDATA_INDEX_FILE,
  EIP712_INDEX_FILE,
  RegistryBuildError,
  resolveIncludePath,
  UpstreamFiles
} from './build'

const SCHEMA = '../../specs/erc7730-v2.schema.json'
const KEY = 'eip155:1:0x1111111111111111111111111111111111111111'
const OTHER_KEY = 'eip155:10:0x2222222222222222222222222222222222222222'

const descriptor = (extra: Record<string, unknown> = {}) => ({
  $schema: SCHEMA,
  display: { formats: { 'transfer(address to,uint256 amount)': { intent: 'Send', fields: [] } } },
  ...extra
})

/** Upstream files from a map of path -> parsed JSON */
const upstreamOf = (files: Record<string, unknown>): UpstreamFiles => ({
  paths: new Set(Object.keys(files)),
  read: (path) => structuredClone(files[path])
})

const withIndexes = (
  files: Record<string, unknown>,
  calldataIndex: Record<string, unknown> = {},
  eip712Index: Record<string, unknown> = {}
) =>
  upstreamOf({ [CALLDATA_INDEX_FILE]: calldataIndex, [EIP712_INDEX_FILE]: eip712Index, ...files })

/** The problems a build reports, or [] if it succeeds */
const getProblems = (upstream: UpstreamFiles, extraPaths?: string[]): string[] => {
  try {
    buildRegistry(upstream, extraPaths)
    return []
  } catch (error) {
    if (error instanceof RegistryBuildError) return error.problems
    throw error
  }
}

describe('buildRegistry', () => {
  test('bundles the indexed descriptors and what they include', () => {
    const upstream = withIndexes(
      {
        'registry/a/calldata-A.json': descriptor({ includes: 'common-A.json' }),
        'registry/a/common-A.json': { $schema: SCHEMA, metadata: { owner: 'A' } },
        'registry/b/eip712-B.json': descriptor({ includes: '../../ercs/eip712-permit.json' }),
        'ercs/eip712-permit.json': descriptor(),
        'registry/unused/calldata-Unused.json': descriptor()
      },
      { [KEY]: 'registry/a/calldata-A.json' },
      { [OTHER_KEY]: { Permit: [{ path: 'registry/b/eip712-B.json', encodeTypeHashes: ['0x1'] }] } }
    )

    const registry = buildRegistry(upstream)

    expect(Object.keys(registry.descriptors)).toEqual([
      'ercs/eip712-permit.json',
      'registry/a/calldata-A.json',
      'registry/a/common-A.json',
      'registry/b/eip712-B.json'
    ])
    expect(registry.calldataIndex).toEqual({ [KEY]: 'registry/a/calldata-A.json' })
    expect(registry.eip712Index[OTHER_KEY]?.Permit?.[0]?.path).toBe('registry/b/eip712-B.json')
  })

  test('fails when an index points at a descriptor that is not in the registry', () => {
    const upstream = withIndexes({}, { [KEY]: 'registry/a/calldata-Missing.json' })

    expect(getProblems(upstream)).toEqual([
      `${CALLDATA_INDEX_FILE} (${KEY}) points at registry/a/calldata-Missing.json, which is not in the registry`
    ])
  })

  test('fails when a descriptor includes one that is not in the registry', () => {
    const upstream = withIndexes(
      {
        'registry/a/calldata-A.json': descriptor({ includes: ['common-A.json', 'common-B.json'] })
      },
      { [KEY]: 'registry/a/calldata-A.json' }
    )

    expect(getProblems(upstream)).toEqual([
      'registry/a/calldata-A.json (includes) points at registry/a/common-A.json, which is not in the registry',
      'registry/a/calldata-A.json (includes) points at registry/a/common-B.json, which is not in the registry'
    ])
  })

  test('fails for a descriptor of an unsupported version of ERC-7730, or of none', () => {
    const upstream = withIndexes(
      {
        'registry/a/calldata-V3.json': descriptor({
          $schema: '../../specs/erc7730-v3.schema.json'
        }),
        'registry/a/calldata-None.json': descriptor({ $schema: undefined })
      },
      { [KEY]: 'registry/a/calldata-V3.json', [OTHER_KEY]: 'registry/a/calldata-None.json' }
    )

    expect(getProblems(upstream)).toEqual([
      'registry/a/calldata-V3.json: its version of ERC-7730 is not supported: erc7730-v3.schema.json',
      'registry/a/calldata-None.json: its version of ERC-7730 is not supported: it declares none'
    ])
  })

  test('fails for an included descriptor of an unsupported version', () => {
    const upstream = withIndexes(
      {
        'registry/a/calldata-A.json': descriptor({ includes: 'common-A.json' }),
        'registry/a/common-A.json': { $schema: 'erc7730-v1.schema.json' }
      },
      { [KEY]: 'registry/a/calldata-A.json' }
    )

    expect(getProblems(upstream)).toEqual([
      'registry/a/common-A.json: its version of ERC-7730 is not supported: erc7730-v1.schema.json'
    ])
  })

  test('fails for invalid descriptors and files that are not JSON', () => {
    const upstream: UpstreamFiles = {
      ...withIndexes(
        {
          'registry/a/calldata-Invalid.json': descriptor({ display: { formats: [] } }),
          'registry/a/calldata-Broken.json': null
        },
        {
          [KEY]: 'registry/a/calldata-Invalid.json',
          [OTHER_KEY]: 'registry/a/calldata-Broken.json'
        }
      )
    }
    const { read } = upstream
    upstream.read = (path) => {
      if (path === 'registry/a/calldata-Broken.json') throw new Error('Unexpected token')
      return read(path)
    }

    expect(getProblems(upstream)).toEqual([
      'registry/a/calldata-Invalid.json: it is not a valid descriptor',
      "registry/a/calldata-Broken.json can't be read: Unexpected token"
    ])
  })

  test('fails for index keys not written as lookups build them', () => {
    const upperCaseKey = 'eip155:1:0xAbCdEf1111111111111111111111111111111111'
    const upstream = withIndexes(
      { 'registry/a/calldata-A.json': descriptor() },
      {
        [upperCaseKey]: 'registry/a/calldata-A.json',
        'eip155:1:0x12': 'registry/a/calldata-A.json'
      }
    )

    expect(getProblems(upstream)).toEqual([
      `${CALLDATA_INDEX_FILE} (${upperCaseKey}): the key is not written as expected`,
      `${CALLDATA_INDEX_FILE} (eip155:1:0x12): the key is not written as expected`
    ])
  })

  test('fails for EIP-712 index entries not written as expected', () => {
    const upstream = withIndexes(
      {},
      {},
      { [KEY]: { Permit: [{ path: 1 }], Order: { path: 'registry/a/eip712-A.json' } } }
    )

    expect(getProblems(upstream)).toEqual([
      `${EIP712_INDEX_FILE} (${KEY}) (Permit): the entries are not written as expected`,
      `${EIP712_INDEX_FILE} (${KEY}) (Order): the entries are not written as expected`
    ])
  })

  test('lists every problem, not only the first', () => {
    const upstream = withIndexes(
      { 'registry/a/calldata-A.json': descriptor({ includes: 'https://example.com/common.json' }) },
      { [KEY]: 'registry/a/calldata-A.json', [OTHER_KEY]: 'registry/b/calldata-Missing.json' }
    )

    expect(getProblems(upstream)).toHaveLength(2)
  })

  test('bundles extra descriptors and fails when one is missing', () => {
    const upstream = withIndexes({ 'registry/safe/calldata-Safe.json': descriptor() })

    expect(
      Object.keys(buildRegistry(upstream, ['registry/safe/calldata-Safe.json']).descriptors)
    ).toEqual(['registry/safe/calldata-Safe.json'])
    expect(getProblems(upstream, ['registry/safe/calldata-Gone.json'])).toEqual([
      "Ambire's fallback index points at registry/safe/calldata-Gone.json, which is not in the registry"
    ])
  })

  test('fails when the registry has no indexes', () => {
    expect(getProblems(upstreamOf({}))).toEqual([
      `The registry has no ${CALLDATA_INDEX_FILE}`,
      `The registry has no ${EIP712_INDEX_FILE}`
    ])
  })
})

describe('resolveIncludePath', () => {
  const PARENT_PATH = 'registry/morpho/calldata-vault.json'

  test('resolves paths relative to the folder of the descriptor that includes them', () => {
    expect(resolveIncludePath('common.json', PARENT_PATH)).toBe('registry/morpho/common.json')
    expect(resolveIncludePath('./common.json', PARENT_PATH)).toBe('registry/morpho/common.json')
    expect(resolveIncludePath('../../ercs/permit.json', PARENT_PATH)).toBe('ercs/permit.json')
    expect(resolveIncludePath('/ercs/tokens.json', PARENT_PATH)).toBe('ercs/tokens.json')
    expect(resolveIncludePath('common a#1?.json', PARENT_PATH)).toBe(
      'registry/morpho/common a#1?.json'
    )
  })

  test('refuses URLs, paths outside the registry and files that are not JSON', () => {
    expect(() => resolveIncludePath('https://example.com/common.json', PARENT_PATH)).toThrow('URL')
    expect(() => resolveIncludePath('../../../outside.json', PARENT_PATH)).toThrow('outside')
    expect(() => resolveIncludePath('common.yaml', PARENT_PATH)).toThrow('not JSON')
  })
})
