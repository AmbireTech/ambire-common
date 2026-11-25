import { id } from 'ethers'
import { isDeepStrictEqual } from 'util'

import { getIncludes, mergeDescriptors } from '../../src/libs/humanizer/erc7730/descriptor'
import { ERC7730_MAX_RESOLUTION_DEPTH } from '../../src/libs/humanizer/erc7730/registry'
import {
  Erc7730Descriptor,
  Erc7730Eip712IndexEntry,
  Erc7730Field
} from '../../src/libs/humanizer/erc7730/types'
import { getRegistryKey, isPlainObject } from '../../src/libs/humanizer/erc7730/utils'
import {
  BuiltRegistry,
  getDescriptorProblem,
  isRegistryKey,
  RegistryBuildError,
  sortByKey
} from './build'

// Ambire's changes to the upstream registry, applied when the registry is built - never at
// runtime. Each change says what it expects to find, so that the build fails as soon as an
// upstream change makes it wrong or useless, instead of shipping it silently:
//
// - an amend changes an upstream descriptor (or one of Ambire's own). It checks what it changes
//   with `expectMatches` and `expectEqual`, and lists contracts that must still use the descriptor
// - an add points an index key at a descriptor (an upstream one, e.g. on a network the registry
//   doesn't list, or one of Ambire's own), and fails once the registry has its own entry there
// - Ambire's own descriptors are in the upstream format; their `deployments` are added to the
//   indexes, and fail the same way as an add

/** A field of a descriptor's formats, with the signature or the type of its format */
export type FieldMatch = { field: Erc7730Field; format: string }

export type AmendContext = {
  /** The descriptor, with everything it includes merged into it. Change it in place */
  descriptor: Erc7730Descriptor
  /** The fields (nested ones included) of all formats that match `predicate` */
  fields: (predicate: (field: Erc7730Field, format: string) => boolean) => FieldMatch[]
  /** Fails the build unless there are exactly `count` items (or at least `min`). Returns them */
  expectMatches: <T>(label: string, items: T[], count: number | { min: number }) => T[]
  /** Fails the build unless `actual` deeply equals `expected` */
  expectEqual: (label: string, actual: unknown, expected: unknown) => void
}

export type Amendment = {
  /** Why the descriptor is changed, and when the change can be dropped */
  reason: string
  /** Registry keys (`eip155:{chainId}:{address}`) that must still use the descriptor */
  addresses: string[]
  amend: (context: AmendContext) => void
}

export type Amendments = {
  /** Calldata descriptors to change, by their name */
  amendCalldataDescriptors: Record<string, Amendment>
  /** Registry key -> the name of the calldata descriptor to use for it */
  addCalldataDescriptors: Record<string, string>
  /** EIP-712 descriptors to change, by their name. Their formats must stay the same */
  amendEip712Descriptors: Record<string, Amendment>
  /** Registry key -> the name of the EIP-712 descriptor to use for its typed messages */
  addEip712Descriptors: Record<string, string>
}

export const NO_AMENDMENTS: Amendments = {
  amendCalldataDescriptors: {},
  addCalldataDescriptors: {},
  amendEip712Descriptors: {},
  addEip712Descriptors: {}
}

class ExpectationError extends Error {}

/** The type a typed message format is for: the name before the first `(` of its signature */
const getPrimaryType = (format: string) => format.slice(0, format.indexOf('('))

const getFormats = (descriptor: Erc7730Descriptor) => descriptor.display?.formats ?? {}

const collectFields = (
  fields: Erc7730Field[] | undefined,
  format: string,
  matches: FieldMatch[]
) => {
  fields?.forEach((field) => {
    matches.push({ field, format })
    collectFields(field.fields, format, matches)
  })
}

/** Whether a value is a list of `{ chainId, address }` */
const getDeployments = (value: unknown): { chainId: number; address: string }[] | null => {
  if (!Array.isArray(value)) return null
  const isValid = value.every(
    (deployment) =>
      isPlainObject(deployment) &&
      (typeof deployment.chainId === 'number' || typeof deployment.chainId === 'string') &&
      typeof deployment.address === 'string'
  )

  return isValid ? value : null
}

/**
 * The registry with Ambire's own descriptors, amends and adds applied. Throws a
 * `RegistryBuildError` with every problem found. Also returns notes for the summary: what was
 * changed, and upstream entries that use an amended descriptor without being listed
 */
export const applyAmendments = (
  built: BuiltRegistry,
  amendments: Amendments,
  ownDescriptors: Record<string, unknown>
): { registry: BuiltRegistry; notes: string[] } => {
  const problems: string[] = []
  const notes: string[] = []
  const descriptors: Record<string, Record<string, unknown>> = { ...built.descriptors }
  const calldataIndex = { ...built.calldataIndex }
  const eip712Index: Record<string, Record<string, Erc7730Eip712IndexEntry[]>> = Object.fromEntries(
    Object.entries(built.eip712Index).map(([key, entries]) => [key, { ...entries }])
  )
  const hasDescriptor = (name: string) => Object.prototype.hasOwnProperty.call(descriptors, name)

  /** A descriptor merged with everything it includes, or null if anything is missing */
  const flatten = (name: string, depth = 0): Erc7730Descriptor | null => {
    if (!hasDescriptor(name)) return null
    const descriptor = descriptors[name] as Erc7730Descriptor
    const includes = getIncludes(descriptor)
    if (!includes.length) return structuredClone(descriptor)
    if (depth >= ERC7730_MAX_RESOLUTION_DEPTH) return null

    const included = includes.map((include) => flatten(include, depth + 1))
    if (included.some((one) => !one)) return null

    // The same merge as the wallet's, so the result reads the same
    const merged = mergeDescriptors(
      included.reduce<Erc7730Descriptor>((acc, one) => mergeDescriptors(acc, one!), {}),
      descriptor
    )
    delete merged.includes

    return structuredClone(merged)
  }

  /** What only one of two descriptors describes, to tell which one to keep */
  const compareFormats = (ourName: string, theirName: string) => {
    const ours = Object.keys(getFormats(flatten(ourName) ?? {}))
    const theirs = Object.keys(getFormats(flatten(theirName) ?? {}))
    const onlyOurs = ours.filter((format) => !theirs.includes(format))
    const onlyTheirs = theirs.filter((format) => !ours.includes(format))

    return `only in ${ourName}: ${onlyOurs.join(', ') || 'nothing'}; only in ${theirName}: ${
      onlyTheirs.join(', ') || 'nothing'
    }`
  }

  const addCalldataKey = (key: string, name: string, reference: string) => {
    if (!isRegistryKey(key)) {
      problems.push(`${reference}: ${key} is not written as \`eip155:{chainId}:{address}\``)
      return
    }
    const existing = calldataIndex[key]
    if (existing !== undefined) {
      problems.push(
        `${reference}: the registry already has ${existing} for ${key}. Remove ${key} from Ambire's changes, or amend ${existing} instead (${compareFormats(
          name,
          existing
        )})`
      )
      return
    }
    calldataIndex[key] = name
  }

  const addEip712Key = (key: string, name: string, reference: string) => {
    if (!isRegistryKey(key)) {
      problems.push(`${reference}: ${key} is not written as \`eip155:{chainId}:{address}\``)
      return
    }
    const descriptor = flatten(name)
    const formats = Object.keys(getFormats(descriptor ?? {}))
    if (!formats.length) {
      problems.push(`${reference}: ${name} has no typed message formats`)
      return
    }

    const hashesByPrimaryType = formats.reduce<Record<string, string[]>>((acc, format) => {
      const primaryType = getPrimaryType(format)
      acc[primaryType] = [...(acc[primaryType] ?? []), id(format)]
      return acc
    }, {})
    const entries = { ...eip712Index[key] }
    Object.entries(hashesByPrimaryType).forEach(([primaryType, encodeTypeHashes]) => {
      const existing = entries[primaryType]
      if (existing) {
        const existingNames = existing.map(({ path }) => path).join(', ')
        problems.push(
          `${reference}: the registry already has ${existingNames} for ${primaryType} messages of ${key}. Remove ${key} from Ambire's changes, or amend ${existingNames} instead`
        )
        return
      }
      entries[primaryType] = [{ path: name, encodeTypeHashes }]
    })
    eip712Index[key] = entries
  }

  // Ambire's own descriptors, indexed by their deployments
  Object.entries(ownDescriptors).forEach(([name, descriptor]) => {
    const reference = `Ambire's descriptor ${name}`
    if (hasDescriptor(name)) {
      problems.push(`${reference} has the same path as a descriptor of the registry`)
      return
    }
    const problem = getDescriptorProblem(descriptor)
    if (problem || !isPlainObject(descriptor)) {
      problems.push(`${reference}: ${problem}`)
      return
    }
    descriptors[name] = descriptor
  })
  Object.entries(ownDescriptors).forEach(([name, descriptor]) => {
    const reference = `Ambire's descriptor ${name}`
    if (descriptors[name] !== descriptor || !isPlainObject(descriptor)) return

    const missingIncludes = getIncludes(descriptor).filter((include) => !hasDescriptor(include))
    if (missingIncludes.length) {
      problems.push(`${reference} includes ${missingIncludes.join(', ')}, which are not bundled`)
      return
    }

    const context = isPlainObject(descriptor.context) ? descriptor.context : {}
    const contract = isPlainObject(context.contract) ? context.contract : null
    const eip712 = isPlainObject(context.eip712) ? context.eip712 : null
    const calldataDeployments = contract && getDeployments(contract.deployments)
    const eip712Deployments = eip712 && getDeployments(eip712.deployments)
    if (!calldataDeployments?.length && !eip712Deployments?.length) {
      problems.push(
        `${reference} has no \`context.contract.deployments\` or \`context.eip712.deployments\``
      )
      return
    }
    calldataDeployments?.forEach(({ chainId, address }) =>
      addCalldataKey(getRegistryKey(chainId, address), name, reference)
    )
    eip712Deployments?.forEach(({ chainId, address }) =>
      addEip712Key(getRegistryKey(chainId, address), name, reference)
    )
  })

  const usesInIndex = (name: string, kind: 'calldata' | 'eip712'): string[] =>
    kind === 'calldata'
      ? Object.keys(calldataIndex).filter((key) => calldataIndex[key] === name)
      : Object.keys(eip712Index).filter((key) =>
          Object.values(eip712Index[key]!).some((entries) =>
            entries.some(({ path }) => path === name)
          )
        )

  const amend = (name: string, amendment: Amendment, kind: 'calldata' | 'eip712') => {
    const reference = `The amend of ${name} (${amendment.reason})`
    const original = flatten(name)
    if (!original) {
      problems.push(`${reference}: the descriptor, or one it includes, is not bundled`)
      return
    }

    const keys = usesInIndex(name, kind)
    if (!keys.length) {
      problems.push(
        `${reference}: no ${kind} index entry uses it. Amend the descriptor that includes it instead`
      )
      return
    }
    const gone = amendment.addresses.filter((key) => !keys.includes(key))
    if (gone.length) {
      problems.push(`${reference}: ${gone.join(', ')} no longer use it`)
    }
    const unlisted = keys.filter((key) => !amendment.addresses.includes(key))
    if (unlisted.length) notes.push(`${name} is also amended for ${unlisted.join(', ')}`)

    const run = () => {
      const descriptor = structuredClone(original)
      let expectations = 0
      const context: AmendContext = {
        descriptor,
        fields: (predicate) => {
          const matches: FieldMatch[] = []
          Object.entries(getFormats(descriptor)).forEach(([format, { fields }]) =>
            collectFields(fields, format, matches)
          )
          return matches.filter(({ field, format }) => predicate(field, format))
        },
        expectMatches: (label, items, count) => {
          expectations += 1
          const isExpected =
            typeof count === 'number' ? items.length === count : items.length >= count.min
          if (!isExpected) {
            const expected = typeof count === 'number' ? count : `at least ${count.min}`
            throw new ExpectationError(`expected ${expected} ${label}, found ${items.length}`)
          }
          return items
        },
        expectEqual: (label, actual, expected) => {
          expectations += 1
          if (!isDeepStrictEqual(actual, expected)) {
            throw new ExpectationError(
              `expected ${label} to be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`
            )
          }
        }
      }
      amendment.amend(context)

      return { descriptor, expectations }
    }

    let first: ReturnType<typeof run>
    let second: ReturnType<typeof run>
    try {
      first = run()
      second = run()
    } catch (error) {
      if (!(error instanceof ExpectationError)) throw error
      problems.push(`${reference}: ${error.message}`)
      return
    }

    if (!first.expectations) {
      problems.push(`${reference}: it checks nothing. Use expectMatches or expectEqual`)
      return
    }
    if (JSON.stringify(first.descriptor) !== JSON.stringify(second.descriptor)) {
      problems.push(`${reference}: it gives a different result each time it runs`)
      return
    }
    if (isDeepStrictEqual(first.descriptor, original)) {
      problems.push(`${reference}: it changes nothing`)
      return
    }
    if (
      kind === 'eip712' &&
      !isDeepStrictEqual(
        Object.keys(getFormats(first.descriptor)).sort(),
        Object.keys(getFormats(original)).sort()
      )
    ) {
      problems.push(`${reference}: it changes the typed message formats, which the index uses`)
      return
    }
    const problem = getDescriptorProblem(first.descriptor)
    if (problem) {
      problems.push(`${reference}: ${problem}`)
      return
    }

    descriptors[name] = first.descriptor as Record<string, unknown>
    notes.push(`${name} is amended: ${amendment.reason}`)
  }

  Object.entries(amendments.amendCalldataDescriptors).forEach(([name, amendment]) =>
    amend(name, amendment, 'calldata')
  )
  Object.entries(amendments.amendEip712Descriptors).forEach(([name, amendment]) =>
    amend(name, amendment, 'eip712')
  )

  Object.entries(amendments.addCalldataDescriptors).forEach(([key, name]) => {
    const reference = `The add of ${name} for ${key}`
    if (!hasDescriptor(name)) problems.push(`${reference}: the descriptor is not bundled`)
    else addCalldataKey(key, name, reference)
  })
  Object.entries(amendments.addEip712Descriptors).forEach(([key, name]) => {
    const reference = `The add of ${name} for ${key}`
    if (!hasDescriptor(name)) problems.push(`${reference}: the descriptor is not bundled`)
    else addEip712Key(key, name, reference)
  })

  if (problems.length) throw new RegistryBuildError(problems)

  return {
    registry: {
      calldataIndex: sortByKey(calldataIndex),
      eip712Index: sortByKey(eip712Index),
      descriptors: sortByKey(descriptors)
    },
    notes
  }
}
