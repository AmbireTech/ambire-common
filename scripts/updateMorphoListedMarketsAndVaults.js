const fsPromises = require('fs').promises
const path = require('path')
const { isAddress, isHexString } = require('ethers')

// Regenerates the markets and vaults Morpho lists in its app, which are the ones checked for
// Morpho positions on-chain when the user has turned off auto discovery (see
// `src/libs/defiPositions/rpc/morpho/morpho.ts`). Morpho lists new markets every day, so run
// this before each release. It is NOT called at runtime, as the users who turned off auto
// discovery opted out of calls to third-party APIs.

const MORPHO_API_URL = 'https://api.morpho.org/graphql'
const PAGE_SIZE = 500

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

const QUERIES = {
  markets: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    markets(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
      items { marketId chain { id } loanAsset { symbol } collateralAsset { symbol } }
      pageInfo { countTotal }
    }
  }`,
  vaults: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    vaults(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
      items { address name chain { id } }
      pageInfo { countTotal }
    }
  }`,
  vaultV2s: `query ($skip: Int!, $first: Int!, $chainIds: [Int!]) {
    vaultV2s(first: $first, skip: $skip, where: { chainId_in: $chainIds, listed: true }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
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

const groupByChainId = (entries) =>
  entries.reduce(
    (byChainId, { chainId, ...entry }) => {
      byChainId[chainId].push(entry)
      return byChainId
    },
    Object.fromEntries(CHAIN_IDS.map((chainId) => [chainId, []]))
  )

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

const run = async () => {
  const [markets, vaults, vaultV2s] = await Promise.all([
    fetchAll('markets'),
    fetchAll('vaults'),
    fetchAll('vaultV2s')
  ])

  const listed = {
    updatedAt: new Date().toISOString().slice(0, 10),
    source: `${MORPHO_API_URL} (markets, vaults and vaultV2s with listed: true)`,
    markets: groupByChainId(markets.map(toMarketEntry)),
    vaults: groupByChainId([...vaults, ...vaultV2s].map(toVaultEntry))
  }

  await fsPromises.writeFile(outputPath, `${JSON.stringify(listed, null, 2)}\n`, 'utf8')

  console.log(
    `Saved ${markets.length} markets and ${vaults.length + vaultV2s.length} vaults listed by Morpho to ${outputPath}`
  )
}

run().catch((error) => {
  console.error('Failed to update the markets and vaults listed by Morpho:', error)
  process.exitCode = 1
})
