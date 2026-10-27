import { isError } from 'ethers'
import {
  decodeFunctionResult,
  encodeFunctionData,
  Hex,
  namehash,
  parseAbi,
  zeroAddress
} from 'viem'
import { normalize } from 'viem/ens'

import { RPCProvider } from '../../interfaces/provider'

/** ENS registry (with fallback to the pre-2020 one), the same address on mainnet since its deployment. */
export const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
/** The block the ENS registry was deployed at - there is no record to look for before it. */
export const ENS_REGISTRY_DEPLOYMENT_BLOCK = 9380380

/**
 * Gateways that serve the website an ENS name points to under `<name>.<gateway suffix>`,
 * e.g. `tornadocash.eth.limo` serves the content `tornadocash.eth` points to.
 */
const ENS_WEBSITE_GATEWAY_SUFFIXES = ['.limo', '.link']

/**
 * The first byte(s) of an ENSIP-7 contenthash identify where the content lives. Only IPFS content
 * is immutable - the contenthash itself is the fingerprint of the files. Other kinds (like IPNS)
 * point to a pointer the owner can change without leaving a record on-chain.
 */
const IPFS_CONTENTHASH_PREFIX = '0xe3'

/**
 * The search stops once it narrows the change down to this many blocks (~6 minutes), which is
 * far more precise than the "x days ago" the user sees.
 */
const SEARCH_PRECISION_IN_BLOCKS = 32
/** How many blocks get checked in parallel in each step of the search. */
const SEARCH_POINTS_PER_STEP = 7

const ensAbi = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function contenthash(bytes32 node) view returns (bytes)'
])

const EMPTY_CONTENTHASH = '0x'

/**
 * Returns the ENS name a website is served from when it's opened through an ENS gateway
 * (`tornadocash.eth.limo` -> `tornadocash.eth`), or null for any other website.
 */
export const getEnsNameFromGatewayUrl = (url: string): string | null => {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  const gatewaySuffix = ENS_WEBSITE_GATEWAY_SUFFIXES.find((suffix) =>
    hostname.endsWith(`.eth${suffix}`)
  )
  if (!gatewaySuffix) return null

  const ensName = hostname.slice(0, -gatewaySuffix.length)
  // Excludes the bare gateway domain (`eth.limo`) which serves no ENS name
  if (!ensName.includes('.') || ensName.startsWith('.')) return null

  try {
    return normalize(ensName)
  } catch {
    return null
  }
}

const callAtBlock = async (
  provider: RPCProvider,
  to: string,
  data: Hex,
  blockNumber: number
): Promise<Hex | null> => {
  try {
    return (await provider.call({ to, data, blockTag: blockNumber })) as Hex
  } catch (e) {
    // A revert means the record does not exist there - e.g. an old resolver without contenthash
    // support. Anything else (network, rate limits) must fail the search instead of being taken
    // for a change, or the user would be shown a wrong date.
    if (isError(e, 'CALL_EXCEPTION')) return null
    throw e
  }
}

/** Reads the contenthash `node` pointed to at `blockNumber`, `0x` if it had none. */
const getContenthashAtBlock = async (
  provider: RPCProvider,
  node: Hex,
  blockNumber: number
): Promise<Hex> => {
  // The resolver is read at the same block too, as the owner may have switched resolvers
  const resolverResult = await callAtBlock(
    provider,
    ENS_REGISTRY,
    encodeFunctionData({ abi: ensAbi, functionName: 'resolver', args: [node] }),
    blockNumber
  )
  if (!resolverResult || resolverResult === EMPTY_CONTENTHASH) return EMPTY_CONTENTHASH

  const resolver = decodeFunctionResult({
    abi: ensAbi,
    functionName: 'resolver',
    data: resolverResult
  })
  if (resolver === zeroAddress) return EMPTY_CONTENTHASH

  const contenthashResult = await callAtBlock(
    provider,
    resolver,
    encodeFunctionData({ abi: ensAbi, functionName: 'contenthash', args: [node] }),
    blockNumber
  )
  if (!contenthashResult || contenthashResult === EMPTY_CONTENTHASH) return EMPTY_CONTENTHASH

  return decodeFunctionResult({
    abi: ensAbi,
    functionName: 'contenthash',
    data: contenthashResult
  }).toLowerCase() as Hex
}

/**
 * Checks `blocks` (sorted from newest to oldest) and returns the newest one where the contenthash
 * differs from `currentContenthash` (`changedBlock`, null if none does), along with the oldest
 * checked block that still has the current one (`unchangedBlock`). The change happened between them.
 */
const findFirstChangedBlock = async (
  provider: RPCProvider,
  node: Hex,
  currentContenthash: Hex,
  blocks: number[],
  initialUnchangedBlock: number
) => {
  const contenthashes = await Promise.all(
    blocks.map((block) => getContenthashAtBlock(provider, node, block))
  )

  let unchangedBlock = initialUnchangedBlock
  for (let i = 0; i < blocks.length; i++) {
    if (contenthashes[i] !== currentContenthash) {
      return { changedBlock: blocks[i]!, unchangedBlock }
    }
    unchangedBlock = blocks[i]!
  }

  return { changedBlock: null, unchangedBlock }
}

/**
 * Returns the block numbers `latestBlock - 1`, `latestBlock - 2`, `latestBlock - 4`, ... down to
 * `oldestBlock`. Checking them first finds recent changes in few steps.
 */
const getExponentiallyOlderBlocks = (latestBlock: number, oldestBlock: number) => {
  const blocks: number[] = []
  for (let distance = 1; latestBlock - distance > oldestBlock; distance *= 2) {
    blocks.push(latestBlock - distance)
  }
  blocks.push(oldestBlock)
  return blocks
}

/** Returns evenly spread blocks between `olderBlock` and `newerBlock` (exclusive), newest first. */
const getBlocksBetween = (olderBlock: number, newerBlock: number) => {
  const step = Math.max(1, Math.floor((newerBlock - olderBlock) / (SEARCH_POINTS_PER_STEP + 1)))
  const blocks: number[] = []
  for (let block = newerBlock - step; block > olderBlock; block -= step) {
    blocks.push(block)
    if (blocks.length === SEARCH_POINTS_PER_STEP) break
  }
  return blocks
}

export type EnsWebsiteContentUpdate = {
  /** When the ENS name started pointing to the content it serves now, in ms. */
  updatedAt: number
  /** The content the ENS name points to. */
  contenthash: Hex
  /** The latest block the ENS name was confirmed to still point to `contenthash` at. */
  checkedAtBlock: number
}

/** Thrown when the search is stopped through its abort signal (e.g. it took too long). */
export class EnsWebsiteContentUpdateAbortedError extends Error {
  constructor() {
    super('The search for when the ENS website was last updated was stopped')
    this.name = 'EnsWebsiteContentUpdateAbortedError'
  }
}

const throwIfAborted = (signal?: AbortSignal | null) => {
  if (signal?.aborted) throw new EnsWebsiteContentUpdateAbortedError()
}

/**
 * Finds when the website served from an ENS name (over IPFS) was last replaced, which happens
 * when the owner points the name to new content. Works with any resolver, because it reads
 * the record's past values (requires an archive mainnet RPC) instead of relying on events.
 *
 * Starts from the latest block and checks exponentially older ones until the content differs,
 * then narrows down the exact moment between the last two checks.
 *
 * Only the checked blocks are compared, so a switch to other content and back that happens entirely
 * between two of them is not noticed.
 *
 * Pass the result of a previous search for the same name as `previousUpdate` to only check the
 * blocks after it, as long as the name still points to the same content.
 *
 * `signal` stops the search before its next step, rejecting with `EnsWebsiteContentUpdateAbortedError`.
 *
 * Returns null when the name doesn't point to IPFS content (no content, or a kind that can change
 * without an on-chain record, like IPNS - a date would mislead the user there).
 */
export async function getEnsWebsiteContentUpdate(
  provider: RPCProvider,
  ensName: string,
  {
    previousUpdate,
    signal
  }: { previousUpdate?: EnsWebsiteContentUpdate | null; signal?: AbortSignal | null } = {}
): Promise<EnsWebsiteContentUpdate | null> {
  const node = namehash(normalize(ensName))
  const latestBlock = await provider.getBlockNumber()
  throwIfAborted(signal)
  const currentContenthash = await getContenthashAtBlock(provider, node, latestBlock)
  throwIfAborted(signal)

  if (!currentContenthash.startsWith(IPFS_CONTENTHASH_PREFIX)) return null

  const reusablePreviousUpdate =
    previousUpdate?.contenthash === currentContenthash ? previousUpdate : null
  // Min, in case the RPC answering now is a few blocks behind the one that answered the last time
  const oldestBlockToCheck = reusablePreviousUpdate
    ? Math.min(reusablePreviousUpdate.checkedAtBlock, latestBlock)
    : ENS_REGISTRY_DEPLOYMENT_BLOCK

  let { changedBlock, unchangedBlock } = await findFirstChangedBlock(
    provider,
    node,
    currentContenthash,
    getExponentiallyOlderBlocks(latestBlock, oldestBlockToCheck),
    latestBlock
  )
  throwIfAborted(signal)

  if (changedBlock === null) {
    // Nothing changed since the previous search, so its date is still the right one
    if (reusablePreviousUpdate) return { ...reusablePreviousUpdate, checkedAtBlock: latestBlock }
    // The name has pointed to this content since before the registry migration
    changedBlock = ENS_REGISTRY_DEPLOYMENT_BLOCK
  }

  while (unchangedBlock - changedBlock > SEARCH_PRECISION_IN_BLOCKS) {
    const step = await findFirstChangedBlock(
      provider,
      node,
      currentContenthash,
      getBlocksBetween(changedBlock, unchangedBlock),
      unchangedBlock
    )
    // When none of the checked blocks differ, the change is between the oldest one and `changedBlock`
    unchangedBlock = step.unchangedBlock
    if (step.changedBlock !== null) changedBlock = step.changedBlock
    throwIfAborted(signal)
  }

  const block = await provider.getBlock(unchangedBlock)
  if (!block) throw new Error(`Block ${unchangedBlock} not found`)

  return {
    updatedAt: block.timestamp * 1000,
    contenthash: currentContenthash,
    checkedAtBlock: latestBlock
  }
}
