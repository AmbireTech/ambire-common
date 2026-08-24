import { AbiCoder, Contract, Interface, keccak256, parseUnits } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { BindedRelayerCall } from '../relayerCall/relayerCall'

export const WALLET_STAKING_PENDING_WITHDRAWALS_CACHE_TTL = 60 * 1000

export interface PendingWalletWithdrawal {
  shares: bigint
  unlocksAt: bigint
  maxTokens: bigint
}

export interface WalletStakingRelayerLog {
  topics: string[]
  data: string
}

interface WalletStakingRelayerLogsResponse {
  success: true
  data: {
    logs: WalletStakingRelayerLog[]
  }
}

interface CachedPendingWalletWithdrawal {
  shares: string
  unlocksAt: string
  maxTokens: string
}

export interface WalletStakingPendingWithdrawalsResult {
  latestWithdrawal: PendingWalletWithdrawal | null
  totalShares: bigint
  updatedAt: number
}

export type WalletStakingPendingWithdrawalsCacheResult = WalletStakingPendingWithdrawalsResult & {
  refreshError?: Error
}

interface WalletStakingPendingWithdrawalsCacheEntry {
  cachedResult?: WalletStakingPendingWithdrawalsResult
  cachedError?: Error
  expiresAt: number
  refreshPromise?: Promise<WalletStakingPendingWithdrawalsCacheResult>
}

export const walletStakingInterface = new Interface([
  'function commitments(bytes32) view returns (uint256)',
  'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)',
  'event LogLeave(address indexed owner, uint256 shares, uint256 unlocksAt, uint256 maxTokens)'
])

export const LOG_LEAVE_TOPIC = walletStakingInterface.getEvent('LogLeave')!.topicHash
export const X_WALLET_PENDING_WITHDRAWAL_THRESHOLD = parseUnits('0.01', 18)

const normalizeError = (error: unknown) =>
  error instanceof Error ? error : new Error('Unable to load pending WALLET withdrawals.')

/** Uses the lock-time flow only when xWALLET can back every active commitment. */
export const shouldUsePendingWalletWithdrawalMode = (
  pendingWithdrawal: PendingWalletWithdrawal | null,
  xWalletBalance: bigint,
  totalPendingShares: bigint
) =>
  !!pendingWithdrawal &&
  xWalletBalance >= X_WALLET_PENDING_WITHDRAWAL_THRESHOLD &&
  xWalletBalance >= totalPendingShares

/** Selects the latest active withdrawal and totals all shares needed to back active commitments. */
export const getPendingWalletWithdrawalSummary = (pendingWithdrawals: PendingWalletWithdrawal[]) =>
  pendingWithdrawals.reduce<{
    latestWithdrawal: PendingWalletWithdrawal | null
    totalShares: bigint
  }>(
    (summary, withdrawal) => ({
      latestWithdrawal:
        !summary.latestWithdrawal || withdrawal.unlocksAt > summary.latestWithdrawal.unlocksAt
          ? withdrawal
          : summary.latestWithdrawal,
      totalShares: summary.totalShares + withdrawal.shares
    }),
    { latestWithdrawal: null, totalShares: 0n }
  )

/** Validates and extracts raw WALLET staking logs returned by the relayer. */
export const parseWalletStakingRelayerLogsResponse = (
  value: unknown
): WalletStakingRelayerLog[] => {
  if (!value || typeof value !== 'object') throw new Error('The relayer returned invalid data.')

  const response = value as Partial<WalletStakingRelayerLogsResponse> & { message?: unknown }
  if (response.success !== true) {
    throw new Error(
      typeof response.message === 'string'
        ? response.message
        : 'The relayer could not load pending withdrawals.'
    )
  }

  const logs = response.data?.logs
  if (
    !Array.isArray(logs) ||
    logs.some(
      (log) =>
        !log ||
        typeof log !== 'object' ||
        !Array.isArray(log.topics) ||
        log.topics.some((topic) => typeof topic !== 'string') ||
        typeof log.data !== 'string'
    )
  ) {
    throw new Error('The relayer returned invalid pending withdrawal data.')
  }

  return logs
}

/** Returns an account-specific key for the persisted pending withdrawal cache. */
export const getPendingWalletWithdrawalStorageKey = (accountAddr: string) =>
  `walletStakingPendingWithdrawal:${accountAddr.toLowerCase()}`

/** Converts a persisted pending withdrawal into its runtime bigint representation. */
export const parseCachedPendingWalletWithdrawal = (
  value: unknown
): PendingWalletWithdrawal | null => {
  if (!value || typeof value !== 'object') return null

  const { shares, unlocksAt, maxTokens } = value as Partial<CachedPendingWalletWithdrawal>
  if (
    typeof shares !== 'string' ||
    typeof unlocksAt !== 'string' ||
    typeof maxTokens !== 'string'
  ) {
    return null
  }

  try {
    const pendingWithdrawal = {
      shares: BigInt(shares),
      unlocksAt: BigInt(unlocksAt),
      maxTokens: BigInt(maxTokens)
    }

    if (
      pendingWithdrawal.shares <= 0n ||
      pendingWithdrawal.unlocksAt <= 0n ||
      pendingWithdrawal.maxTokens <= 0n
    ) {
      return null
    }

    return pendingWithdrawal
  } catch {
    return null
  }
}

/** Converts a pending withdrawal into a storage-safe representation. */
export const serializePendingWalletWithdrawal = (
  pendingWithdrawal: PendingWalletWithdrawal
): CachedPendingWalletWithdrawal => ({
  shares: pendingWithdrawal.shares.toString(),
  unlocksAt: pendingWithdrawal.unlocksAt.toString(),
  maxTokens: pendingWithdrawal.maxTokens.toString()
})

/** Decodes WALLET staking leave events owned by the selected account. */
export const decodePendingWalletWithdrawals = (
  logs: WalletStakingRelayerLog[],
  accountAddr: string
): PendingWalletWithdrawal[] =>
  logs.flatMap(({ topics, data }) => {
    if (topics[0]?.toLowerCase() !== LOG_LEAVE_TOPIC.toLowerCase()) return []

    const { owner, shares, unlocksAt, maxTokens } = walletStakingInterface.decodeEventLog(
      'LogLeave',
      data,
      topics
    )
    if (String(owner).toLowerCase() !== accountAddr.toLowerCase()) return []

    return [
      {
        shares: BigInt(shares),
        unlocksAt: BigInt(unlocksAt),
        maxTokens: BigInt(maxTokens)
      }
    ]
  })

/** Calculates the commitment key stored by the WALLET staking contract. */
export const getPendingWalletWithdrawalCommitmentId = (
  accountAddr: string,
  pendingWithdrawal: PendingWalletWithdrawal
) =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'uint256'],
      [accountAddr, pendingWithdrawal.shares, pendingWithdrawal.unlocksAt]
    )
  )

/** Formats a future unlock timestamp as a compact day, hour and minute countdown. */
export const formatPendingWalletWithdrawalDuration = (
  unlocksAt: bigint,
  nowMs: number = Date.now()
) => {
  const remainingMinutes = Math.max(0, Math.ceil((Number(unlocksAt) * 1000 - nowMs) / 60_000))
  const days = Math.floor(remainingMinutes / 1440)
  const hours = Math.floor((remainingMinutes % 1440) / 60)
  const minutes = remainingMinutes % 60

  return `${days}d ${hours}h ${minutes}m`
}

/** The contract only permits withdrawal after, rather than exactly at, unlocksAt. */
export const isPendingWalletWithdrawalReady = (unlocksAt: bigint, nowMs: number = Date.now()) =>
  BigInt(Math.floor(nowMs / 1000)) > unlocksAt

/**
 * Shares active WALLET withdrawal commitments between portfolio updates and UI requests.
 * Results are scoped by account and concurrent refreshes for the same account are deduplicated.
 */
export class WalletStakingPendingWithdrawalsCache {
  #entries = new Map<string, WalletStakingPendingWithdrawalsCacheEntry>()

  async get({
    accountAddr,
    provider,
    callRelayer,
    knownWithdrawal
  }: {
    accountAddr: string
    provider: RPCProvider
    callRelayer: BindedRelayerCall
    knownWithdrawal?: PendingWalletWithdrawal | null
  }): Promise<WalletStakingPendingWithdrawalsCacheResult> {
    const cacheKey = accountAddr.toLowerCase()
    const entry = this.#entries.get(cacheKey) || { expiresAt: 0 }
    this.#entries.set(cacheKey, entry)

    const cachedLatestWithdrawal = entry.cachedResult?.latestWithdrawal
    const hasKnownWithdrawalCached =
      !knownWithdrawal ||
      (cachedLatestWithdrawal?.shares === knownWithdrawal.shares &&
        cachedLatestWithdrawal.unlocksAt === knownWithdrawal.unlocksAt)

    if (Date.now() < entry.expiresAt && hasKnownWithdrawalCached) {
      if (entry.cachedResult) {
        return entry.cachedError
          ? { ...entry.cachedResult, refreshError: entry.cachedError }
          : entry.cachedResult
      }
      throw entry.cachedError || new Error('Unable to load pending WALLET withdrawals.')
    }

    if (entry.refreshPromise) return entry.refreshPromise

    const refreshPromise = this.#refresh(accountAddr, provider, callRelayer, entry, knownWithdrawal)
    entry.refreshPromise = refreshPromise

    try {
      return await refreshPromise
    } finally {
      if (entry.refreshPromise === refreshPromise) entry.refreshPromise = undefined
    }
  }

  invalidate(accountAddr: string) {
    this.#entries.delete(accountAddr.toLowerCase())
  }

  async #refresh(
    accountAddr: string,
    provider: RPCProvider,
    callRelayer: BindedRelayerCall,
    entry: WalletStakingPendingWithdrawalsCacheEntry,
    knownWithdrawal?: PendingWalletWithdrawal | null
  ): Promise<WalletStakingPendingWithdrawalsCacheResult> {
    try {
      const response = await callRelayer(
        '/v2/identity/logs',
        'POST',
        {
          identity: accountAddr,
          address: WALLET_STAKING_ADDR,
          requestedTopic: LOG_LEAVE_TOPIC
        },
        undefined,
        5000
      )
      const decodedWithdrawals = decodePendingWalletWithdrawals(
        parseWalletStakingRelayerLogsResponse(response),
        accountAddr
      )
      const withdrawalsById = new Map<string, PendingWalletWithdrawal>()
      if (knownWithdrawal) {
        withdrawalsById.set(
          `${knownWithdrawal.shares}:${knownWithdrawal.unlocksAt}`,
          knownWithdrawal
        )
      }
      decodedWithdrawals.forEach((withdrawal) => {
        withdrawalsById.set(`${withdrawal.shares}:${withdrawal.unlocksAt}`, withdrawal)
      })

      const contract = new Contract(WALLET_STAKING_ADDR, walletStakingInterface, provider)
      const getCommitment = contract.commitments
      if (typeof getCommitment !== 'function') {
        throw new Error('Pending WALLET withdrawals are unavailable.')
      }

      const activeWithdrawals = (
        await Promise.all(
          Array.from(withdrawalsById.values()).map(async (withdrawal) => {
            const commitmentId = getPendingWalletWithdrawalCommitmentId(accountAddr, withdrawal)
            const maxTokens = BigInt(await getCommitment(commitmentId))
            return maxTokens > 0n ? { ...withdrawal, maxTokens } : null
          })
        )
      ).filter((withdrawal): withdrawal is PendingWalletWithdrawal => !!withdrawal)
      const { latestWithdrawal, totalShares } = getPendingWalletWithdrawalSummary(activeWithdrawals)
      const updatedAt = Date.now()
      const result = { latestWithdrawal, totalShares, updatedAt }

      entry.cachedResult = result
      entry.cachedError = undefined
      entry.expiresAt = updatedAt + WALLET_STAKING_PENDING_WITHDRAWALS_CACHE_TTL

      return result
    } catch (error) {
      const refreshError = normalizeError(error)
      entry.cachedError = refreshError
      entry.expiresAt = Date.now() + WALLET_STAKING_PENDING_WITHDRAWALS_CACHE_TTL

      if (entry.cachedResult) return { ...entry.cachedResult, refreshError }
      throw refreshError
    }
  }
}

export const walletStakingPendingWithdrawalsCache = new WalletStakingPendingWithdrawalsCache()
