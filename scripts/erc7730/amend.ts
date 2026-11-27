import { id } from 'ethers'
import { isDeepStrictEqual } from 'util'

import {
  ERC7730_AMBIRE_CHANGE_PATH_PREFIX,
  ERC7730_AMBIRE_NEW_PATH_PREFIX,
  isAmbireErc7730Path
} from '../../src/libs/humanizer/erc7730/consts'
import {
  getIncludes,
  mergeDescriptors,
  validateDescriptor
} from '../../src/libs/humanizer/erc7730/descriptor'
import { Erc7730Descriptor, Erc7730Field } from '../../src/libs/humanizer/erc7730/types'
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
// - an amend changes an upstream descriptor. It checks what it changes with `expectMatches` and
//   `expectEqual`, and lists contracts that must still use the descriptor. The result is bundled as
//   `ambire-change/<descriptor path>`, and every key that used the descriptor uses it
// - an add points an index key at an upstream descriptor, e.g. on a network the registry doesn't
//   list, and fails once the registry has its own entry there
// - Ambire's own descriptors are in the upstream format, bundled as `ambire-new/<path>`; their
//   `deployments` are added to the indexes, and fail the same way as an add. Change them by editing
//   their files, not with an amend

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
  /**
   * Registry keys (`eip155:{chainId}:{address}`) the upstream index points at the descriptor, and
   * must keep pointing at it. Only a check: every key that uses the descriptor gets the amended
   * copy. Use an add, with the upstream path, for a key the upstream index doesn't have
   */
  addresses: string[]
  amend: (context: AmendContext) => void
}

export type Amendments = {
  /** Calldata descriptors to change, by their name */
  amendCalldataDescriptors: Record<string, Amendment>
  /**
   * Registry key -> the upstream path of the calldata descriptor to use for it. If that descriptor
   * is amended, the key gets its `ambire-change/` copy
   */
  addCalldataDescriptors: Record<string, string>
  /** EIP-712 descriptors to change, by their name. Their formats must stay the same */
  amendEip712Descriptors: Record<string, Amendment>
  /**
   * Registry key -> the upstream path of the EIP-712 descriptor to use for its typed messages. If
   * that descriptor is amended, the key gets its `ambire-change/` copy
   */
  addEip712Descriptors: Record<string, string>
}

export const NO_AMENDMENTS: Amendments = {
  amendCalldataDescriptors: {},
  addCalldataDescriptors: {},
  amendEip712Descriptors: {},
  addEip712Descriptors: {}
}

class ExpectationError extends Error {}

/** Whether an object has a key of its own, so that names such as `toString` never match */
const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key)

/**
 * The type a typed message format is for: the name before the first `(` of its signature, or null
 * if the format is not written as a signature (`Type(...)`)
 */
const getPrimaryType = (format: string): string | null => {
  const bracketIndex = format.indexOf('(')

  return bracketIndex > 0 && format.endsWith(')') ? format.slice(0, bracketIndex) : null
}

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

/** Whether a value is a chain id: a positive whole number, or one written as a decimal string */
const isChainId = (value: unknown): value is number | string => {
  if (typeof value !== 'number' && typeof value !== 'string') return false
  const chainId = Number(value)

  return Number.isSafeInteger(chainId) && chainId > 0 && String(chainId) === String(value)
}

/** The value if it is a list of `{ chainId, address }`, otherwise null */
const getDeployments = (value: unknown): { chainId: number; address: string }[] | null => {
  if (!Array.isArray(value)) return null
  const isValid = value.every(
    (deployment) =>
      isPlainObject(deployment) &&
      isChainId(deployment.chainId) &&
      typeof deployment.address === 'string'
  )

  return isValid ? value : null
}

/**
 * The deployments of one of Ambire's own descriptors, by kind: none when it has no list, and null
 * when its list is not written as `{ chainId, address }` with decimal chain ids
 */
const getOwnDeployments = (descriptor: unknown) => {
  const context =
    isPlainObject(descriptor) && isPlainObject(descriptor.context) ? descriptor.context : {}
  const read = (place: unknown) =>
    isPlainObject(place) && place.deployments !== undefined ? getDeployments(place.deployments) : []

  return { calldata: read(context.contract), eip712: read(context.eip712) }
}

/**
 * The registry keys Ambire's changes list more than once - in an amend's `addresses`, in an add,
 * or in the `deployments` of an own descriptor - each as a problem naming every place it is in.
 * Calldata and EIP-712 keys are checked separately, as a contract can have both
 */
export const findOverlappingKeys = (
  amendments: Amendments,
  ownDescriptors: Record<string, unknown>
): string[] => {
  const usesByKind: Record<'calldata' | 'EIP-712', Map<string, string[]>> = {
    calldata: new Map(),
    'EIP-712': new Map()
  }
  const use = (kind: 'calldata' | 'EIP-712', key: string, place: string) => {
    const uses = usesByKind[kind]
    uses.set(key, [...(uses.get(key) ?? []), place])
  }

  Object.entries(amendments.amendCalldataDescriptors).forEach(([name, { addresses }]) =>
    addresses.forEach((key) => use('calldata', key, `the amend of ${name}`))
  )
  Object.entries(amendments.amendEip712Descriptors).forEach(([name, { addresses }]) =>
    addresses.forEach((key) => use('EIP-712', key, `the amend of ${name}`))
  )
  Object.entries(amendments.addCalldataDescriptors).forEach(([key, name]) =>
    use('calldata', key, `the add of ${name}`)
  )
  Object.entries(amendments.addEip712Descriptors).forEach(([key, name]) =>
    use('EIP-712', key, `the add of ${name}`)
  )
  Object.entries(ownDescriptors).forEach(([name, descriptor]) => {
    const place = `the deployments of Ambire's descriptor ${name}`
    const { calldata, eip712 } = getOwnDeployments(descriptor)
    calldata?.forEach(({ chainId, address }) =>
      use('calldata', getRegistryKey(chainId, address), place)
    )
    eip712?.forEach(({ chainId, address }) =>
      use('EIP-712', getRegistryKey(chainId, address), place)
    )
  })

  return Object.entries(usesByKind).flatMap(([kind, uses]) =>
    [...uses]
      .filter(([, places]) => places.length > 1)
      .map(
        ([key, places]) =>
          `The ${kind} key ${key} is in more than one of Ambire's changes: ${places.join(
            ', '
          )}. Keep it in one`
      )
  )
}

/**
 * What breaks the rules of the bundled names, checked on the result of every build so that a
 * change of the build code can't break them unnoticed:
 * - a descriptor without Ambire's prefix is the registry's, unchanged
 * - `ambire-change/<path>` is the amend of the registry's `<path>`, and every amend has one
 * - `ambire-new/<path>` is Ambire's own descriptor `<path>`, unchanged
 * - the indexes point only at bundled descriptors, and never at one that is amended
 */
export const getNamingProblems = (
  registry: BuiltRegistry,
  sources: {
    /** The registry's descriptors, as the build read them */
    upstream: Record<string, unknown>
    /** Ambire's own descriptors, by their path */
    own: Record<string, unknown>
    /** The registry paths of the amended descriptors */
    amended: ReadonlySet<string>
  }
): string[] => {
  const problems: string[] = []
  // Compared as JSON, as they are JSON: copies made with `structuredClone` can have another
  // prototype (e.g. in tests), which a strict deep comparison would count as a difference
  const isSame = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other)

  Object.entries(registry.descriptors).forEach(([name, descriptor]) => {
    if (name.startsWith(ERC7730_AMBIRE_CHANGE_PATH_PREFIX)) {
      const path = name.slice(ERC7730_AMBIRE_CHANGE_PATH_PREFIX.length)
      if (!sources.amended.has(path))
        problems.push(`${name} is bundled, but no amend changes ${path}`)
      return
    }
    if (name.startsWith(ERC7730_AMBIRE_NEW_PATH_PREFIX)) {
      const path = name.slice(ERC7730_AMBIRE_NEW_PATH_PREFIX.length)
      if (!has(sources.own, path) || !isSame(descriptor, sources.own[path])) {
        problems.push(`${name} is not Ambire's own descriptor ${path} as it is`)
      }
      return
    }
    if (!has(sources.upstream, name) || !isSame(descriptor, sources.upstream[name])) {
      problems.push(`${name} is not the registry's descriptor as it is`)
    }
  })
  sources.amended.forEach((path) => {
    if (!has(registry.descriptors, `${ERC7730_AMBIRE_CHANGE_PATH_PREFIX}${path}`)) {
      problems.push(`The amend of ${path} has no \`${ERC7730_AMBIRE_CHANGE_PATH_PREFIX}\` copy`)
    }
  })

  const indexed = [
    ...Object.entries(registry.calldataIndex).map(([key, path]) => ({ key, path })),
    ...Object.entries(registry.eip712Index).flatMap(([key, entriesByPrimaryType]) =>
      Object.values(entriesByPrimaryType).flatMap((entries) =>
        entries.map(({ path }) => ({ key, path }))
      )
    )
  ]
  indexed.forEach(({ key, path }) => {
    if (!has(registry.descriptors, path)) problems.push(`${key} uses ${path}, which is not bundled`)
    else if (sources.amended.has(path)) {
      problems.push(`${key} uses ${path}, which is amended, instead of its copy`)
    }
  })

  return problems
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
  // Checked first: otherwise an overlap fails later with a message that doesn't tell its cause
  const overlaps = findOverlappingKeys(amendments, ownDescriptors)
  if (overlaps.length) throw new RegistryBuildError(overlaps)

  const problems: string[] = []
  const notes: string[] = []
  // Copies of what the build starts from, for the final check of the names: the descriptors below
  // are the same objects, so a change made to one in place would show in them too
  const upstreamDescriptors = structuredClone(built.descriptors)
  const ownDescriptorsAsRead = structuredClone(ownDescriptors)
  const descriptors: Record<string, Record<string, unknown>> = { ...built.descriptors }
  const calldataIndex = { ...built.calldataIndex }
  // Shallow copies: an entry is never changed in place, only replaced
  const eip712Index = { ...built.eip712Index }
  const hasDescriptor = (name: string) => has(descriptors, name)
  /** Registry path -> the path of its amended copy (`ambire-change/<path>`) */
  const amendedPaths = new Map<string, string>()

  /** A descriptor merged with everything it includes, or null if anything is missing */
  // No depth limit. An include already on the chain of includes being merged is skipped, so a loop
  // ends. Only that chain: a descriptor included twice through different ones is merged both times,
  // as in the wallet
  const flatten = (
    name: string,
    chain: ReadonlySet<string> = new Set()
  ): Erc7730Descriptor | null => {
    if (!hasDescriptor(name)) return null
    const descriptor = descriptors[name]
    // Every bundled descriptor passed this check already. It gives the descriptor its type
    if (!validateDescriptor(descriptor)) return null
    const includes = getIncludes(descriptor)
    if (!includes.length) return structuredClone(descriptor)

    const nextChain = new Set(chain).add(name)
    const included = includes
      .filter((include) => !nextChain.has(include))
      .map((include) => flatten(include, nextChain))
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

    const invalidFormats = formats.filter((format) => !getPrimaryType(format))
    if (invalidFormats.length) {
      problems.push(
        `${reference}: ${name} has typed message formats not written as \`Type(...)\`: ${invalidFormats.join(
          ', '
        )}`
      )
      return
    }

    const hashesByPrimaryType = formats.reduce<Record<string, string[]>>((acc, format) => {
      const primaryType = getPrimaryType(format)!
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

  // Ambire's prefixes tell its descriptors from the registry's, so the registry must not use them
  const registryPathsWithAmbirePrefix = Object.keys(built.descriptors).filter(isAmbireErc7730Path)
  if (registryPathsWithAmbirePrefix.length) {
    problems.push(
      `The registry has descriptors at paths that start like Ambire's (\`${ERC7730_AMBIRE_CHANGE_PATH_PREFIX}\`, \`${ERC7730_AMBIRE_NEW_PATH_PREFIX}\`): ${registryPathsWithAmbirePrefix.join(
        ', '
      )}`
    )
  }

  // Ambire's own descriptors, bundled as `ambire-new/<path>` and indexed by their deployments.
  // The prefix keeps them apart from the registry's descriptors, also ones at the same path
  Object.entries(ownDescriptors).forEach(([path, descriptor]) => {
    const reference = `Ambire's descriptor ${path}`
    const problem = getDescriptorProblem(descriptor)
    if (problem || !isPlainObject(descriptor)) {
      problems.push(`${reference}: ${problem}`)
      return
    }

    // Only the registry's descriptors can be included, as an include is never rewritten to the
    // `ambire-new/` name of another of Ambire's own. An unprefixed name is the registry's when it
    // has one
    const includes = getIncludes(descriptor)
    const ownIncludes = includes.filter(
      (include) =>
        isAmbireErc7730Path(include) || (has(ownDescriptors, include) && !hasDescriptor(include))
    )
    if (ownIncludes.length) {
      problems.push(
        `${reference} includes ${ownIncludes.join(', ')}, which are Ambire's. Include only descriptors of the registry`
      )
      return
    }
    const missingIncludes = includes.filter((include) => !hasDescriptor(include))
    if (missingIncludes.length) {
      problems.push(`${reference} includes ${missingIncludes.join(', ')}, which are not bundled`)
      return
    }

    const deployments = getOwnDeployments(descriptor)
    const invalidDeploymentsProblem = (list: string) =>
      `${reference}: \`${list}\` is not a list of \`{ chainId, address }\` with decimal chain ids`
    if (!deployments.calldata)
      problems.push(invalidDeploymentsProblem('context.contract.deployments'))
    if (!deployments.eip712) problems.push(invalidDeploymentsProblem('context.eip712.deployments'))
    if (!deployments.calldata || !deployments.eip712) return
    if (!deployments.calldata.length && !deployments.eip712.length) {
      problems.push(
        `${reference} has no \`context.contract.deployments\` or \`context.eip712.deployments\``
      )
      return
    }

    const name = `${ERC7730_AMBIRE_NEW_PATH_PREFIX}${path}`
    descriptors[name] = descriptor
    deployments.calldata.forEach(({ chainId, address }) =>
      addCalldataKey(getRegistryKey(chainId, address), name, reference)
    )
    deployments.eip712.forEach(({ chainId, address }) =>
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
    if (isAmbireErc7730Path(name)) {
      problems.push(
        `${reference}: amend only descriptors of the registry, by their registry path. Edit Ambire's own descriptors in their files`
      )
      return
    }
    const original = flatten(name)
    if (!original) {
      problems.push(`${reference}: the descriptor, or one it includes, is not bundled`)
      return
    }

    const invalidKeys = amendment.addresses.filter((key) => !isRegistryKey(key))
    if (invalidKeys.length) {
      problems.push(
        `${reference}: ${invalidKeys.join(', ')} not written as \`eip155:{chainId}:{lowercase address}\``
      )
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
      // Any other error is reported too, e.g. a `TypeError` once what the amend reads is gone, so
      // that it names the amend. It keeps its type in the message
      problems.push(`${reference}: ${error instanceof ExpectationError ? error.message : error}`)
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

    // Saved as a copy under `ambire-change/`, so that it is clear which descriptors are not the
    // registry's as they are, and every key that used the registry's descriptor uses the copy.
    // One copy per descriptor, as amends are keyed by the descriptor path. To amend the same
    // descriptor differently for different contracts in the future, give each copy a unique path,
    // e.g. with a short hash of its `addresses`, and point only those keys at it
    const copyName = `${ERC7730_AMBIRE_CHANGE_PATH_PREFIX}${name}`
    if (hasDescriptor(copyName)) {
      problems.push(`${reference}: ${copyName} is already in the registry`)
      return
    }
    descriptors[copyName] = first.descriptor
    amendedPaths.set(name, copyName)
    keys.forEach((key) => {
      if (kind === 'calldata') {
        calldataIndex[key] = copyName
        return
      }
      eip712Index[key] = Object.fromEntries(
        Object.entries(eip712Index[key]!).map(([primaryType, entries]) => [
          primaryType,
          entries.map((entry) => (entry.path === name ? { ...entry, path: copyName } : entry))
        ])
      )
    })
    notes.push(`${name} is amended: ${amendment.reason}`)
  }

  Object.entries(amendments.amendCalldataDescriptors).forEach(([name, amendment]) =>
    amend(name, amendment, 'calldata')
  )
  Object.entries(amendments.amendEip712Descriptors).forEach(([name, amendment]) =>
    amend(name, amendment, 'eip712')
  )

  // An add names a descriptor of the registry by its registry path. An add of an amended descriptor
  // uses its amended copy, and the registry's descriptor again once the amend is removed. Ambire's
  // own descriptors get their keys from their `deployments` only
  const getAddProblem = (name: string): string | null => {
    if (isAmbireErc7730Path(name)) {
      return "add only descriptors of the registry, by their registry path. Add the keys of an amended descriptor with its registry path, and those of Ambire's own descriptors to their `deployments`"
    }
    if (!hasDescriptor(name)) return 'the descriptor is not bundled'

    return null
  }
  Object.entries(amendments.addCalldataDescriptors).forEach(([key, name]) => {
    const reference = `The add of ${name} for ${key}`
    const problem = getAddProblem(name)
    if (problem) problems.push(`${reference}: ${problem}`)
    else addCalldataKey(key, amendedPaths.get(name) ?? name, reference)
  })
  Object.entries(amendments.addEip712Descriptors).forEach(([key, name]) => {
    const reference = `The add of ${name} for ${key}`
    const problem = getAddProblem(name)
    if (problem) problems.push(`${reference}: ${problem}`)
    else addEip712Key(key, amendedPaths.get(name) ?? name, reference)
  })

  // The registry's version of an amended descriptor is not bundled when nothing uses it any more
  // (another descriptor may still include it), and neither are the descriptors only it includes
  const removeIfUnused = (name: string) => {
    if (!hasDescriptor(name)) return
    const isIncluded = Object.values(descriptors).some((descriptor) =>
      getIncludes(descriptor).includes(name)
    )
    const isUsed = usesInIndex(name, 'calldata').length || usesInIndex(name, 'eip712').length
    if (isUsed || isIncluded) return

    const includes = getIncludes(descriptors[name]!)
    delete descriptors[name]
    includes.forEach(removeIfUnused)
  }
  amendedPaths.forEach((_, name) => removeIfUnused(name))

  if (problems.length) throw new RegistryBuildError(problems)

  const registry = {
    calldataIndex: sortByKey(calldataIndex),
    eip712Index: sortByKey(eip712Index),
    descriptors: sortByKey(descriptors)
  }
  const namingProblems = getNamingProblems(registry, {
    upstream: upstreamDescriptors,
    own: ownDescriptorsAsRead,
    amended: new Set(amendedPaths.keys())
  })
  if (namingProblems.length) throw new RegistryBuildError(namingProblems)

  return { registry, notes }
}
