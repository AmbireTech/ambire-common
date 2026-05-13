import { describe, expect, it, jest } from '@jest/globals'

import { Storage } from '../../interfaces/storage'
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

const createStorage = (initialData: Record<string, any> = {}) => {
  const data: Record<string, any> = initialData
  const firstExternalAccountOpsSet = createDeferred()
  let externalAccountOpsSetCalls = 0

  const storage: Storage = {
    get: jest.fn(async (key: string, defaultValue?: any) => data[key] ?? defaultValue) as any,
    set: jest.fn(async (key: string, value: any) => {
      data[key] = value

      if (key === 'externalAccountOps') {
        externalAccountOpsSetCalls += 1
        if (externalAccountOpsSetCalls === 1) await firstExternalAccountOpsSet.promise
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

const createController = (storage: Storage, provider: any) =>
  new ActivityController(
    storage as any,
    jest.fn() as any,
    jest.fn(),
    { initialLoadPromise: Promise.resolve(), accounts: [] } as any,
    { initialLoadPromise: Promise.resolve(), account: { addr: accountAddr } } as any,
    { providers: { [chainId.toString()]: provider } } as any,
    { networks: [{ chainId }], isInitialized: true } as any,
    {
      getTokenBalancesOnBlock: jest.fn(async () => {
        throw new Error('skip balance changes in this test')
      })
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
