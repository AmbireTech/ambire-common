import { describe, expect, it, jest } from '@jest/globals'

import { Storage } from '../../interfaces/storage'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityController } from './activity'

const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const chainId = 1n

const buildReceipt = (txnId: string) =>
  ({
    hash: txnId,
    status: 1,
    to: '0x0000000000000000000000000000000000000001',
    blockNumber: 123,
    blockHash: `0x${'1'.repeat(64)}`,
    gasUsed: 21000n,
    logs: []
  }) as any

const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const createStorage = (
  initialData: Record<string, any> = {},
  { delayFirstExternalAccountOpsSet = true } = {}
) => {
  const data: Record<string, any> = initialData
  const firstExternalAccountOpsSet = createDeferred()
  let externalAccountOpsSetCalls = 0

  const storage: Storage = {
    get: jest.fn(async (key: string, defaultValue?: any) => data[key] ?? defaultValue) as any,
    set: jest.fn(async (key: string, value: any) => {
      data[key] = value

      if (key === 'externalAccountOps') {
        externalAccountOpsSetCalls += 1
        if (delayFirstExternalAccountOpsSet && externalAccountOpsSetCalls === 1) {
          await firstExternalAccountOpsSet.promise
        }
      }

      return null
    }) as any,
    remove: jest.fn(async (key: string) => {
      delete data[key]
      return null
    }) as any
  }

  return { data, firstExternalAccountOpsSet, storage }
}

const createController = (
  storage: Storage,
  provider: any,
  callRelayer: any = jest.fn(async () => undefined)
) =>
  new ActivityController(
    storage as any,
    jest.fn() as any,
    callRelayer,
    { initialLoadPromise: Promise.resolve(), accounts: [] } as any,
    { initialLoadPromise: Promise.resolve(), account: { addr: accountAddr } } as any,
    { providers: { [chainId.toString()]: provider } } as any,
    { networks: [{ chainId }], isInitialized: true } as any,
    {
      addTokensToBeLearned: jest.fn(),
      getTokenBalancesOnBlock: jest.fn(async () => [
        [
          '0x',
          {
            address: '0x0000000000000000000000000000000000000000',
            amount: 0n,
            chainId,
            decimals: 18,
            flags: {
              canTopUpGasTank: false,
              isFeeToken: true,
              onGasTank: false,
              rewardsType: null
            },
            marketDataIn: [],
            name: 'Ether',
            priceIn: [],
            symbol: 'ETH'
          }
        ]
      ])
    } as any,
    {} as any,
    jest.fn(async () => undefined)
  )

describe('ActivityController external account ops', () => {
  it('does not add an external account op when the txnId already exists on an internal account op', async () => {
    const txnId = `0x${'a'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(),
      getBlock: jest.fn()
    }
    const { data, storage } = createStorage({
      accountsOps: {
        [accountAddr]: {
          [chainId.toString()]: [
            {
              accountAddr,
              chainId,
              txnId,
              calls: []
            }
          ]
        }
      }
    })
    const controller = createController(storage, provider)

    await controller.addExternalAccountOp({
      accountAddr,
      chainId,
      txnId,
      receipt: buildReceipt(txnId)
    })

    expect(provider.getTransaction).not.toHaveBeenCalled()
    expect(provider.getBlock).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(data.externalAccountOps).toBeUndefined()
  })

  it('does not add an external account op when the same account is keyed with different casing', async () => {
    const txnId = `0x${'d'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(),
      getBlock: jest.fn()
    }
    const { data, storage } = createStorage({
      accountsOps: {
        [accountAddr]: {
          [chainId.toString()]: [
            {
              accountAddr,
              chainId,
              txnId,
              calls: []
            }
          ]
        }
      }
    })
    const controller = createController(storage, provider)

    await controller.addExternalAccountOp({
      accountAddr: accountAddr.toLowerCase(),
      chainId,
      txnId,
      receipt: buildReceipt(txnId)
    })

    expect(provider.getTransaction).not.toHaveBeenCalled()
    expect(provider.getBlock).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(data.externalAccountOps).toBeUndefined()
  })

  it('does not add an external account op when the txnId already exists on an internal account op call', async () => {
    const txnId = `0x${'b'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(),
      getBlock: jest.fn()
    }
    const { data, storage } = createStorage({
      accountsOps: {
        [accountAddr]: {
          [chainId.toString()]: [
            {
              accountAddr,
              chainId,
              calls: [
                {
                  to: '0x0000000000000000000000000000000000000001',
                  value: 0n,
                  data: '0x',
                  txnId
                }
              ]
            }
          ]
        }
      }
    })
    const controller = createController(storage, provider)

    await controller.addExternalAccountOp({
      accountAddr,
      chainId,
      txnId,
      receipt: buildReceipt(txnId)
    })

    expect(provider.getTransaction).not.toHaveBeenCalled()
    expect(provider.getBlock).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(data.externalAccountOps).toBeUndefined()
  })

  it('does not add an external account op when the txnId already exists on an external account op', async () => {
    const txnId = `0x${'c'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(),
      getBlock: jest.fn()
    }
    const existingExternalAccountOp = {
      accountAddr,
      chainId,
      txnId,
      calls: []
    }
    const { data, storage } = createStorage({
      externalAccountOps: {
        [accountAddr]: {
          [chainId.toString()]: [existingExternalAccountOp]
        }
      }
    })
    const controller = createController(storage, provider)

    await controller.addExternalAccountOp({
      accountAddr,
      chainId,
      txnId,
      receipt: buildReceipt(txnId)
    })

    expect(provider.getTransaction).not.toHaveBeenCalled()
    expect(provider.getBlock).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(data.externalAccountOps[accountAddr][chainId.toString()]).toEqual([
      existingExternalAccountOp
    ])
  })

  it('removes an external account op when a pending internal op resolves to the same txnId', async () => {
    const provisionalTxnId = `0x${'1'.repeat(64)}`
    const confirmedTxnId = `0x${'2'.repeat(64)}`
    const unrelatedTxnId = `0x${'3'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(async () => null),
      getTransactionReceipt: jest.fn(async (txnId: string) =>
        txnId === confirmedTxnId ? buildReceipt(confirmedTxnId) : null
      )
    }
    const callRelayer = jest.fn(async () => ({ data: { txId: confirmedTxnId } }))
    const externalAccountOpToRemove = {
      accountAddr,
      chainId,
      txnId: confirmedTxnId,
      calls: []
    }
    const unrelatedExternalAccountOp = {
      accountAddr,
      chainId,
      txnId: unrelatedTxnId,
      calls: []
    }
    const { data, storage } = createStorage(
      {
        accountsOps: {
          [accountAddr]: {
            [chainId.toString()]: [
              {
                id: 'pending-op',
                accountAddr,
                chainId,
                nonce: 1n,
                calls: [],
                txnId: provisionalTxnId,
                status: AccountOpStatus.BroadcastedButNotConfirmed,
                timestamp: 1700000000,
                identifiedBy: {
                  type: 'Relayer',
                  identifier: 'relayer-transaction-id'
                }
              }
            ]
          }
        },
        externalAccountOps: {
          [accountAddr]: {
            [chainId.toString()]: [externalAccountOpToRemove, unrelatedExternalAccountOp]
          }
        }
      },
      { delayFirstExternalAccountOpsSet: false }
    )
    const controller = createController(storage, provider, callRelayer)

    const result = await controller.updateAccountsOpsStatuses([accountAddr])

    expect(result[accountAddr]!.updatedAccountsOps).toHaveLength(1)
    expect(data.accountsOps[accountAddr][chainId.toString()][0].txnId).toBe(confirmedTxnId)
    expect(data.accountsOps[accountAddr][chainId.toString()][0].status).toBe(
      AccountOpStatus.Success
    )
    expect(data.externalAccountOps[accountAddr][chainId.toString()]).toEqual([
      unrelatedExternalAccountOp
    ])
    expect(storage.set).toHaveBeenCalledWith('externalAccountOps', data.externalAccountOps)
  })

  it('queues same-tick addExternalAccountOp calls to avoid overlapping writes', async () => {
    const txnId1 = `0x${'a'.repeat(64)}`
    const txnId2 = `0x${'b'.repeat(64)}`
    const provider = {
      getTransaction: jest.fn(async (txnId: string) => ({
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
        data: txnId === txnId1 ? '0x01' : '0x02'
      })),
      getBlock: jest.fn(async () => ({ timestamp: 1700000000 }))
    }
    const { data, firstExternalAccountOpsSet, storage } = createStorage()
    const controller = createController(storage, provider)

    const promise1 = controller.addExternalAccountOp({
      accountAddr,
      chainId,
      txnId: txnId1,
      receipt: buildReceipt(txnId1)
    })
    const promise2 = controller.addExternalAccountOp({
      accountAddr,
      chainId,
      txnId: txnId2,
      receipt: buildReceipt(txnId2)
    })

    await new Promise((resolve) => {
      setImmediate(resolve)
    })

    expect(provider.getTransaction).toHaveBeenCalledTimes(1)
    expect(provider.getTransaction).toHaveBeenCalledWith(txnId1)

    firstExternalAccountOpsSet.resolve()
    await Promise.all([promise1, promise2])

    expect(provider.getTransaction).toHaveBeenCalledTimes(2)
    expect(
      data.externalAccountOps[accountAddr][chainId.toString()].map((op: any) => op.txnId)
    ).toEqual([txnId2, txnId1])
  })
})
