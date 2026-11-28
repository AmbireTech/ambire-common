import { execFileSync } from 'child_process'
import { promises as fsPromises } from 'fs'
import os from 'os'
import path from 'path'

import { ERC7730_AMBIRE_CHANGE_PATH_PREFIX } from '../src/libs/humanizer/erc7730/consts'
import { applyAmendments } from './erc7730/amend'
import { amendments } from './erc7730/amendments'
import { buildRegistry, BundledRegistry, UpstreamFiles } from './erc7730/build'

// Regenerates the ERC-7730 ("clear signing") registry the wallet ships with: the indexes and the
// descriptors of https://github.com/ethereum/clear-signing-erc7730-registry. The wallet reads
// descriptors only from this file (see `src/consts/erc7730/index.ts`), so describing a
// transaction or a message sends nothing about it anywhere. New descriptors are added to the
// registry every week, so run this from time to time with
// `npm run humanizer:update:erc7730Registry` and commit the changes. It is NOT called at runtime.
//
// It reads the latest commit of the registry's main branch. It does not wait for a commit to get
// older: a delay would still ship a bad descriptor that upstream removed within the delay, and
// every update is reviewed as a diff of `registry.json` before it is merged.
//
// Only the descriptors the indexes point at (and the ones they include) are kept; the tests and
// the rest of the registry are left out. The update fails, and writes nothing, if any of these
// descriptors is missing, invalid or of a version of ERC-7730 the wallet doesn't support (see
// `buildRegistry`). Then Ambire's changes and own descriptors are applied (see
// `scripts/erc7730/amendments.ts` and `applyAmendments`), which fail the update in the same way
// once an upstream change makes one of them wrong or no longer needed.
//
// The file only changes when the registry data does: the indexes and the descriptors are sorted
// by their key, and `source` is kept when nothing was added, removed or changed. Each index entry
// and each descriptor is on a line of its own (see `serializeRegistry`).
//
// Set `ERC7730_REGISTRY_SUMMARY_PATH` to also write a summary of the changes in Markdown there.
// Set `ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true` to save a registry from which many contracts
// really were removed (see `assertNotTooManyRemoved`).

const REGISTRY_REPOSITORY_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry'
const REGISTRY_BRANCH = 'master'

/**
 * The share of an index that can disappear in one update. More likely means that the registry
 * was restructured or partially published, and saving it would stop describing transactions that
 * were described until now
 */
const MAX_REMOVED_SHARE = 0.2

/**
 * The size of `registry.json` above which the update warns, and above which it fails. The
 * registry is one module of the extension's background script, and Firefox doesn't load a file
 * of more than 5 MB (`webpack/extension.js` of the app splits its chunks at 4.5 MB)
 */
const WARN_REGISTRY_BYTES = 3 * 1024 * 1024
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024

/** How many paths each list of the summary shows, so that it fits in the body of a PR */
const MAX_LISTED_PATHS = 100

const erc7730ConstsPath = path.join(__dirname, '..', 'src', 'consts', 'erc7730')
const outputPath = path.join(erc7730ConstsPath, 'registry.json')
const ownDescriptorsPath = path.join(__dirname, 'erc7730', 'descriptors')

type Source = { repository: string; commit: string; date: string }
type Registry = BundledRegistry & { source: Source }

const git = (directory: string, args: string[]) =>
  execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    // The largest descriptors are a few hundred KB, the default 1 MB would be close
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })

/**
 * Clones the latest commit of the registry repository. Bare, as the files are read from git
 * itself: the registry has files whose paths differ only in case, which a case-insensitive file
 * system (macOS) would check out as one file
 */
const cloneRegistry = (directory: string): { source: Source; files: UpstreamFiles } => {
  execFileSync(
    'git',
    [
      'clone',
      '--quiet',
      '--bare',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      REGISTRY_BRANCH,
      REGISTRY_REPOSITORY_URL,
      directory
    ],
    { stdio: 'inherit' }
  )

  const commit = git(directory, ['rev-parse', REGISTRY_BRANCH]).trim()
  const date = git(directory, ['show', '-s', '--format=%cI', commit]).trim()
  const paths = new Set(
    git(directory, ['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean)
  )

  return {
    source: { repository: REGISTRY_REPOSITORY_URL, commit, date },
    files: {
      paths,
      read: (filePath) => JSON.parse(git(directory, ['show', `${commit}:${filePath}`]))
    }
  }
}

/**
 * The registry as JSON with one line per index entry and per descriptor, so that a diff shows
 * which entries changed while the file stays about half the size of a fully indented one
 */
const serializeRegistry = ({ source, calldataIndex, eip712Index, descriptors }: Registry) => {
  const serializeMap = (map: Record<string, unknown>) => {
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

/** Ambire's own descriptors (see `ownDescriptorsPath`), by their path in that folder */
const readOwnDescriptors = async (): Promise<Record<string, unknown>> => {
  let entries: string[]
  try {
    entries = await fsPromises.readdir(ownDescriptorsPath, { recursive: true })
  } catch (error: any) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
  const files = entries.filter((file) => file.endsWith('.json')).sort()

  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file.split(path.sep).join('/'),
        JSON.parse(await fsPromises.readFile(path.join(ownDescriptorsPath, file), 'utf8'))
      ])
    )
  )
}

const readPreviousRegistry = async (): Promise<Partial<Registry> | null> => {
  try {
    return JSON.parse(await fsPromises.readFile(outputPath, 'utf8'))
  } catch (error: any) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

type Changes = { previousCount: number; added: string[]; removed: string[]; changed: string[] }

/** The keys added, removed and changed in `next`, compared with `previous` */
const getChanges = (
  previous: Record<string, unknown> = {},
  next: Record<string, unknown> = {}
): Changes => {
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

/**
 * Throws if too much of an index disappeared, which likely means the registry was restructured
 * or partially published. Skipped with `ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true`, for when the
 * contracts really were removed
 */
const assertNotTooManyRemoved = ({ previousCount, removed }: Changes, label: string) => {
  if (process.env.ERC7730_REGISTRY_ALLOW_MANY_REMOVALS === 'true') return
  if (!previousCount || removed.length / previousCount <= MAX_REMOVED_SHARE) return

  throw new Error(
    `${removed.length} of the ${previousCount} ${label} are no longer in the registry. Check the registry, and if they really were removed, run again with ERC7730_REGISTRY_ALLOW_MANY_REMOVALS=true`
  )
}

/** Throws if the registry is too big to bundle, and warns when it gets close */
const assertSize = (serialized: string) => {
  const bytes = Buffer.byteLength(serialized, 'utf8')
  const megabytes = (bytes / 1024 / 1024).toFixed(2)
  if (bytes > MAX_REGISTRY_BYTES) {
    throw new Error(
      `The registry is ${megabytes} MB, more than the ${MAX_REGISTRY_BYTES / 1024 / 1024} MB the extension can bundle as one file. Split it before updating it`
    )
  }
  if (bytes > WARN_REGISTRY_BYTES) {
    console.warn(`The registry is ${megabytes} MB, close to the most the extension can bundle`)
  }
}

/**
 * Where a summary is shown: the terminal, or the Markdown file of `ERC7730_REGISTRY_SUMMARY_PATH`,
 * which is meant for the body of a PR
 */
type SummaryFormat = 'terminal' | 'markdown'

/**
 * A titled list. In Markdown it is folded in `<details>` and cut at `MAX_LISTED_PATHS`, so that a
 * PR body stays short; in the terminal it is listed in full
 */
const formatList = (
  title: string,
  items: string[],
  format: SummaryFormat,
  { asCode = true } = {}
) => {
  if (!items.length) return []
  if (format === 'terminal')
    return ['', `${title} (${items.length}):`, ...items.map((item) => `- ${item}`)]

  const listed = items
    .slice(0, MAX_LISTED_PATHS)
    .map((item) => (asCode ? `- \`${item}\`` : `- ${item}`))
  const notListedCount = items.length - listed.length

  return [
    '',
    `<details><summary>${title} (${items.length})</summary>`,
    '',
    ...listed,
    ...(notListedCount > 0 ? [`- ...and ${notListedCount} more`] : []),
    '',
    '</details>'
  ]
}

/**
 * A Markdown table with every column padded to the same width, so that it reads as a table in the
 * terminal too. Columns after the first are numbers, aligned to the right
 */
const formatTable = (header: string[], rows: string[][]) => {
  const widths = header.map((title, column) =>
    Math.max(title.length, 3, ...rows.map((row) => row[column]!.length))
  )
  const formatRow = (cells: string[]) =>
    `| ${cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)
      )
      .join(' | ')} |`
  const separator = `| ${widths
    .map((width, column) => (column === 0 ? '-'.repeat(width) : `${'-'.repeat(width - 1)}:`))
    .join(' | ')} |`

  return [formatRow(header), separator, ...rows.map(formatRow)]
}

const getSummary = ({
  calldataChanges,
  eip712Changes,
  descriptorChanges,
  source,
  previousCommit,
  notes,
  replacedDescriptors,
  format
}: {
  calldataChanges: Changes
  eip712Changes: Changes
  descriptorChanges: Changes
  source: Source
  previousCommit?: string
  notes: string[]
  replacedDescriptors: string[]
  format: SummaryFormat
}) => {
  const toRow = (label: string, { added, removed, changed }: Changes) => [
    label,
    `${added.length}`,
    `${removed.length}`,
    `${changed.length}`
  ]
  const compareLink =
    previousCommit && previousCommit !== source.commit
      ? `${REGISTRY_REPOSITORY_URL}/compare/${previousCommit}...${source.commit}`
      : `${REGISTRY_REPOSITORY_URL}/tree/${source.commit}`

  return [
    format === 'markdown'
      ? `The ERC-7730 registry at [${source.commit.slice(0, 7)}](${compareLink}) (${source.date}).`
      : `The ERC-7730 registry at ${source.commit.slice(0, 7)} (${source.date}): ${compareLink}`,
    '',
    ...formatTable(
      ['', 'Added', 'Removed', 'Changed'],
      [
        toRow('Contracts (calldata index)', calldataChanges),
        toRow('Typed messages (EIP-712 index)', eip712Changes),
        toRow('Descriptor files', descriptorChanges)
      ]
    ),
    ...formatList('Added descriptors', descriptorChanges.added, format),
    ...formatList('Changed descriptors', descriptorChanges.changed, format),
    ...formatList('Removed descriptors', descriptorChanges.removed, format),
    ...formatList(
      "Replaced by Ambire's amended copy (`ambire-change/...`)",
      replacedDescriptors,
      format
    ),
    ...formatList("Ambire's changes", notes, format, { asCode: false }),
    ...(calldataChanges.removed.length || eip712Changes.removed.length
      ? [
          '',
          'Transactions and messages of removed contracts are no longer described with ERC-7730.'
        ]
      : [])
  ].join('\n')
}

const run = async () => {
  const registryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'erc7730-registry-'))

  try {
    const [ownDescriptors, previous] = await Promise.all([
      readOwnDescriptors(),
      readPreviousRegistry()
    ])
    const { source: upstreamSource, files } = cloneRegistry(registryDirectory)
    const {
      registry: { calldataIndex, eip712Index, descriptors },
      notes
    } = applyAmendments(buildRegistry(files), amendments, ownDescriptors)

    const calldataChanges = getChanges(previous?.calldataIndex, calldataIndex)
    const eip712Changes = getChanges(previous?.eip712Index, eip712Index)
    const allDescriptorChanges = getChanges(previous?.descriptors, descriptors)
    // A registry descriptor Ambire amended is only in its `ambire-change/` copy now: listed as replaced,
    // not as removed
    const replacedDescriptors = allDescriptorChanges.removed.filter((name) =>
      Object.prototype.hasOwnProperty.call(
        descriptors,
        `${ERC7730_AMBIRE_CHANGE_PATH_PREFIX}${name}`
      )
    )
    const descriptorChanges = {
      ...allDescriptorChanges,
      removed: allDescriptorChanges.removed.filter((name) => !replacedDescriptors.includes(name))
    }
    assertNotTooManyRemoved(calldataChanges, 'contracts of the calldata index')
    assertNotTooManyRemoved(eip712Changes, 'contracts of the EIP-712 index')

    const hasRegistryChanged = [calldataChanges, eip712Changes, descriptorChanges].some(
      ({ added, removed, changed }) => added.length || removed.length || changed.length
    )
    // Kept when nothing changed, so the file doesn't change just because of an unrelated commit
    const source = hasRegistryChanged || !previous?.source?.date ? upstreamSource : previous.source
    const serialized = serializeRegistry({ source, calldataIndex, eip712Index, descriptors })
    assertSize(serialized)

    await fsPromises.writeFile(outputPath, serialized, 'utf8')

    const summaryInput = {
      calldataChanges,
      eip712Changes,
      descriptorChanges,
      source,
      previousCommit: previous?.source?.commit,
      notes,
      replacedDescriptors
    }
    if (process.env.ERC7730_REGISTRY_SUMMARY_PATH) {
      await fsPromises.writeFile(
        process.env.ERC7730_REGISTRY_SUMMARY_PATH,
        `${getSummary({ ...summaryInput, format: 'markdown' })}\n`,
        'utf8'
      )
    }

    console.log(getSummary({ ...summaryInput, format: 'terminal' }))
  } finally {
    await fsPromises.rm(registryDirectory, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error('Failed to update the ERC-7730 registry:', error.message ?? error)
  process.exitCode = 1
})
