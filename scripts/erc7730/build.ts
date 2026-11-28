import { isHexString } from 'ethers'

import { SUPPORTED_ERC7730_SCHEMA_FILES } from '../../src/libs/humanizer/erc7730/consts'
import {
  getIncludes,
  getSchemaFileName,
  validateDescriptor
} from '../../src/libs/humanizer/erc7730/descriptor'
import { Erc7730CalldataIndex, Erc7730Eip712Index } from '../../src/libs/humanizer/erc7730/types'
import { getRegistryKey, isPlainObject } from '../../src/libs/humanizer/erc7730/utils'

// Builds the ERC-7730 registry the wallet ships with from the files of the upstream registry. It
// reads nothing itself, so that the tests can run it on their own files: see
// `scripts/updateErc7730Registry.ts` for where the files come from.
//
// The wallet knows each descriptor by its path in the upstream registry (e.g.
// `registry/uniswap/calldata-X.json` or `ercs/calldata-erc20-tokens.json`). Each `includes` is
// rewritten to the path of the descriptor it includes, so the wallet never resolves a relative
// path.

/** The files of one commit of the upstream registry */
export type UpstreamFiles = {
  /** The paths of all files of the commit, relative to the root of the repository */
  paths: ReadonlySet<string>
  /** The parsed JSON file at a path of `paths`. Throws if it isn't valid JSON */
  read: (path: string) => unknown
}

/**
 * `eip155:{chainId}:{verifyingContract}` -> primary type -> the paths of the descriptors for it, as
 * upstream indexes them. The build checks Ambire's EIP-712 adds against it per primary type; the
 * bundled index keeps only the paths (see `toEip712PathIndex`)
 */
export type Eip712IndexByPrimaryType = Record<string, Record<string, string[]>>

export type BuiltRegistry = {
  calldataIndex: Erc7730CalldataIndex
  eip712Index: Eip712IndexByPrimaryType
  descriptors: Record<string, Record<string, unknown>>
}

/** The registry as it is bundled */
export type BundledRegistry = Omit<BuiltRegistry, 'eip712Index'> & {
  eip712Index: Erc7730Eip712Index
}

/**
 * The bundled EIP-712 index: each contract with the paths of its descriptors. The primary types and
 * encoded type hashes are not kept: the wallet reads them from the descriptors' format keys, which
 * is also how upstream computes them, so they are not repeated for every contract
 */
export const toEip712PathIndex = (index: Eip712IndexByPrimaryType): Erc7730Eip712Index =>
  sortByKey(
    Object.fromEntries(
      Object.entries(index).map(([key, pathsByPrimaryType]) => [
        key,
        [...new Set(Object.values(pathsByPrimaryType).flat())].sort()
      ])
    )
  )

export const CALLDATA_INDEX_FILE = 'index.calldata.json'
export const EIP712_INDEX_FILE = 'index.eip712.json'

/** Thrown with every problem found, so that one run lists all of them */
export class RegistryBuildError extends Error {
  problems: string[]

  constructor(problems: string[]) {
    super(
      `The ERC-7730 registry has ${problems.length} problem(s):\n${problems
        .map((problem) => `- ${problem}`)
        .join('\n')}`
    )
    this.name = 'RegistryBuildError'
    this.problems = problems
  }
}

export const sortByKey = <T>(object: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))

/** Whether a key is written the way lookups build it: `eip155:{chainId}:{lowercase address}` */
export const isRegistryKey = (key: string): boolean => {
  const [namespace, chainId = '', address = '', ...rest] = key.split(':')
  if (namespace !== 'eip155' || rest.length || !chainId || !isHexString(address, 20)) return false

  try {
    return getRegistryKey(chainId, address) === key
  } catch {
    return false
  }
}

/**
 * The registry path of the descriptor an `includes` entry points at, resolved against the path of
 * the descriptor that includes it: `..` goes up a folder and a leading `/` starts at the root of
 * the registry. Throws for anything that is not a JSON file inside the registry, such as a URL
 */
export const resolveIncludePath = (includePath: string, parentPath: string): string => {
  if (includePath.startsWith('http://') || includePath.startsWith('https://')) {
    throw new Error(`it includes a URL instead of a file of the registry: ${includePath}`)
  }

  const parentFolderSegments = includePath.startsWith('/') ? [] : parentPath.split('/').slice(0, -1)
  const segments: string[] = []
  for (const segment of [...parentFolderSegments, ...includePath.split('/')]) {
    if (segment === '..' && !segments.length) {
      throw new Error(`it includes a file outside the registry: ${includePath}`)
    }
    if (segment === '..') segments.pop()
    else if (segment !== '' && segment !== '.') segments.push(segment)
  }

  const resolvedPath = segments.join('/')
  if (!resolvedPath.endsWith('.json')) {
    throw new Error(`it includes a file that is not JSON: ${includePath}`)
  }

  return resolvedPath
}

/** Whether a value is an entry of upstream's EIP-712 index: `{ path, encodeTypeHashes? }` */
const isEip712IndexEntry = (
  entry: unknown
): entry is { path: string; encodeTypeHashes?: string[] } =>
  isPlainObject(entry) &&
  typeof entry.path === 'string' &&
  (entry.encodeTypeHashes === undefined ||
    (Array.isArray(entry.encodeTypeHashes) &&
      entry.encodeTypeHashes.every((hash) => typeof hash === 'string')))

/** Why a descriptor can't be bundled, or null if it can */
export const getDescriptorProblem = (descriptor: unknown): string | null => {
  if (!isPlainObject(descriptor)) return 'it is not a JSON object'

  const schemaFileName = getSchemaFileName(descriptor)
  if (!schemaFileName || !SUPPORTED_ERC7730_SCHEMA_FILES.has(schemaFileName)) {
    return `its version of ERC-7730 is not supported: ${schemaFileName ?? 'it declares none'}`
  }

  try {
    validateDescriptor(descriptor)
  } catch {
    return 'it is not a valid descriptor'
  }

  return null
}

/**
 * The registry the wallet ships with: the indexes of the upstream registry and every descriptor
 * they point at, with everything those include. Throws a `RegistryBuildError` with every problem
 * found - a missing, invalid or unsupported descriptor, a missing include or an invalid index
 * entry - instead of leaving anything out, so that a change upstream is never dropped unnoticed.
 */
export const buildRegistry = (upstream: UpstreamFiles): BuiltRegistry => {
  const problems: string[] = []
  const descriptors = new Map<string, Record<string, unknown>>()
  const visited = new Set<string>()

  /** Reads a descriptor and everything it includes, recording what is wrong with any of them */
  const load = (path: string, reference: string) => {
    if (visited.has(path)) return
    visited.add(path)

    if (!upstream.paths.has(path)) {
      problems.push(`${reference} points at ${path}, which is not in the registry`)
      return
    }

    let descriptor: unknown
    try {
      descriptor = upstream.read(path)
    } catch (error) {
      problems.push(`${path} can't be read: ${error instanceof Error ? error.message : error}`)
      return
    }

    const problem = getDescriptorProblem(descriptor)
    if (problem || !isPlainObject(descriptor)) {
      problems.push(`${path}: ${problem}`)
      return
    }

    descriptors.set(path, descriptor)

    getIncludes(descriptor).forEach((includePath) => {
      try {
        load(resolveIncludePath(includePath, path), `${path} (includes)`)
      } catch (error) {
        problems.push(`${path}: ${error instanceof Error ? error.message : error}`)
      }
    })
  }

  const readIndex = (file: string): Record<string, unknown> => {
    if (!upstream.paths.has(file)) {
      problems.push(`The registry has no ${file}`)
      return {}
    }
    let index: unknown
    try {
      index = upstream.read(file)
    } catch (error) {
      problems.push(`${file} can't be read: ${error instanceof Error ? error.message : error}`)
      return {}
    }
    if (isPlainObject(index)) return index

    problems.push(`${file} is not a JSON object`)
    return {}
  }

  const calldataIndex: Erc7730CalldataIndex = {}
  Object.entries(readIndex(CALLDATA_INDEX_FILE)).forEach(([key, path]) => {
    const reference = `${CALLDATA_INDEX_FILE} (${key})`
    if (!isRegistryKey(key)) problems.push(`${reference}: the key is not written as expected`)
    if (typeof path !== 'string') {
      problems.push(`${reference}: the path is not a string`)
      return
    }

    load(path, reference)
    calldataIndex[key] = path
  })

  const eip712Index: Eip712IndexByPrimaryType = {}
  Object.entries(readIndex(EIP712_INDEX_FILE)).forEach(([key, entriesByPrimaryType]) => {
    const reference = `${EIP712_INDEX_FILE} (${key})`
    if (!isRegistryKey(key)) problems.push(`${reference}: the key is not written as expected`)
    if (!isPlainObject(entriesByPrimaryType)) {
      problems.push(`${reference}: the entry is not a JSON object`)
      return
    }

    const indexEntry: Record<string, string[]> = {}
    Object.entries(entriesByPrimaryType).forEach(([primaryType, entries]) => {
      if (!Array.isArray(entries) || !entries.every(isEip712IndexEntry)) {
        problems.push(`${reference} (${primaryType}): the entries are not written as expected`)
        return
      }

      entries.forEach(({ path }) => load(path, `${reference} (${primaryType})`))
      indexEntry[primaryType] = entries.map(({ path }) => path)
    })
    eip712Index[key] = indexEntry
  })

  if (problems.length) throw new RegistryBuildError(problems)

  const descriptorsWithResolvedIncludes = Object.fromEntries(
    [...descriptors].map(([path, descriptor]) => {
      if (descriptor.includes === undefined) return [path, descriptor]

      const toIncludedPath = (includePath: string) => resolveIncludePath(includePath, path)
      const includes = Array.isArray(descriptor.includes)
        ? getIncludes(descriptor).map(toIncludedPath)
        : toIncludedPath(getIncludes(descriptor)[0]!)

      return [path, { ...descriptor, includes }]
    })
  )
  return {
    calldataIndex: sortByKey(calldataIndex),
    eip712Index: sortByKey(eip712Index),
    descriptors: sortByKey(descriptorsWithResolvedIncludes)
  }
}
