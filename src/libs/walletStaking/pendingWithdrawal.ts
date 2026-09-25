import { AbiCoder, Interface, keccak256 } from 'ethers'

export const WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS = 6000

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

export const walletStakingInterface = new Interface([
  'function commitments(bytes32) view returns (uint256)',
  'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)',
  'event LogLeave(address indexed owner, uint256 shares, uint256 unlocksAt, uint256 maxTokens)'
])

export const LOG_LEAVE_TOPIC = walletStakingInterface.getEvent('LogLeave')!.topicHash

/** Uses the lock-time flow only when xWALLET can back every active commitment. */
export const shouldUsePendingWalletWithdrawalMode = (
  pendingWithdrawal: PendingWalletWithdrawal | null,
  xWalletBalance: bigint,
  totalPendingShares: bigint
) => !!pendingWithdrawal && xWalletBalance >= totalPendingShares

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

/** Keeps active withdrawals whose commitment checks succeed and returns failures separately. */
export const getActivePendingWalletWithdrawals = async (
  pendingWithdrawals: PendingWalletWithdrawal[],
  getCommitmentMaxTokens: (withdrawal: PendingWalletWithdrawal) => Promise<bigint>
) => {
  const results = await Promise.allSettled(
    pendingWithdrawals.map(async (withdrawal) => ({
      withdrawal,
      maxTokens: await getCommitmentMaxTokens(withdrawal)
    }))
  )

  return results.reduce<{
    activeWithdrawals: PendingWalletWithdrawal[]
    errors: unknown[]
  }>(
    (summary, result) => {
      if (result.status === 'rejected') {
        summary.errors.push(result.reason)
      } else if (result.value.maxTokens > 0n) {
        summary.activeWithdrawals.push({
          ...result.value.withdrawal,
          maxTokens: result.value.maxTokens
        })
      }

      return summary
    },
    { activeWithdrawals: [], errors: [] }
  )
}

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

/**
 * Returns the account-specific storage key of the legacy pending withdrawal cache. The UI wrote
 * it before the withdrawals moved to the WalletTokenController (the cache held only the latest
 * withdrawal). It is read only by the storage migration.
 */
export const getLegacyPendingWalletWithdrawalStorageKey = (
  accountAddr: string
): `walletStakingPendingWithdrawal:${string}` =>
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

/** Returns the id that tells withdrawals apart (the contract keys commitments by it). */
export const getPendingWalletWithdrawalId = ({ shares, unlocksAt }: PendingWalletWithdrawal) =>
  `${shares}:${unlocksAt}`

/**
 * Decodes each WALLET staking leave log of the account and keeps one log per withdrawal. Logs of
 * other accounts, other events and logs that can't be decoded are dropped, so that the result is
 * safe to store.
 */
export const getUniqueAccountWalletStakingLeaveLogs = (
  logs: WalletStakingRelayerLog[],
  accountAddr: string
): { log: WalletStakingRelayerLog; withdrawal: PendingWalletWithdrawal }[] => {
  const entriesById = new Map<
    string,
    { log: WalletStakingRelayerLog; withdrawal: PendingWalletWithdrawal }
  >()

  logs.forEach((log) => {
    let withdrawals: PendingWalletWithdrawal[]
    try {
      withdrawals = decodePendingWalletWithdrawals([log], accountAddr)
    } catch {
      return
    }

    const [withdrawal] = withdrawals
    if (!withdrawal) return
    entriesById.set(getPendingWalletWithdrawalId(withdrawal), {
      log: { topics: [...log.topics], data: log.data },
      withdrawal
    })
  })

  return Array.from(entriesById.values())
}

/**
 * Builds the WALLET staking leave log of a withdrawal, in the shape that the relayer returns.
 * Used to convert the legacy pending withdrawal cache, which kept only the decoded withdrawal.
 */
export const encodeWalletStakingLeaveLog = (
  accountAddr: string,
  { shares, unlocksAt, maxTokens }: PendingWalletWithdrawal
): WalletStakingRelayerLog => {
  const { topics, data } = walletStakingInterface.encodeEventLog(
    walletStakingInterface.getEvent('LogLeave')!,
    [accountAddr, shares, unlocksAt, maxTokens]
  )

  return { topics, data }
}

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
