import { describe, expect, test } from '@jest/globals'

import { Amendment, Amendments, applyAmendments, getNamingProblems, NO_AMENDMENTS } from './amend'
import { BuiltRegistry, BundledRegistry, RegistryBuildError } from './build'

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
    [KEY]: { Permit: ['permit/eip712-Permit.json'] }
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
    const amended = registry.descriptors['ambire-change/pool/calldata-Pool.json'] as any

    expect(amended.includes).toBeUndefined()
    expect(amended.display.formats['mint()'].fields[0].visible).toEqual({ ifNotIn: [0] })
    expect(amended.display.formats['burn()'].fields[0].fields[0].visible).toEqual({ ifNotIn: [0] })
    // Every key of the descriptor uses the copy, so neither the registry's descriptor nor the one
    // only it includes is bundled
    expect(registry.calldataIndex[KEY]).toBe('ambire-change/pool/calldata-Pool.json')
    expect(registry.calldataIndex[OTHER_KEY]).toBe('ambire-change/pool/calldata-Pool.json')
    expect(registry.descriptors['pool/calldata-Pool.json']).toBeUndefined()
    expect(registry.descriptors['pool/common-Pool.json']).toBeUndefined()
    expect(notes).toContain(`pool/calldata-Pool.json is also amended for ${OTHER_KEY}`)
  })

  test('gives an add of an amended descriptor its ambire-change/ copy', () => {
    const { registry } = applyAmendments(
      upstreamRegistry(),
      withAmendments({
        amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue },
        addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' }
      }),
      {}
    )

    expect(registry.calldataIndex[NEW_KEY]).toBe('ambire-change/pool/calldata-Pool.json')
  })

  test('keeps the registry descriptor while another descriptor includes it', () => {
    const registry = upstreamRegistry()
    registry.descriptors['pool/calldata-PoolV2.json'] = {
      $schema: SCHEMA,
      includes: 'pool/calldata-Pool.json'
    }
    registry.calldataIndex[NEW_KEY] = 'pool/calldata-PoolV2.json'

    const { registry: amended } = applyAmendments(
      registry,
      withAmendments({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue } }),
      {}
    )

    expect(amended.descriptors['pool/calldata-Pool.json']).toEqual(
      upstreamRegistry().descriptors['pool/calldata-Pool.json']
    )
    expect(amended.calldataIndex[NEW_KEY]).toBe('pool/calldata-PoolV2.json')
  })

  test('amends a descriptor whose includes are deeper than the wallet once read', () => {
    const registry = upstreamRegistry()
    for (let level = 0; level < 7; level += 1) {
      registry.descriptors[`pool/level-${level}.json`] =
        level < 6
          ? { $schema: SCHEMA, includes: `pool/level-${level + 1}.json` }
          : { $schema: SCHEMA }
    }
    registry.descriptors['pool/common-Pool.json']!.includes = 'pool/level-0.json'

    const { registry: amended } = applyAmendments(
      registry,
      withAmendments({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue } }),
      {}
    )

    expect(amended.descriptors['ambire-change/pool/calldata-Pool.json']).toBeDefined()
  })

  test('amends a descriptor whose includes loop, merging each of them once', () => {
    const registry = upstreamRegistry()
    registry.descriptors['pool/common-Pool.json']!.includes = 'pool/calldata-Pool.json'

    const { registry: amended } = applyAmendments(
      registry,
      withAmendments({ amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue } }),
      {}
    )

    expect(
      Object.keys(
        (amended.descriptors['ambire-change/pool/calldata-Pool.json'] as any).display.formats
      )
    ).toEqual(['burn()', 'mint()'])
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

  test('names the amend for any other error, and still lists the other problems', () => {
    const registry = upstreamRegistry()
    delete (registry.descriptors['pool/calldata-Pool.json'] as any).display
    delete (registry.descriptors['pool/common-Pool.json'] as any).display
    const amendment: Amendment = {
      ...fixValue,
      amend: ({ descriptor }) => {
        descriptor.display!.formats!['mint()']!.intent = 'Add'
      }
    }

    const problems = getProblems(
      {
        amendCalldataDescriptors: { 'pool/calldata-Pool.json': amendment },
        addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Gone.json' }
      },
      {},
      registry
    )

    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^The amend of pool\/calldata-Pool\.json \(test\): TypeError: /)
    expect(problems[1]).toBe(
      `The add of pool/calldata-Gone.json for ${NEW_KEY}: the descriptor is not bundled`
    )
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
      'The amend of permit/eip712-Permit.json (test): it changes the typed message formats, which upstream indexed the contracts by'
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

  test.each(['ambire-change/pool/calldata-Pool.json', 'ambire-new/dex/calldata-Dex.json'])(
    'fails for an add of %s, which is not a registry path',
    (name) => {
      expect(
        getProblems(
          {
            amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue },
            addCalldataDescriptors: { [NEW_KEY]: name }
          },
          {
            'dex/calldata-Dex.json': {
              $schema: SCHEMA,
              context: { contract: { deployments: [{ chainId: 100, address: KEY.split(':')[2] }] } }
            }
          }
        )
      ).toEqual([
        `The add of ${name} for ${NEW_KEY}: add only descriptors of the registry, by their registry path. Add the keys of an amended descriptor with its registry path, and those of Ambire's own descriptors to their \`deployments\``
      ])
    }
  )

  test('says the add is no longer needed once the registry uses the same descriptor', () => {
    const registry = upstreamRegistry()
    registry.calldataIndex[NEW_KEY] = 'pool/calldata-Pool.json'
    registry.eip712Index[NEW_KEY] = { Permit: ['permit/eip712-Permit.json'] }

    expect(
      getProblems(
        {
          amendCalldataDescriptors: { 'pool/calldata-Pool.json': fixValue },
          addCalldataDescriptors: { [NEW_KEY]: 'pool/calldata-Pool.json' },
          addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Permit.json' }
        },
        {},
        registry
      )
    ).toEqual([
      `The add of pool/calldata-Pool.json for ${NEW_KEY}: the registry now uses the same descriptor (pool/calldata-Pool.json) for ${NEW_KEY}, so Ambire's change is no longer needed. Remove it`,
      `The add of permit/eip712-Permit.json for ${NEW_KEY}: the registry now uses the same descriptor (permit/eip712-Permit.json) for Permit messages of ${NEW_KEY}, so Ambire's change is no longer needed. Remove it`
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

  test('indexes EIP-712 descriptors by contract, with the registry descriptors of the contract', () => {
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

    expect(registry.eip712Index[KEY]).toEqual([
      'ambire-new/cow/eip712-Settlement.json',
      'permit/eip712-Permit.json'
    ])
    expect(registry.eip712Index[NEW_KEY]).toEqual(['permit/eip712-Permit.json'])
  })

  test.each(['Permit', 'Permit(address spender'])(
    'fails for the typed message format %s, which is not a signature',
    (format) => {
      const registry = upstreamRegistry()
      registry.descriptors['permit/eip712-Bad.json'] = {
        $schema: SCHEMA,
        display: { formats: { [format]: { intent: 'Permit' }, [ORDER]: { intent: 'Order' } } }
      }

      expect(
        getProblems({ addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Bad.json' } }, {}, registry)
      ).toEqual([
        `The add of permit/eip712-Bad.json for ${NEW_KEY}: permit/eip712-Bad.json has typed message formats not written as \`Type(...)\`: ${format}`
      ])
    }
  )

  test('fails once the registry has the primary type for the contract', () => {
    const registry = upstreamRegistry()
    registry.eip712Index[NEW_KEY] = { Permit: ['permit/eip712-Other.json'] }

    expect(
      getProblems(
        { addEip712Descriptors: { [NEW_KEY]: 'permit/eip712-Permit.json' } },
        {},
        registry
      )
    ).toEqual([
      `The add of permit/eip712-Permit.json for ${NEW_KEY}: the registry already has permit/eip712-Other.json for Permit messages of ${NEW_KEY}. Remove ${NEW_KEY} from Ambire's changes, or amend permit/eip712-Other.json instead`
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

    expect(registry.calldataIndex[NEW_KEY]).toBe('ambire-new/dex/calldata-Dex.json')
    expect(registry.descriptors['ambire-new/dex/calldata-Dex.json']).toEqual(own())
    expect(registry.descriptors['dex/calldata-Dex.json']).toBeUndefined()
  })

  test('takes a chain id written as a decimal string', () => {
    const { registry } = applyAmendments(upstreamRegistry(), NO_AMENDMENTS, {
      'dex/calldata-Dex.json': own({
        context: { contract: { deployments: [{ chainId: '56', address: KEY.split(':')[2] }] } }
      })
    })

    expect(registry.calldataIndex[NEW_KEY]).toBe('ambire-new/dex/calldata-Dex.json')
  })

  test.each(['base', '0x38', '056', 0, 1.5])(
    'names the descriptor for the invalid chain id %j',
    (chainId) => {
      const descriptor = own({
        context: { contract: { deployments: [{ chainId, address: KEY.split(':')[2] }] } }
      })

      expect(getProblems({}, { 'dex/calldata-Dex.json': descriptor })).toEqual([
        "Ambire's descriptor dex/calldata-Dex.json: `context.contract.deployments` is not a list of `{ chainId, address }` with decimal chain ids"
      ])
    }
  )

  test('does not drop an invalid deployments list when the other one is valid', () => {
    const descriptor = own({
      context: {
        contract: { deployments: [{ chainId: 56, address: KEY.split(':')[2] }] },
        eip712: { deployments: [{ chainId: 'base', address: KEY.split(':')[2] }] }
      }
    })

    expect(getProblems({}, { 'dex/calldata-Dex.json': descriptor })).toEqual([
      "Ambire's descriptor dex/calldata-Dex.json: `context.eip712.deployments` is not a list of `{ chainId, address }` with decimal chain ids"
    ])
  })

  test('fails once the registry has a descriptor for one of their deployments', () => {
    const deployedOnKey = own({
      context: { contract: { deployments: [{ chainId: 1, address: KEY.split(':')[2] }] } }
    })

    expect(getProblems({}, { 'dex/calldata-Dex.json': deployedOnKey })).toEqual([
      `Ambire's descriptor dex/calldata-Dex.json: the registry already has pool/calldata-Pool.json for ${KEY}. Remove ${KEY} from Ambire's changes, or amend pool/calldata-Pool.json instead (only in ambire-new/dex/calldata-Dex.json: swap(); only in pool/calldata-Pool.json: burn(), mint())`
    ])
  })

  test('keeps one at the path of a registry descriptor apart from it', () => {
    const { registry } = applyAmendments(upstreamRegistry(), NO_AMENDMENTS, {
      'pool/calldata-Pool.json': own()
    })

    expect(registry.calldataIndex[NEW_KEY]).toBe('ambire-new/pool/calldata-Pool.json')
    expect(registry.calldataIndex[KEY]).toBe('pool/calldata-Pool.json')
    expect(registry.descriptors['pool/calldata-Pool.json']).toEqual(
      upstreamRegistry().descriptors['pool/calldata-Pool.json']
    )
  })

  test('fails for unsupported or unused ones', () => {
    expect(
      getProblems(
        {},
        {
          'dex/calldata-V3.json': own({
            $schema: 'erc7730-v3.schema.json',
            context: { contract: { deployments: [{ chainId: 100, address: KEY.split(':')[2] }] } }
          }),
          'dex/calldata-Unused.json': own({ context: {} })
        }
      )
    ).toEqual([
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

  test('can include a descriptor of the registry', () => {
    const { registry } = applyAmendments(upstreamRegistry(), NO_AMENDMENTS, {
      'dex/calldata-Dex.json': own({ includes: 'pool/common-Pool.json' })
    })

    expect(registry.descriptors['ambire-new/dex/calldata-Dex.json']?.includes).toBe(
      'pool/common-Pool.json'
    )
  })

  test("fails when they include another of Ambire's own descriptors", () => {
    const common = { $schema: SCHEMA, metadata: { owner: 'Dex' } }

    expect(
      getProblems(
        {},
        {
          'dex/calldata-Dex.json': own({ includes: ['dex/common.json'] }),
          'dex/calldata-Other.json': own({
            context: { contract: { deployments: [{ chainId: 100, address: KEY.split(':')[2] }] } },
            includes: 'ambire-new/dex/common.json'
          }),
          'dex/common.json': common
        }
      )
    ).toEqual([
      "Ambire's descriptor dex/calldata-Dex.json includes dex/common.json, which are Ambire's. Include only descriptors of the registry",
      "Ambire's descriptor dex/calldata-Other.json includes ambire-new/dex/common.json, which are Ambire's. Include only descriptors of the registry",
      "Ambire's descriptor dex/common.json has no `context.contract.deployments` or `context.eip712.deployments`"
    ])
  })

  test('fails for an amend of one', () => {
    expect(
      getProblems(
        { amendCalldataDescriptors: { 'ambire-new/dex/calldata-Dex.json': fixValue } },
        { 'dex/calldata-Dex.json': own() }
      )
    ).toEqual([
      "The amend of ambire-new/dex/calldata-Dex.json (test): amend only descriptors of the registry, by their registry path. Edit Ambire's own descriptors in their files"
    ])
  })

  test("fails when the registry has a path that starts like Ambire's", () => {
    const registry = upstreamRegistry()
    registry.descriptors['ambire-new/x.json'] = { $schema: SCHEMA }

    expect(getProblems({}, {}, registry)).toEqual([
      "The registry has descriptors at paths that start like Ambire's (`ambire-change/`, `ambire-new/`): ambire-new/x.json"
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

describe('getNamingProblems', () => {
  const OWN = { $schema: SCHEMA, metadata: { owner: 'Dex' } }
  const sources = () => ({
    upstream: upstreamRegistry().descriptors,
    own: { 'dex/calldata-Dex.json': OWN },
    amended: new Set(['pool/calldata-Pool.json'])
  })
  const bundled = (): BundledRegistry => {
    const { descriptors } = upstreamRegistry()
    return {
      calldataIndex: { [KEY]: 'ambire-change/pool/calldata-Pool.json' },
      eip712Index: { [KEY]: ['permit/eip712-Permit.json'] },
      descriptors: {
        'ambire-change/pool/calldata-Pool.json': { $schema: SCHEMA },
        'ambire-new/dex/calldata-Dex.json': OWN,
        'pool/common-Pool.json': descriptors['pool/common-Pool.json']!,
        'permit/eip712-Permit.json': descriptors['permit/eip712-Permit.json']!
      }
    }
  }

  test('passes for a registry that keeps the rules', () => {
    expect(getNamingProblems(bundled(), sources())).toEqual([])
  })

  test("fails for a registry descriptor that changed, or that isn't the registry's", () => {
    const registry = bundled()
    ;(registry.descriptors['pool/common-Pool.json'] as any).metadata = { owner: 'Changed' }
    registry.descriptors['pool/calldata-Unknown.json'] = { $schema: SCHEMA }

    expect(getNamingProblems(registry, sources())).toEqual([
      "pool/common-Pool.json is not the registry's descriptor as it is",
      "pool/calldata-Unknown.json is not the registry's descriptor as it is"
    ])
  })

  test("fails for an own descriptor that changed, or that isn't Ambire's", () => {
    const registry = bundled()
    registry.descriptors['ambire-new/dex/calldata-Dex.json'] = { ...OWN, metadata: {} }
    registry.descriptors['ambire-new/dex/calldata-Other.json'] = OWN

    expect(getNamingProblems(registry, sources())).toEqual([
      "ambire-new/dex/calldata-Dex.json is not Ambire's own descriptor dex/calldata-Dex.json as it is",
      "ambire-new/dex/calldata-Other.json is not Ambire's own descriptor dex/calldata-Other.json as it is"
    ])
  })

  test('fails for a copy with no amend, and for an amend with no copy', () => {
    const registry = bundled()
    registry.descriptors['ambire-change/permit/eip712-Permit.json'] = { $schema: SCHEMA }

    expect(
      getNamingProblems(registry, {
        ...sources(),
        amended: new Set(['pool/calldata-Pool.json', 'pool/calldata-Other.json'])
      })
    ).toEqual([
      'ambire-change/permit/eip712-Permit.json is bundled, but no amend changes permit/eip712-Permit.json',
      'The amend of pool/calldata-Other.json has no `ambire-change/` copy'
    ])
  })

  test('fails for an index entry that uses an amended or a missing descriptor', () => {
    const registry = bundled()
    registry.calldataIndex[OTHER_KEY] = 'pool/calldata-Pool.json'
    registry.eip712Index[NEW_KEY] = ['permit/eip712-Gone.json']

    expect(getNamingProblems(registry, sources())).toEqual([
      `${OTHER_KEY} uses pool/calldata-Pool.json, which is not bundled`,
      `${NEW_KEY} uses permit/eip712-Gone.json, which is not bundled`
    ])

    registry.descriptors['pool/calldata-Pool.json'] =
      upstreamRegistry().descriptors['pool/calldata-Pool.json']!
    expect(getNamingProblems(registry, sources())).toEqual([
      `${OTHER_KEY} uses pool/calldata-Pool.json, which is amended, instead of its copy`,
      `${NEW_KEY} uses permit/eip712-Gone.json, which is not bundled`
    ])
  })
})
