import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { IActivityController } from '../../interfaces/activity'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import {
  encodeWalletStakingLeaveLog,
  getPendingWalletWithdrawalCommitmentId,
  LOG_LEAVE_TOPIC,
  PendingWalletWithdrawal,
  WalletStakingRelayerLog
} from '../../libs/walletStaking/pendingWithdrawal'
import { WalletTokenController } from './walletToken'

const ACCOUNT_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const leaveInterface = new Interface(['function leave(uint256 shares, bool skipMint)'])
const commitmentInterface = new Interface(['function commitments(bytes32) view returns (uint256)'])
const TXN_ID = `0x${'a'.repeat(64)}`
const LOCAL_TXN_ID = `0x${'b'.repeat(64)}`

const withdrawals: PendingWalletWithdrawal[] = [
  { shares: 10n, unlocksAt: 100n, maxTokens: 1000n },
  { shares: 20n, unlocksAt: 200n, maxTokens: 2000n },
  { shares: 30n, unlocksAt: 300n, maxTokens: 3000n }
]
const getLeaveLog = (withdrawal: PendingWalletWithdrawal, accountAddr = ACCOUNT_ADDR) =>
  encodeWalletStakingLeaveLog(accountAddr, withdrawal)
const toReceiptLog = (log: WalletStakingRelayerLog, address = WALLET_STAKING_ADDR) => ({
  address,
  ...log
})

const makeStorage = (walletStakingLeaveLogs?: Record<string, WalletStakingRelayerLog[]>) => {
  const store: Record<string, any> = walletStakingLeaveLogs ? { walletStakingLeaveLogs } : {}

  return {
    get: jest.fn(async (key: string, defaultValue?: any) =>
      key in store ? store[key] : defaultValue
    ),
    set: jest.fn(async (key: string, value: any) => {
      store[key] = value
    }),
    store
  }
}

/**
 * A provider that answers the staking contract's `commitments` calls from `activeWithdrawals`
 * (a missing withdrawal is withdrawn) and returns the given receipts.
 */
const makeProvider = ({
  activeWithdrawals = [],
  receipts = {},
  failingCommitment
}: {
  activeWithdrawals?: PendingWalletWithdrawal[]
  receipts?: Record<string, unknown>
  failingCommitment?: PendingWalletWithdrawal
}) => {
  const maxTokensByCommitmentId = new Map(
    activeWithdrawals.map((withdrawal) => [
      getPendingWalletWithdrawalCommitmentId(ACCOUNT_ADDR, withdrawal),
      withdrawal.maxTokens
    ])
  )
  const failingCommitmentId =
    failingCommitment && getPendingWalletWithdrawalCommitmentId(ACCOUNT_ADDR, failingCommitment)

  return {
    call: jest.fn(async ({ data }: { data: string }) => {
      const [commitmentId] = commitmentInterface.decodeFunctionData('commitments', data)
      if (String(commitmentId) === failingCommitmentId) throw new Error('RPC is down')
      return commitmentInterface.encodeFunctionResult('commitments', [
        maxTokensByCommitmentId.get(String(commitmentId)) || 0n
      ])
    }),
    getTransactionReceipt: jest.fn(async (txnId: string) => {
      const receipt = receipts[txnId]
      if (receipt instanceof Error) throw receipt
      return receipt ?? null
    })
  }
}

const makeLeaveAccountOp = (txnId: string) =>
  ({
    txnId,
    status: AccountOpStatus.Success,
    calls: [
      {
        to: WALLET_STAKING_ADDR,
        value: 0n,
        data: leaveInterface.encodeFunctionData('leave', [10n, false])
      }
    ]
  }) as unknown as SubmittedAccountOp

const getWithdrawalsController = ({
  isLookupEnabled = true,
  storedLogs,
  relayerLogs = [],
  provider = makeProvider({}),
  localAccountOps = []
}: {
  isLookupEnabled?: boolean
  storedLogs?: Record<string, WalletStakingRelayerLog[]>
  relayerLogs?: WalletStakingRelayerLog[]
  provider?: ReturnType<typeof makeProvider>
  localAccountOps?: SubmittedAccountOp[]
} = {}) => {
  const storage = makeStorage(storedLogs)
  const callRelayer = jest.fn<BindedRelayerCall>(async () => ({
    success: true,
    data: { logs: relayerLogs }
  }))
  const getInternalAccountOps = jest.fn(async () => localAccountOps)
  const controller = new WalletTokenController({
    storage: storage as unknown as IStorageController,
    featureFlags: {
      isFeatureEnabled: jest.fn(() => isLookupEnabled)
    } as unknown as IFeatureFlagsController,
    providers: { providers: { '1': provider } } as unknown as IProvidersController,
    callRelayer,
    activity: { getInternalAccountOps } as unknown as IActivityController
  })
  const onError = jest.fn()
  controller.onError(onError)

  return { controller, storage, callRelayer, getInternalAccountOps, provider, onError }
}

const ACCOUNT_KEY = ACCOUNT_ADDR.toLowerCase()

describe('WalletTokenController pending withdrawals', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  test('loads the withdrawals from the relayer and stores only the active leave logs', async () => {
    const provider = makeProvider({ activeWithdrawals: [withdrawals[0]!, withdrawals[2]!] })
    const { controller, storage, callRelayer, getInternalAccountOps } = getWithdrawalsController({
      relayerLogs: withdrawals.map((withdrawal) => getLeaveLog(withdrawal)),
      provider
    })

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(callRelayer).toHaveBeenCalledTimes(1)
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/identity/logs',
      'POST',
      { identity: ACCOUNT_ADDR, address: WALLET_STAKING_ADDR, requestedTopic: LOG_LEAVE_TOPIC },
      undefined,
      5000
    )
    expect(getInternalAccountOps).not.toHaveBeenCalled()
    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]).toEqual({
      status: 'loaded',
      latestWithdrawal: withdrawals[2],
      totalShares: 40n,
      txnIdLookupError: null
    })
    expect(storage.store.walletStakingLeaveLogs).toEqual({
      [ACCOUNT_KEY]: [getLeaveLog(withdrawals[0]!), getLeaveLog(withdrawals[2]!)]
    })
  })

  test('never calls the relayer when the lookup is off and reads the local unstake receipts', async () => {
    const provider = makeProvider({
      activeWithdrawals: [withdrawals[0]!],
      receipts: { [LOCAL_TXN_ID]: { logs: [toReceiptLog(getLeaveLog(withdrawals[0]!))] } }
    })
    const { controller, storage, callRelayer, getInternalAccountOps } = getWithdrawalsController({
      isLookupEnabled: false,
      provider,
      localAccountOps: [makeLeaveAccountOp(LOCAL_TXN_ID)]
    })

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(callRelayer).not.toHaveBeenCalled()
    expect(getInternalAccountOps).toHaveBeenCalledWith(ACCOUNT_ADDR, 1n)
    expect(provider.getTransactionReceipt).toHaveBeenCalledWith(LOCAL_TXN_ID)
    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.latestWithdrawal).toEqual(withdrawals[0])
    expect(storage.store.walletStakingLeaveLogs).toEqual({
      [ACCOUNT_KEY]: [getLeaveLog(withdrawals[0]!)]
    })
  })

  test('uses the stored leave logs without the relayer and prunes withdrawn ones', async () => {
    const provider = makeProvider({ activeWithdrawals: [withdrawals[1]!] })
    const { controller, storage, callRelayer } = getWithdrawalsController({
      isLookupEnabled: false,
      storedLogs: { [ACCOUNT_KEY]: [getLeaveLog(withdrawals[0]!), getLeaveLog(withdrawals[1]!)] },
      provider
    })

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(callRelayer).not.toHaveBeenCalled()
    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]).toMatchObject({
      status: 'loaded',
      latestWithdrawal: withdrawals[1],
      totalShares: 20n
    })
    expect(storage.store.walletStakingLeaveLogs).toEqual({
      [ACCOUNT_KEY]: [getLeaveLog(withdrawals[1]!)]
    })
  })

  test('drops stored logs of other accounts from the result and keeps them in storage', async () => {
    const otherAccountLog = getLeaveLog(withdrawals[0]!, WALLET_STAKING_ADDR)
    const provider = makeProvider({})
    const { controller, storage } = getWithdrawalsController({
      isLookupEnabled: false,
      storedLogs: { [ACCOUNT_KEY]: [otherAccountLog], other: [otherAccountLog] },
      provider
    })

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(provider.call).not.toHaveBeenCalled()
    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.latestWithdrawal).toBeNull()
    expect(storage.store.walletStakingLeaveLogs).toEqual({ other: [otherAccountLog] })
  })

  test('keeps every leave log when a commitment check fails', async () => {
    const provider = makeProvider({
      activeWithdrawals: [withdrawals[0]!],
      failingCommitment: withdrawals[1]!
    })
    const storedLogs = [getLeaveLog(withdrawals[0]!), getLeaveLog(withdrawals[1]!)]
    const { controller, storage, onError } = getWithdrawalsController({
      isLookupEnabled: false,
      storedLogs: { [ACCOUNT_KEY]: storedLogs },
      provider
    })

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]).toMatchObject({
      status: 'error',
      latestWithdrawal: withdrawals[0]
    })
    expect(storage.store.walletStakingLeaveLogs).toEqual({ [ACCOUNT_KEY]: storedLogs })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unable to check a pending $WALLET withdrawal.' })
    )
  })

  test('reports a relayer failure and does not overwrite the stored logs', async () => {
    const storedLogs = [getLeaveLog(withdrawals[0]!)]
    const { controller, storage, callRelayer, onError } = getWithdrawalsController({
      storedLogs: { [ACCOUNT_KEY]: storedLogs }
    })
    callRelayer.mockRejectedValue(new Error('Relayer is down'))

    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.status).toBe('error')
    expect(storage.set).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unable to load the pending $WALLET withdrawals.' })
    )
  })

  test('applies only the latest load when an older one finishes last', async () => {
    const provider = makeProvider({ activeWithdrawals: withdrawals })
    const { controller, callRelayer } = getWithdrawalsController({ provider })
    let resolveFirstLoad: (value: unknown) => void = () => {}
    callRelayer
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstLoad = resolve
          })
      )
      .mockResolvedValueOnce({ success: true, data: { logs: [getLeaveLog(withdrawals[1]!)] } })

    const firstLoad = controller.loadPendingWithdrawals(ACCOUNT_ADDR)
    await controller.loadPendingWithdrawals(ACCOUNT_ADDR)
    resolveFirstLoad({ success: true, data: { logs: [getLeaveLog(withdrawals[2]!)] } })
    await firstLoad

    expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.latestWithdrawal).toEqual(withdrawals[1])
  })

  describe('findPendingWithdrawalInTxn', () => {
    test('rejects an invalid transaction ID without reading anything', async () => {
      const { controller, provider } = getWithdrawalsController({ isLookupEnabled: false })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, '0x1234')

      expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.txnIdLookupError).toBe('invalid')
    })

    test('stores the leave logs of the transaction, not its ID, and shows the withdrawal', async () => {
      const provider = makeProvider({
        activeWithdrawals: [withdrawals[0]!],
        receipts: {
          [TXN_ID]: {
            logs: [
              toReceiptLog(getLeaveLog(withdrawals[0]!)),
              // Only logs emitted by the staking contract are trusted
              toReceiptLog(
                getLeaveLog(withdrawals[1]!),
                '0x3333333333333333333333333333333333333333'
              )
            ]
          }
        }
      })
      const { controller, storage, callRelayer } = getWithdrawalsController({
        isLookupEnabled: false,
        provider
      })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, ` ${TXN_ID.toUpperCase()} `)

      expect(callRelayer).not.toHaveBeenCalled()
      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]).toEqual({
        status: 'loaded',
        latestWithdrawal: withdrawals[0],
        totalShares: 10n,
        txnIdLookupError: null
      })
      expect(storage.store.walletStakingLeaveLogs).toEqual({
        [ACCOUNT_KEY]: [getLeaveLog(withdrawals[0]!)]
      })
      expect(JSON.stringify(storage.store)).not.toContain(TXN_ID.slice(2))
    })

    test('reports a transaction without a leave log of the account', async () => {
      const provider = makeProvider({
        receipts: {
          [TXN_ID]: {
            logs: [toReceiptLog(getLeaveLog(withdrawals[0]!, WALLET_STAKING_ADDR))]
          }
        }
      })
      const { controller, storage } = getWithdrawalsController({ isLookupEnabled: false, provider })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, TXN_ID)

      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.txnIdLookupError).toBe('not-found')
      expect(storage.set).not.toHaveBeenCalled()
    })

    test('reports a withdrawal that was already withdrawn and does not store it', async () => {
      const provider = makeProvider({
        receipts: { [TXN_ID]: { logs: [toReceiptLog(getLeaveLog(withdrawals[0]!))] } }
      })
      const { controller, storage } = getWithdrawalsController({ isLookupEnabled: false, provider })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, TXN_ID)

      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]).toMatchObject({
        latestWithdrawal: null,
        txnIdLookupError: 'not-found'
      })
      expect(storage.store.walletStakingLeaveLogs).toEqual({})
    })

    test('reports a transaction that could not be read', async () => {
      const provider = makeProvider({ receipts: { [TXN_ID]: new Error('RPC is down') } })
      const { controller, onError } = getWithdrawalsController({
        isLookupEnabled: false,
        provider
      })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, TXN_ID)

      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.txnIdLookupError).toBe('failed')
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unable to check the unstake transaction.' })
      )
    })

    test('a plain reload clears the lookup error', async () => {
      const { controller } = getWithdrawalsController({ isLookupEnabled: false })

      await controller.findPendingWithdrawalInTxn(ACCOUNT_ADDR, '0x1234')
      await controller.loadPendingWithdrawals(ACCOUNT_ADDR)

      expect(controller.pendingWithdrawals[ACCOUNT_ADDR]?.txnIdLookupError).toBeNull()
    })
  })
})
