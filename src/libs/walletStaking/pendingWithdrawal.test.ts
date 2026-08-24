import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { RPCProvider } from '../../interfaces/provider'
import { BindedRelayerCall } from '../relayerCall/relayerCall'
import {
  getPendingWalletWithdrawalCommitmentId,
  PendingWalletWithdrawal,
  WALLET_STAKING_PENDING_WITHDRAWALS_CACHE_TTL,
  WalletStakingPendingWithdrawalsCache,
  walletStakingInterface
} from './pendingWithdrawal'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222'
const commitmentInterface = new Interface(['function commitments(bytes32) view returns (uint256)'])

const withdrawals: PendingWalletWithdrawal[] = [
  { shares: 10n, unlocksAt: 100n, maxTokens: 1000n },
  { shares: 20n, unlocksAt: 200n, maxTokens: 2000n },
  { shares: 30n, unlocksAt: 300n, maxTokens: 3000n }
]

const getLog = (accountAddr: string, withdrawal: PendingWalletWithdrawal) => {
  const { data, topics } = walletStakingInterface.encodeEventLog(
    walletStakingInterface.getEvent('LogLeave')!,
    [accountAddr, withdrawal.shares, withdrawal.unlocksAt, withdrawal.maxTokens]
  )

  return { data, topics }
}

const getCallRelayer = (logs = withdrawals.map((withdrawal) => getLog(ACCOUNT, withdrawal))) =>
  jest.fn<BindedRelayerCall>(async () => ({ success: true, data: { logs } }))

const getProvider = (commitments: Map<string, bigint>) =>
  ({
    call: jest.fn(async ({ data }: { data: string }) => {
      const [commitmentId] = commitmentInterface.decodeFunctionData('commitments', data)
      return commitmentInterface.encodeFunctionResult('commitments', [
        commitments.get(String(commitmentId)) || 0n
      ])
    })
  }) as unknown as RPCProvider

describe('WalletStakingPendingWithdrawalsCache', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('loads all active commitments and returns the latest withdrawal and total shares', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)
    const activeCommitments = new Map([
      [getPendingWalletWithdrawalCommitmentId(ACCOUNT, withdrawals[0]!), 1100n],
      [getPendingWalletWithdrawalCommitmentId(ACCOUNT, withdrawals[2]!), 3300n]
    ])
    const callRelayer = getCallRelayer([
      ...withdrawals.map((withdrawal) => getLog(ACCOUNT, withdrawal)),
      getLog(OTHER_ACCOUNT, withdrawals[1]!),
      getLog(ACCOUNT, withdrawals[0]!)
    ])
    const cache = new WalletStakingPendingWithdrawalsCache()

    await expect(
      cache.get({ accountAddr: ACCOUNT, provider: getProvider(activeCommitments), callRelayer })
    ).resolves.toEqual({
      latestWithdrawal: { ...withdrawals[2], maxTokens: 3300n },
      totalShares: 40n,
      updatedAt: 1000
    })
  })

  test('deduplicates concurrent refreshes and serves the cached account result', async () => {
    const commitmentId = getPendingWalletWithdrawalCommitmentId(ACCOUNT, withdrawals[0]!)
    const callRelayer = getCallRelayer([getLog(ACCOUNT, withdrawals[0]!)])
    const provider = getProvider(new Map([[commitmentId, 1100n]]))
    const cache = new WalletStakingPendingWithdrawalsCache()

    const [firstResult, secondResult] = await Promise.all([
      cache.get({ accountAddr: ACCOUNT, provider, callRelayer }),
      cache.get({ accountAddr: ACCOUNT, provider, callRelayer })
    ])
    const cachedResult = await cache.get({ accountAddr: ACCOUNT, provider, callRelayer })

    expect(firstResult).toEqual(secondResult)
    expect(cachedResult).toEqual(firstResult)
    expect(callRelayer).toHaveBeenCalledTimes(1)
    expect(provider.call).toHaveBeenCalledTimes(1)
  })

  test('rechecks a persisted withdrawal when a fresh relayer result does not include it', async () => {
    const knownWithdrawal = withdrawals[0]!
    const commitmentId = getPendingWalletWithdrawalCommitmentId(ACCOUNT, knownWithdrawal)
    const callRelayer = getCallRelayer([])
    const provider = getProvider(new Map([[commitmentId, 1100n]]))
    const cache = new WalletStakingPendingWithdrawalsCache()

    await expect(cache.get({ accountAddr: ACCOUNT, provider, callRelayer })).resolves.toMatchObject(
      {
        latestWithdrawal: null,
        totalShares: 0n
      }
    )
    await expect(
      cache.get({ accountAddr: ACCOUNT, provider, callRelayer, knownWithdrawal })
    ).resolves.toMatchObject({
      latestWithdrawal: { ...knownWithdrawal, maxTokens: 1100n },
      totalShares: knownWithdrawal.shares
    })

    expect(callRelayer).toHaveBeenCalledTimes(2)
    expect(provider.call).toHaveBeenCalledTimes(1)
  })

  test('refreshes an account after its cache is invalidated', async () => {
    const commitmentId = getPendingWalletWithdrawalCommitmentId(ACCOUNT, withdrawals[0]!)
    const commitments = new Map([[commitmentId, 1100n]])
    const callRelayer = getCallRelayer([getLog(ACCOUNT, withdrawals[0]!)])
    const provider = getProvider(commitments)
    const cache = new WalletStakingPendingWithdrawalsCache()
    const params = { accountAddr: ACCOUNT, provider, callRelayer }

    await expect(cache.get(params)).resolves.toMatchObject({ totalShares: 10n })
    commitments.set(commitmentId, 0n)
    await expect(cache.get(params)).resolves.toMatchObject({ totalShares: 10n })

    cache.invalidate(ACCOUNT)
    await expect(cache.get(params)).resolves.toMatchObject({
      latestWithdrawal: null,
      totalShares: 0n
    })
    expect(callRelayer).toHaveBeenCalledTimes(2)
  })

  test('does not treat a stale result as fresh when its refresh fails', async () => {
    let now = 1000
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const commitmentId = getPendingWalletWithdrawalCommitmentId(ACCOUNT, withdrawals[0]!)
    const callRelayer = getCallRelayer([getLog(ACCOUNT, withdrawals[0]!)])
    const provider = getProvider(new Map([[commitmentId, 1100n]]))
    const cache = new WalletStakingPendingWithdrawalsCache()

    const initialResult = await cache.get({ accountAddr: ACCOUNT, provider, callRelayer })
    now += WALLET_STAKING_PENDING_WITHDRAWALS_CACHE_TTL
    callRelayer.mockRejectedValueOnce(new Error('relayer unavailable'))

    const staleResult = await cache.get({ accountAddr: ACCOUNT, provider, callRelayer })
    const repeatedResult = await cache.get({ accountAddr: ACCOUNT, provider, callRelayer })

    expect(staleResult).toEqual({
      ...initialResult,
      refreshError: new Error('relayer unavailable')
    })
    expect(repeatedResult).toEqual(staleResult)
    expect(callRelayer).toHaveBeenCalledTimes(2)
  })

  test('caches initial failures briefly without returning an empty successful result', async () => {
    const callRelayer = jest.fn<BindedRelayerCall>(async () => {
      throw new Error('relayer unavailable')
    })
    const cache = new WalletStakingPendingWithdrawalsCache()
    const params = { accountAddr: ACCOUNT, provider: getProvider(new Map()), callRelayer }

    await expect(cache.get(params)).rejects.toThrow('relayer unavailable')
    await expect(cache.get(params)).rejects.toThrow('relayer unavailable')
    expect(callRelayer).toHaveBeenCalledTimes(1)
  })
})
