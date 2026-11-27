import { id } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Amendment, Amendments, applyAmendments, NO_AMENDMENTS } from './amend'
import { BuiltRegistry, RegistryBuildError } from './build'

const SCHEMA = '../../specs/erc7730-v2.schema.json'
const KEY = 'eip155:1:0x1111111111111111111111111111111111111111'
const OTHER_KEY = 'eip155:10:0x1111111111111111111111111111111111111111'
const NEW_KEY = 'eip155:56:0x1111111111111111111111111111111111111111'
const ORDER = 'Order(address token,uint256 amount)'
const CANCEL = 'Cancel(bytes uid)'

const valueField = { path: '@.value', label: 'ETH Sent', visible: { mustMatch: [0] } }

const upstreamRegistry = (): BuiltRegistry => ({
  calldataIndex: { [KEY]: 'pool/calldata-Pool.json', [OTHER_KEY]: 'pool/calldata-Pool.json' },
  eip712Index: {
    [KEY]: { Permit: [{ path: 'permit/eip712-Permit.json', encodeTypeHashes: ['0x01'] }] }
  },
  descriptors: {
    'pool/calldata-Pool.json': {
      $schema: SCHEMA,
      includes: 'pool/common-Pool.json',
      display: { formats: { 'mint()': { intent: 'Mint', fields: [valueField] } } }
    },
    'pool/common-Pool.json': {
      $schema: SCHEMA,
      display: {
        formats: {
          'burn()': { intent: 'Burn', fields: [{ path: 'x', fields: [valueField] }] }
        }
      }
    },
    'permit/eip712-Permit.json': {
      $schema: SCHEMA,
      display: { formats: { 'Permit(address spender)': { intent: 'Permit', fields: [] } } }
    }
  }
})

const fixValue: Amendment = {
  reason: 'test',
  addresses: [KEY],
  amend: ({ fields, expectMatches }) => {
    const matches = fields((field) => field.path === '@.value')
    expectMatches('value fields', matches, 2).forEach(({ field }) => {
      field.visible = { ifNotIn: [0] }
    })
  }
}

const withAmendments = (amendments: Partial<Amendments>): Amendments => ({
  ...NO_AMENDMENTS,
  ...amendments
})

/** The problems an amendment reports, or [] if it applies */
const getProblems = (
  amendments: Partial<Amendments>,
  ownDescriptors: Record<string, unknown> = {},
  registry = upstreamRegistry()
): string[] => {
  try {
    applyAmendments(registry, withAmendments(amendments), ownDescriptors)
    return []
  } catch (error) {
    if (error instanceof RegistryBuildError) return error.problems
    throw error
  }
}

describe('applyAmendments: amends', () => {
  test('amends the descriptor with what it includes merged into it', () => {
    const { registry, notes } = applyAmendments(
      upstreamRegistry(),
      withAmendments({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue } }),
      {}
    )
    const amended = registry.descriptors['pool/calldata-Pool.json'] as any

    expect(amended.includes).toBeUndefined()
    expect(amended.display.formats['mint()'].fields[0].visible).toEqual({ ifNotIn: [0] })
    expect(amended.display.formats['burn()'].fields[0].fields[0].visible).toEqual({ ifNotIn: [0] })
    // The included descriptor itself is left as it is
    expect(
      (registry.descriptors['pool/common-Pool.json'] as any).display.formats['burn()'].fields[0]
        .fields[0].visible
    ).toEqual({ mustMatch: [0] })
    expect(notes).toContain(`pool/calldata-Pool.json is also amended for ${OTHER_KEY}`)
  })

  test('fails when what it expects is no longer there', () => {
    const registry = upstreamRegistry()
    ;(registry.descriptors['pool/calldata-Pool.json'] as any).display.formats['mint()'].fields = []

    expect(
      getProblems(
        { amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue } },
        {},
        registry
      )
    ).toEqual(['The amend of pool/calldata-Pool.json (test): expected 2 value fields, found 1'])
  })

  test('fails with expectEqual when a value changed upstream', () => {
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ descriptor, expectEqual }) => {
        expectEqual('the mint intent', descriptor.display?.formats?.['mint()']?.intent, 'Add')
      }
    }

    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment } })
    ).toEqual([
      'The amend of pool/calldata-Pool.json (test): expected the mint intent to be "Add", found "Mint"'
    ])
  })

  test('fails when it checks nothing', () => {
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ descriptor }) => {
        descriptor.metadata = { owner: 'Pool' }
      }
    }

    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment } })
    ).toEqual([
      'The amend of pool/calldata-Pool.json (test): it checks nothing. Use expectMatches or expectEqual'
    ])
  })

  test('fails when it changes nothing', () => {
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ fields, expectMatches }) => {
        expectMatches(
          'value fields',
          fields((field) => field.path === '@.value'),
          2
        )
      }
    }

    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment } })
    ).toEqual(['The amend of pool/calldata-Pool.json (test): it changes nothing'])
  })

  test('fails when it gives a different result each time', () => {
    let runs = 0
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ descriptor, expectMatches }) => {
        expectMatches('runs', [runs], 1)
        runs += 1
        descriptor.metadata = { runs }
      }
    }

    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment } })
    ).toEqual([
      'The amend of pool/calldata-Pool.json (test): it gives a different result each time it runs'
    ])
  })

  test('fails when a listed contract no longer uses the descriptor', () => {
    expect(
      getProblems({
        amendCalldataDescriptors: {
          'pool/calldata-Pool.json': { ...fixValue, addresses: [KEY, NEW_KEY] }
        }
      })
    ).toEqual([`The amend of pool/calldata-Pool.json (test): ${NEW_KEY} no longer use it`])
  })

  test('fails for listed keys not written as lookups build them', () => {
    const checksummedKey = 'eip155:1:0xAbCdEf1111111111111111111111111111111111'

    expect(
      getProblems({
        amendCalldataDescriptors: {
          'pool/calldata-Pool.json': { ...fixValue, addresses: [KEY, checksummedKey, '1:0x11'] }
        }
      })
    ).toEqual([
      `The amend of pool/calldata-Pool.json (test): ${checksummedKey}, 1:0x11 not written as \`eip155:{chainId}:{lowercase address}\``
    ])
  })

  test('fails for a descriptor that no index uses, such as one only included', () => {
    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/common-Pool.json': fixValue } })
    ).toEqual([
      'The amend of pool/common-Pool.json (test): no calldata index entry uses it. Amend the descriptor that includes it instead'
    ])
  })

  test('fails for a descriptor that is not bundled', () => {
    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Gone.json': fixValue } })
    ).toEqual([
      'The amend of pool/calldata-Gone.json (test): the descriptor, or one it includes, is not bundled'
    ])
  })

  test('fails when the result is not a valid descriptor', () => {
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ descriptor, expectMatches }) => {
        expectMatches('formats', Object.keys(descriptor.display!.formats!), 2)
        ;(descriptor.display as any).formats = []
      }
    }

    expect(
      getProblems({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment } })
    ).toEqual(['The amend of pool/calldata-Pool.json (test): it is not a valid descriptor'])
  })

  test('fails when an EIP-712 amend changes the formats the index uses', () => {
    const amendment: Amendment = {
      reason: 'test',
      addresses: [KEY],
      amend: ({ descriptor, expectMatches }) => {
        const { formats } = descriptor.display!
        expectMatches('formats', Object.keys(formats!), 1)
        formats!['Permit(address spender,uint256 value)'] = formats!['Permit(address spender)']!
        delete formats!['Permit(address spender)']
      }
    }

    expect(
      getProblems({ amendEip712Descriptors: { 'permit/eip712-Permit.json': amendment } })
    ).toEqual([
      'The amend of permit/eip712-Permit.json (test): it changes the typed message formats, which the index uses'
    ])
  })
})

describe('applyAmendments: adds', () => {
  test('adds a calldata descriptor for a contract the registry does not have', () => {
    const { registry } = applyAmendments(
      upstreamRegistry(),
      withAmendments({ addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' } }),
      {}
    )

    expect(registry.calldataIndex[NEW_KEY]).toBe('pool/calldata-Pool.json')
  })

  test('fails once the registry has its own descriptor for the contract', () => {
    const registry = upstreamRegistry()
    registry.descriptors['pool/calldata-PoolV2.json'] = {
      $schema: SCHEMA,
      display: { formats: { 'mint()': {}, 'swap()': {} } }
    }
    registry.calldataIndex[NEW_KEY] = 'pool/calldata-PoolV2.json'

    expect(
      getProblems(
        { addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' } },
        {},
        registry
      )
    ).toEqual([
      `The add of pool/calldata-Pool.json for ${NEW_KEY}: the registry already has pool/calldata-PoolV2.json for ${NEW_KEY}. Remove ${NEW_KEY} from Ambire's changes, or amend pool/calldata-PoolV2.json instead (only in pool/calldata-Pool.json: burn(); only in pool/calldata-PoolV2.json: swap())`
    ])
  })

  test('fails for a descriptor that is not bundled and for keys not written as expected', () => {
    expect(
      getProblems({
        addCalldataDescriptors: {
          [NEW_KEY]: 'pool/calldata-Gone.json',
          'eip155:56:0xABC': 'pool/calldata-Pool.json'
        }
      })
    ).toEqual([
      `The add of pool/calldata-Gone.json for ${NEW_KEY}: the descriptor is not bundled`,
      'The add of pool/calldata-Pool.json for eip155:56:0xABC: eip155:56:0xABC is not written as `eip155:{chainId}:{address}`'
    ])
  })

  test('indexes EIP-712 descriptors per primary type, with the hashes of their formats', () => {
    const amendments = withAmendments({
      addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Permit.json' }
    })
    const { registry } = applyAmendments(upstreamRegistry(), amendments, {
      'cow/eip712-Settlement.json': {
        $schema: SCHEMA,
        context: { eip712: { deployments: [{ chainId: 1, address: KEY.split(':')[2] }] } },
        display: { formats: { [ORDER]: { intent: 'Order' }, [CANCEL]: { intent: 'Cancel' } } }
      }
    })

    // Merged by primary type with the registry's own entries for the contract
    expect(registry.eip712Index[KEY]).toEqual({
      Permit: [{ path: 'permit/eip712-Permit.json', encodeTypeHashes: ['0x01'] }],
      Order: [{ path: 'cow/eip712-Settlement.json', encodeTypeHashes: [id(ORDER)] }],
      Cancel: [{ path: 'cow/eip712-Settlement.json', encodeTypeHashes: [id(CANCEL)] }]
    })
    expect(registry.eip712Index[NEW_KEY]).toEqual({
      Permit: [
        { path: 'permit/eip712-Permit.json', encodeTypeHashes: [id('Permit(address spender)')] }
      ]
    })
  })

  test('fails once the registry has the primary type for the contract', () => {
    const registry = upstreamRegistry()
    registry.eip712Index[NEW_KEY] = { Permit: [{ path: 'permit/eip712-Permit.json' }] }

    expect(
      getProblems(
        { addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Permit.json' } },
        {},
        registry
      )
    ).toEqual([
      `The add of permit/eip712-Permit.json for ${NEW_KEY}: the registry already has permit/eip712-Permit.json for Permit messages of ${NEW_KEY}. Remove ${NEW_KEY} from Ambire's changes, or amend permit/eip712-Permit.json instead`
    ])
  })
})

describe("applyAmendments: Ambire's own descriptors", () => {
  const own = (extra: Record<string, unknown> = {}) => ({
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json',
    context: { contract: { deployments: [{ chainId: 56, address: KEY.split(':')[2] }] } },
    display: { formats: { 'swap()': { intent: 'Swap' } } },
    ...extra
  })

  test('indexes them by their deployments', () => {
    const { registry } = applyAmendments(upstreamRegistry(), NO_AMENDMENTS, {
      'dex/calldata-Dex.json': own()
    })

    expect(registry.calldataIndex[NEW_KEY]).toBe('dex/calldata-Dex.json')
    expect(registry.descriptors['dex/calldata-Dex.json']).toEqual(own())
  })

  test('fails once the registry has a descriptor for one of their deployments', () => {
    const deployedOnKey = own({
      context: { contract: { deployments: [{ chainId: 1, address: KEY.split(':')[2] }] } }
    })

    expect(getProblems({}, { 'dex/calldata-Dex.json': deployedOnKey })).toEqual([
      `Ambire's descriptor dex/calldata-Dex.json: the registry already has pool/calldata-Pool.json for ${KEY}. Remove ${KEY} from Ambire's changes, or amend pool/calldata-Pool.json instead (only in dex/calldata-Dex.json: swap(); only in pool/calldata-Pool.json: burn(), mint())`
    ])
  })

  test('fails for a name the registry already has, and for unsupported or unused ones', () => {
    expect(
      getProblems(
        {},
        {
          'pool/calldata-Pool.json': own(),
          'dex/calldata-V3.json': own({
            $schema: 'erc7730-v3.schema.json',
            context: { contract: { deployments: [{ chainId: 100, address: KEY.split(':')[2] }] } }
          }),
          'dex/calldata-Unused.json': own({ context: {} })
        }
      )
    ).toEqual([
      "Ambire's descriptor pool/calldata-Pool.json has the same path as a descriptor of the registry",
      "Ambire's descriptor dex/calldata-V3.json: its version of ERC-7730 is not supported: erc7730-v3.schema.json",
      "Ambire's descriptor dex/calldata-Unused.json has no `context.contract.deployments` or `context.eip712.deployments`"
    ])
  })

  test('fails when they include a descriptor that is not bundled', () => {
    expect(
      getProblems({}, { 'dex/calldata-Dex.json': own({ includes: 'dex/common.json' }) })
    ).toEqual([
      "Ambire's descriptor dex/calldata-Dex.json includes dex/common.json, which are not bundled"
    ])
  })
})

describe("applyAmendments: keys in more than one of Ambire's changes", () => {
  const ownOn = (key: string, kind: 'contract' | 'eip712' = 'contract') => ({
    $schema: SCHEMA,
    context: {
      [kind]: { deployments: [{ chainId: Number(key.split(':')[1]), address: key.split(':')[2] }] }
    },
    display: { formats: { 'Swap(uint256 amount)': { intent: 'Swap' } } }
  })

  test('fails for a key that is both amended and added', () => {
    expect(
      getProblems({
        amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue },
        addCalldataDescriptors: { [KEY]: 'pool/calldata-Pool.json' }
      })
    ).toEqual([
      `The calldata key ${KEY} is in more than one of Ambire's changes: the amend of pool/calldata-Pool.json, the add of pool/calldata-Pool.json. Keep it in one`
    ])
  })

  test('fails for a key in two amends, or in an add and an own descriptor', () => {
    expect(
      getProblems(
        {
          amendCalldataDescriptors: {
            'pool/calldata-Pool.json': fixValue,
            'pool/calldata-Other.json': fixValue
          },
          addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' }
        },
        { 'dex/calldata-Dex.json': ownOn(NEW_KEY) }
      )
    ).toEqual([
      `The calldata key ${KEY} is in more than one of Ambire's changes: the amend of pool/calldata-Pool.json, the amend of pool/calldata-Other.json. Keep it in one`,
      `The calldata key ${NEW_KEY} is in more than one of Ambire's changes: the add of pool/calldata-Pool.json, the deployments of Ambire's descriptor dex/calldata-Dex.json. Keep it in one`
    ])
  })

  test('fails for EIP-712 keys the same way', () => {
    expect(
      getProblems(
        { addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Permit.json' } },
        { 'dex/eip712-Dex.json': ownOn(NEW_KEY, 'eip712') }
      )
    ).toEqual([
      `The EIP-712 key ${NEW_KEY} is in more than one of Ambire's changes: the add of permit/eip712-Permit.json, the deployments of Ambire's descriptor dex/eip712-Dex.json. Keep it in one`
    ])
  })

  test('allows the same key for calldata and for EIP-712, and adds of an amended descriptor', () => {
    expect(
      getProblems(
        {
          amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue },
          addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' }
        },
        { 'dex/eip712-Dex.json': ownOn(NEW_KEY, 'eip712') }
      )
    ).toEqual([])
  })
})
