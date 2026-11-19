const fsPromises = require('fs').promises
const path = require('path')
const { isAddress, isHexString } = require('ethers')

// Regenerates the markets and vaults Morpho lists in its app, which are the ones checked for
// Morpho positions on-chain when the user has turned off auto discovery (see
// `src/libs/defiPositions/rpc/morpho/morpho.ts`). Morpho lists new markets every day, so a
// weekly workflow runs this and opens a PR with the changes
// (`.github/workflows/update-morpho-listed.yml`). It is NOT called at runtime, as the users
// who turned off auto discovery opted out of calls to third-party APIs.
//
// The file only changes when the lists do: the entries are sorted by their id or address, and
// `updatedAt` is kept when nothing was added, removed or renamed.
//
// Set `MORPHO_LISTED_SUMMARY_PATH` to also write a summary of the changes in Markdown there.

const MORPHO_API_URL = 'https://api.morpho.org/graphql'
const PAGE_SIZE = 500

/**
 * The share of a network's markets or vaults that can disappear from the list in one update.
 * More likely means that Morpho's API returned partial data, and saving it would stop
 * checking markets in which users still have positions
 */
const MAX_REMOVED_SHARE = 0.2

/**
 * Removing up to this many entries is always allowed, as on networks with few of them a single
 * delisting is already more than `MAX_REMOVED_SHARE`
 */
const ALWAYS_ALLOWED_REMOVED_COUNT = 5

// Must match the networks in `src/libs/defiPositions/rpc/morpho/addresses.ts`
const CHAIN_IDS = [1, 8453, 42161, 10, 137]

const outputPath = path.join(
  __dirname,
  '..',
  'src',
  'libs',
  'defiPositions',
  'rpc',
  'morpho',
  'listed.json'
)

// Sorted by a key that doesn't change, so that no item moves between pages while they are
// fetched, which would skip or repeat it
const QUERIES = {
  markets: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    markets(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: UniqueKey, orderDirection: Asc) {
      items { marketId chain { id } loanAsset { symbol } collateralAsset { symbol } }
      pageInfo { countTotal }
    }
  }`,
  vaults: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    vaults(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: Address, orderDirection: Asc) {
      items { address name chain { id } }
      pageInfo { countTotal }
    }
  }`,
  vaultV2s: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    vaultV2s(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: Address, orderDirection: Asc) {
      items { address name chain { id } }
      pageInfo { countTotal }
    }
  }`
}

const fetchPage = async (field, skip) => {
  const response = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: QUERIES[field],
      variables: { skip, first: PAGE_SIZE, chainIds: CHAIN_IDS }
    })
  })
  if (!response.ok) throw new Error(`Failed to fetch ${field}. Status: ${response.statusText}`)

  const body = await response.json()
  if (body.errors?.length) throw new Error(`Failed to fetch ${field}: ${body.errors[0].message}`)

  return body.data[field]
}

/** Fetches every page of a listing, as the API returns at most PAGE_SIZE items at once */
const fetchAll = async (field) => {
  const items = []
  let countTotal = Infinity

  while (items.length < countTotal) {
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage(field, items.length)
    countTotal = page.pageInfo.countTotal
    if (!page.items.length) break

    items.push(...page.items)
  }

  return items
}

/**
 * Groups the entries by chain id, without duplicates (by `key`), sorted by `key` so that
 * the file only changes when entries are added, removed or renamed
 */
const groupByChainId = (entries, key) => {
  const byChainId = Object.fromEntries(CHAIN_IDS.map((chainId) => [chainId, new Map()]))

  entries.forEach(({ chainId, ...entry }) => {
    byChainId[chainId].set(entry[key].toLowerCase(), entry)
  })

  return Object.fromEntries(
    Object.entries(byChainId).map(([chainId, entriesByKey]) => [
      chainId,
      [...entriesByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry)
    ])
  )
}

const getMarketName = ({ collateralAsset, loanAsset }) => {
  if (!collateralAsset?.symbol || !loanAsset?.symbol) return loanAsset?.symbol || ''

  return `${collateralAsset.symbol} / ${loanAsset.symbol}`
}

const toMarketEntry = (market) => {
  if (!isHexString(market.marketId, 32)) throw new Error(`Invalid market id: ${market.marketId}`)

  return {
    chainId: market.chain.id,
    id: market.marketId.toLowerCase(),
    name: getMarketName(market)
  }
}

const toVaultEntry = (vault) => {
  if (!isAddress(vault.address)) throw new Error(`Invalid vault address: ${vault.address}`)

  return { chainId: vault.chain.id, address: vault.address, name: vault.name || '' }
}

const readPreviousListed = async () => {
  try {
    return JSON.parse(await fsPromises.readFile(outputPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

const getNamesByKey = (entries, key) =>
  new Map((entries || []).map((entry) => [entry[key].toLowerCase(), entry.name]))

/**
 * The keys of the entries added, removed and renamed on each network, compared with the
 * previous list
 */
const getChanges = (previousByChainId = {}, nextByChainId, key) =>
  CHAIN_IDS.map((chainId) => {
    const previousNames = getNamesByKey(previousByChainId[chainId], key)
    const nextNames = getNamesByKey(nextByChainId[chainId], key)
    const nextKeys = [...nextNames.keys()]

    return {
      chainId,
      previousCount: previousNames.size,
      nextCount: nextNames.size,
      added: nextKeys.filter((k) => !previousNames.has(k)),
      removed: [...previousNames.keys()].filter((k) => !nextNames.has(k)),
      renamed: nextKeys.filter(
        (k) => previousNames.has(k) && previousNames.get(k) !== nextNames.get(k)
      )
    }
  })

/**
 * Throws if too much of a network's list disappeared (or all of it), which likely means
 * partial API data
 */
const assertNotTooManyRemoved = (changes, label) => {
  changes.forEach(({ chainId, previousCount, nextCount, removed }) => {
    const isListGone = previousCount > 0 && nextCount === 0
    const isTooMuchRemoved =
      removed.length > ALWAYS_ALLOWED_REMOVED_COUNT &&
      removed.length / previousCount > MAX_REMOVED_SHARE
    if (!isListGone && !isTooMuchRemoved) return

    throw new Error(
      `${removed.length} of the ${previousCount} ${label} on chain ${chainId} are no longer listed. Check Morpho's API before updating the list`
    )
  })
}

const getSummary = (marketChanges, vaultChanges, previousUpdatedAt) => {
  const formatChanges = ({ added, removed, renamed }) =>
    `+${added.length} / -${removed.length}${renamed.length ? ` (${renamed.length} renamed)` : ''}`
  const rows = CHAIN_IDS.map(
    (chainId, i) =>
      `| ${chainId} | ${formatChanges(marketChanges[i])} | ${formatChanges(vaultChanges[i])} |`
  )

  return [
    `Markets and vaults listed by Morpho, compared with the list from ${previousUpdatedAt || 'never'}.`,
    '',
    '| Chain | Markets | Vaults |',
    '|---|---|---|',
    ...rows,
    '',
    'Removed markets and vaults are no longer checked for positions while auto discovery is off.'
  ].join('\n')
}

const run = async () => {
  const [markets, vaults, vaultV2s, previous] = await Promise.all([
    fetchAll('markets'),
    fetchAll('vaults'),
    fetchAll('vaultV2s'),
    readPreviousListed()
  ])

  const nextMarkets = groupByChainId(markets.map(toMarketEntry), 'id')
  const nextVaults = groupByChainId([...vaults, ...vaultV2s].map(toVaultEntry), 'address')
  const marketChanges = getChanges(previous?.markets, nextMarkets, 'id')
  const vaultChanges = getChanges(previous?.vaults, nextVaults, 'address')
  assertNotTooManyRemoved(marketChanges, 'markets')
  assertNotTooManyRemoved(vaultChanges, 'vaults')

  const hasListChanged = [...marketChanges, ...vaultChanges].some(
    ({ added, removed, renamed }) => added.length || removed.length || renamed.length
  )
  const listed = {
    // Kept when nothing was added, removed or renamed, so the file doesn't change just because of the date
    updatedAt:
      hasListChanged || !previous?.updatedAt
        ? new Date().toISOString().slice(0, 10)
        : previous.updatedAt,
    source: `${MORPHO_API_URL} (markets, vaults and vaultV2s with listed: true)`,
    markets: nextMarkets,
    vaults: nextVaults
  }

  await fsPromises.writeFile(outputPath, `${JSON.stringify(listed, null, 2)}\n`, 'utf8')

  const summary = getSummary(marketChanges, vaultChanges, previous?.updatedAt)
  if (process.env.MORPHO_LISTED_SUMMARY_PATH) {
    await fsPromises.writeFile(process.env.MORPHO_LISTED_SUMMARY_PATH, `${summary}\n`, 'utf8')
  }

  console.log(summary)
}

run().catch((error) => {
  console.error('Failed to update the markets and vaults listed by Morpho:', error)
  process.exitCode = 1
})
