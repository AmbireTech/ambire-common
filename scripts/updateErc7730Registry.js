const fsPromises = require('fs').promises
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

// Regenerates the ERC-7730 ("clear signing") registry the wallet ships with: the indexes and the
// descriptors of https://github.com/ethereum/clear-signing-erc7730-registry. The wallet reads
// descriptors only from this file (see `src/consts/erc7730/index.ts`), so describing a
// transaction or a message sends nothing about it anywhere. New descriptors are added to the
// registry every week, so run this from time to time with
// `npm run humanizer:update:erc7730Registry` and commit the changes. It is NOT called at runtime.
//
// Only the descriptors the indexes point at (and the ones they include) are kept, plus the ones
// Ambire's fallback index points at (`src/consts/erc7730/fallbackCalldataIndex.json`); the tests
// and the rest of the registry are left out. Ambire's own descriptors are not in this file, they
// are in `src/consts/erc7730/ambireDescriptors.ts`.
//
// The file only changes when the registry data does: the indexes and the descriptors are sorted
// by their key, and `source.commit` is kept when nothing was added, removed or changed. Each index
// entry and each descriptor is on a line of its own (see `serializeRegistry`).
//
// Set `ERC7730_REGISTRY_SUMMARY_PATH` to also write a summary of the changes in Markdown there.
// Set `ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true` to save a registry from which many contracts
// really were removed (see `assertNotTooManyRemoved`).

const REGISTRY_REPOSITORY_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry'
const REGISTRY_BRANCH = 'master'
const CALLDATA_INDEX_FILE = 'index.calldata.json'
const EIP712_INDEX_FILE = 'index.eip712.json'

/**
 * The share of an index that can disappear in one update. More likely means that the registry
 * was restructured or partially published, and saving it would stop describing transactions that
 * were described until now
 */
const MAX_REMOVED_SHARE = 0.2

/** How many paths each list of the summary shows, so that it fits in the body of a PR */
const MAX_LISTED_PATHS = 100

const erc7730ConstsPath = path.join(__dirname, '..', 'src', 'consts', 'erc7730')
const outputPath = path.join(erc7730ConstsPath, 'registry.json')
const fallbackCalldataIndexPath = path.join(erc7730ConstsPath, 'fallbackCalldataIndex.json')

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

const sortByKey = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))

/**
 * Shallow-clones the registry repository at the latest commit of its main branch. Without a
 * checkout, as the files are read from git itself: the registry has files whose paths differ
 * only in case, which a case-insensitive file system (macOS) would check out as one file
 */
const cloneRegistry = (directory) => {
  execFileSync(
    'git',
    [
      'clone',
      '--quiet',
      '--no-checkout',
      '--depth',
      '1',
      '--branch',
      REGISTRY_BRANCH,
      REGISTRY_REPOSITORY_URL,
      directory
    ],
    { stdio: 'inherit' }
  )

  return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

/**
 * The path of a file inside the registry, as the indexes and the `includes` write it (relative to
 * the root of the repository). Throws for anything that is not a JSON file inside it
 */
const toRegistryPath = (filePath) => {
  const normalized = path.posix.normalize(filePath)
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !normalized.endsWith('.json')
  ) {
    throw new Error(`Not a JSON file inside the registry: ${filePath}`)
  }

  return normalized
}

/** Reads a JSON file of the cloned commit. Throws if it doesn't exist or isn't valid JSON */
const readJson = async (registryDirectory, registryPath) =>
  JSON.parse(
    execFileSync('git', ['-C', registryDirectory, 'show', `HEAD:${registryPath}`], {
      encoding: 'utf8',
      // The largest descriptors are a few hundred KB, the default 1 MB would be close
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )

/**
 * The registry path of the descriptor an `includes` entry points at, resolved against the path of
 * the descriptor that includes it: `..` goes up a folder and a leading `/` starts at the root of
 * the registry. The wallet looks the included descriptor up with `resolveIncludePath` in
 * `src/libs/humanizer/erc7730/registry.ts`, so this resolves it the same way (without the leading
 * slash) - keep the two in sync. Throws for a URL, as only files of the registry are bundled
 */
const resolveIncludePath = (includePath, parentPath) => {
  if (includePath.startsWith('http://') || includePath.startsWith('https://')) {
    throw new Error(`It includes a URL instead of a file of the registry: ${includePath}`)
  }

  const parentFolderSegments = includePath.startsWith('/') ? [] : parentPath.split('/').slice(0, -1)
  const segments = [...parentFolderSegments, ...includePath.split('/')].reduce(
    (resolved, segment) => {
      if (segment === '' || segment === '.') return resolved
      if (segment === '..') return resolved.slice(0, -1)

      return [...resolved, segment]
    },
    []
  )

  return segments.join('/')
}

/** The paths a descriptor includes. Throws if any isn't a JSON file of the registry */
const getIncludedPaths = (descriptor, descriptorPath) => {
  if (!descriptor.includes) return []

  const includes = Array.isArray(descriptor.includes) ? descriptor.includes : [descriptor.includes]

  return includes.map((includePath) =>
    toRegistryPath(resolveIncludePath(includePath, descriptorPath))
  )
}

/**
 * Reads a descriptor and everything it includes (recursively) into `loading`, skipping the ones
 * already in `descriptors`. Returns false when any of them is missing, is not a JSON object or
 * includes something that is not a file of the registry
 */
const collectDescriptorWithIncludes = async (
  registryDirectory,
  descriptorPath,
  descriptors,
  loading
) => {
  if (descriptors.has(descriptorPath) || loading.has(descriptorPath)) return true

  let descriptor
  let includedPaths
  try {
    descriptor = await readJson(registryDirectory, toRegistryPath(descriptorPath))
    if (!isPlainObject(descriptor)) throw new Error('It is not a JSON object')
    includedPaths = getIncludedPaths(descriptor, descriptorPath)
  } catch (error) {
    console.warn(`Skipping the descriptor ${descriptorPath}: ${error.message}`)
    return false
  }

  loading.set(descriptorPath, descriptor)

  for (const includedPath of includedPaths) {
    // eslint-disable-next-line no-await-in-loop
    const isIncludeLoaded = await collectDescriptorWithIncludes(
      registryDirectory,
      includedPath,
      descriptors,
      loading
    )
    if (!isIncludeLoaded) return false
  }

  return true
}

/**
 * Adds a descriptor and everything it includes to `descriptors` - all of them or none. Returns
 * false when any of them can't be loaded, so that the index entry pointing at it is dropped
 * instead of pointing at a descriptor the wallet can't use, and no descriptor it includes is left
 * in the file with nothing pointing at it
 */
const loadDescriptorWithIncludes = async (registryDirectory, descriptorPath, descriptors) => {
  const loading = new Map()
  const isLoaded = await collectDescriptorWithIncludes(
    registryDirectory,
    descriptorPath,
    descriptors,
    loading
  )
  if (isLoaded) {
    loading.forEach((descriptor, loadedPath) => descriptors.set(loadedPath, descriptor))
  }

  return isLoaded
}

/**
 * Reads the indexes and the descriptors they point at, plus the descriptors Ambire's fallback
 * index points at. Index entries whose descriptor can't be loaded are dropped and listed in
 * `skipped`; a fallback whose descriptor can't be loaded fails the update, as it is Ambire's
 * fallback index that needs to change then
 */
const readRegistry = async (registryDirectory, fallbackPaths) => {
  const [upstreamCalldataIndex, upstreamEip712Index] = await Promise.all([
    readJson(registryDirectory, CALLDATA_INDEX_FILE),
    readJson(registryDirectory, EIP712_INDEX_FILE)
  ])
  if (!isPlainObject(upstreamCalldataIndex) || !isPlainObject(upstreamEip712Index)) {
    throw new Error('The indexes of the registry are not JSON objects')
  }

  const descriptors = new Map()
  const skipped = new Set()
  const isUsable = async (descriptorPath) => {
    if (typeof descriptorPath !== 'string') return false
    const isLoaded = await loadDescriptorWithIncludes(
      registryDirectory,
      descriptorPath,
      descriptors
    )
    if (!isLoaded) skipped.add(descriptorPath)

    return isLoaded
  }

  const calldataIndex = {}
  for (const [key, descriptorPath] of Object.entries(upstreamCalldataIndex)) {
    // eslint-disable-next-line no-await-in-loop
    if (await isUsable(descriptorPath)) calldataIndex[key] = descriptorPath
  }

  const eip712Index = {}
  for (const [key, entriesByPrimaryType] of Object.entries(upstreamEip712Index)) {
    if (!isPlainObject(entriesByPrimaryType)) continue

    const usableEntriesByPrimaryType = {}
    for (const [primaryType, entries] of Object.entries(entriesByPrimaryType)) {
      if (!Array.isArray(entries)) continue

      const usableEntries = []
      for (const entry of entries) {
        // eslint-disable-next-line no-await-in-loop
        if (isPlainObject(entry) && (await isUsable(entry.path))) usableEntries.push(entry)
      }
      if (usableEntries.length) usableEntriesByPrimaryType[primaryType] = usableEntries
    }
    if (Object.keys(usableEntriesByPrimaryType).length) {
      eip712Index[key] = usableEntriesByPrimaryType
    }
  }

  for (const fallbackPath of fallbackPaths) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await loadDescriptorWithIncludes(registryDirectory, fallbackPath, descriptors))) {
      throw new Error(
        `Ambire's fallback index (src/consts/erc7730/fallbackCalldataIndex.json) points at ${fallbackPath}, which the registry no longer has. Point those entries at the registry's current descriptor, or remove them`
      )
    }
  }

  return {
    calldataIndex: sortByKey(calldataIndex),
    eip712Index: sortByKey(eip712Index),
    descriptors: sortByKey(Object.fromEntries(descriptors)),
    skipped: [...skipped].sort()
  }
}

/**
 * The registry as JSON with one line per index entry and per descriptor, so that a diff shows
 * which entries changed while the file stays about half the size of a fully indented one
 */
const serializeRegistry = ({ source, calldataIndex, eip712Index, descriptors }) => {
  const serializeMap = (map) => {
    const lines = Object.entries(map).map(
      ([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`
    )

    return lines.length ? `{\n${lines.join(',\n')}\n  }` : '{}'
  }

  return [
    '{',
    `  "source": ${JSON.stringify(source)},`,
    `  "calldataIndex": ${serializeMap(calldataIndex)},`,
    `  "eip712Index": ${serializeMap(eip712Index)},`,
    `  "descriptors": ${serializeMap(descriptors)}`,
    '}',
    ''
  ].join('\n')
}

/** The registry paths Ambire's fallback index points at, see `fallbackCalldataIndexPath` */
const readFallbackPaths = async () => {
  const fallbackCalldataIndex = JSON.parse(
    await fsPromises.readFile(fallbackCalldataIndexPath, 'utf8')
  )

  return [...new Set(Object.values(fallbackCalldataIndex))].sort()
}

const readPreviousRegistry = async () => {
  try {
    return JSON.parse(await fsPromises.readFile(outputPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** The keys added, removed and changed in `next`, compared with `previous` */
const getChanges = (previous = {}, next = {}) => {
  const nextKeys = Object.keys(next)

  return {
    previousCount: Object.keys(previous).length,
    added: nextKeys.filter((key) => !(key in previous)),
    removed: Object.keys(previous).filter((key) => !(key in next)),
    changed: nextKeys.filter(
      (key) => key in previous && JSON.stringify(previous[key]) !== JSON.stringify(next[key])
    )
  }
}

const hasChanges = ({ added, removed, changed }) =>
  added.length > 0 || removed.length > 0 || changed.length > 0

/**
 * Throws if too much of an index disappeared, which likely means the registry was restructured
 * or partially published. Skipped with `ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true`, for when the
 * contracts really were removed
 */
const assertNotTooManyRemoved = ({ previousCount, removed }, label) => {
  if (process.env.ERC7730_REGISTRY_ALLOW_MANY_REMOVALS === 'true') return
  if (!previousCount || removed.length / previousCount <= MAX_REMOVED_SHARE) return

  throw new Error(
    `${removed.length} of the ${previousCount} ${label} are no longer in the registry. Check the registry, and if they really were removed, run again with ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true`
  )
}

const formatList = (title, paths) => {
  if (!paths.length) return []

  const listed = paths.slice(0, MAX_LISTED_PATHS).map((listedPath) => `- \`${listedPath}\``)
  const notListedCount = paths.length - listed.length

  return [
    '',
    `<details><summary>${title} (${paths.length})</summary>`,
    '',
    ...listed,
    ...(notListedCount > 0 ? [`- ...and ${notListedCount} more`] : []),
    '',
    '</details>'
  ]
}

const getSummary = ({
  calldataChanges,
  eip712Changes,
  descriptorChanges,
  skipped,
  source,
  previousCommit
}) => {
  const formatChanges = ({ added, removed, changed }) =>
    `+${added.length} / -${removed.length} / ~${changed.length}`
  const compareLink =
    previousCommit && previousCommit !== source.commit
      ? `${REGISTRY_REPOSITORY_URL}/compare/${previousCommit}...${source.commit}`
      : `${REGISTRY_REPOSITORY_URL}/tree/${source.commit}`

  return [
    `The ERC-7730 registry at [${source.commit.slice(0, 7)}](${compareLink}).`,
    '',
    '| | Added / removed / changed |',
    '|---|---|',
    `| Contracts (calldata index) | ${formatChanges(calldataChanges)} |`,
    `| Typed messages (EIP-712 index) | ${formatChanges(eip712Changes)} |`,
    `| Descriptor files | ${formatChanges(descriptorChanges)} |`,
    ...formatList('Added descriptors', descriptorChanges.added),
    ...formatList('Changed descriptors', descriptorChanges.changed),
    ...formatList('Removed descriptors', descriptorChanges.removed),
    ...formatList('Skipped, as they or a file they include could not be read', skipped),
    '',
    'Transactions and messages of removed contracts are no longer described with ERC-7730.'
  ].join('\n')
}

const run = async () => {
  const registryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'erc7730-registry-'))

  try {
    const commit = cloneRegistry(registryDirectory)
    const [fallbackPaths, previous] = await Promise.all([
      readFallbackPaths(),
      readPreviousRegistry()
    ])
    const { calldataIndex, eip712Index, descriptors, skipped } = await readRegistry(
      registryDirectory,
      fallbackPaths
    )

    const calldataChanges = getChanges(previous?.calldataIndex, calldataIndex)
    const eip712Changes = getChanges(previous?.eip712Index, eip712Index)
    const descriptorChanges = getChanges(previous?.descriptors, descriptors)
    assertNotTooManyRemoved(calldataChanges, 'contracts of the calldata index')
    assertNotTooManyRemoved(eip712Changes, 'contracts of the EIP-712 index')

    const hasRegistryChanged = [calldataChanges, eip712Changes, descriptorChanges].some(hasChanges)
    const source = {
      repository: REGISTRY_REPOSITORY_URL,
      // Kept when nothing changed, so the file doesn't change just because of an unrelated commit
      commit: hasRegistryChanged || !previous?.source?.commit ? commit : previous.source.commit
    }
    const registry = { source, calldataIndex, eip712Index, descriptors }

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true })
    await fsPromises.writeFile(outputPath, serializeRegistry(registry), 'utf8')

    const summary = getSummary({
      calldataChanges,
      eip712Changes,
      descriptorChanges,
      skipped,
      source,
      previousCommit: previous?.source?.commit
    })
    if (process.env.ERC7730_REGISTRY_SUMMARY_PATH) {
      await fsPromises.writeFile(process.env.ERC7730_REGISTRY_SUMMARY_PATH, `${summary}\n`, 'utf8')
    }

    console.log(summary)
  } finally {
    await fsPromises.rm(registryDirectory, { recursive: true, force: true })
  }
}

// Run only when called as a script, so `bundledRegistry.test.ts` can import `resolveIncludePath`
// to check it against the wallet's own
if (require.main === module) {
  run().catch((error) => {
    console.error('Failed to update the ERC-7730 registry:', error)
    process.exitCode = 1
  })
}

module.exports = { resolveIncludePath }
