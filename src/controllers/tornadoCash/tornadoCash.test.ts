import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { TORNADO_CASH_POOLS } from '../../consts/tornadoCash'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { PrivateAccountRef } from '../../interfaces/privateAccount'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import {
  TornadoCashNote,
  TornadoCashPlugin,
  TornadoCashPluginFactory
} from '../../interfaces/tornadoCash'
import { TORNADO_CASH_PLUGIN_STOPPED_MESSAGE } from '../../libs/tornadoCash/plugin'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'
import { TornadoCashController } from './tornadoCash'

class FakeKeystore extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  isUnlocked = true

  areSeedsLoaded = true

  seeds: { id: string; notBackedUp?: boolean }[] = [{ id: 'seed-a' }, { id: 'seed-b' }]

  derivePrivacyKey = jest.fn(async () => '0x01')

  fireUpdate() {
    this.emitUpdate()
  }
}

class FakeSelectedAccount extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  account = null

  privateAccount: PrivateAccountRef | null = null

  select(privateAccount: PrivateAccountRef | null) {
    this.privateAccount = privateAccount
    this.emitUpdate()
  }
}

class FakeFeatureFlags extends EventEmitter {
  isFeatureEnabled() {
    return false
  }
}

class FakeNetworks extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  networks = [{ chainId: 1n, nativeAssetId: 'ethereum', platformId: 'ethereum' }]
}

class FakeProviders extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  providers: { [chainId: string]: object } = { '1': {} }
}

const ETHER = 10n ** 18n

/** Lets the plugin's asynchronous stop run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const poolOf = (symbol: string, denomination: bigint) =>
  TORNADO_CASH_POOLS.find((pool) => pool.symbol === symbol && pool.denomination === denomination)!

const note = (symbol: string, denomination: bigint): TornadoCashNote => ({
  poolAddress: poolOf(symbol, denomination).address,
  amount: denomination,
  depositIndex: 0,
  timestamp: 1
})

/** A plugin that holds `notes`, and a factory that counts the plugins it starts. */
const createFakePluginFactory = (notes: TornadoCashNote[]) => {
  const plugins: (TornadoCashPlugin & { dispose: jest.Mock })[] = []
  const factory: TornadoCashPluginFactory = jest.fn(async () => {
    const plugin = {
      sync: jest.fn(async () => {}),
      notes: jest.fn(async () => notes),
      prepareShield: jest.fn(async () => []),
      prepareUnshield: jest.fn(async () => []),
      dispose: jest.fn(async () => {})
    }
    plugins.push(plugin)
    return plugin
  })

  return { factory, plugins }
}

const prepareTest = async ({
  accounts = ['seed-a'],
  pluginFactory
}: {
  accounts?: string[]
  pluginFactory?: TornadoCashPluginFactory
} = {}) => {
  const storage = new StorageController(produceMemoryStore())
  await storage.set(
    'tornadoCashAccounts',
    accounts.map((seedId) => ({ seedId, createdAt: 1 }))
  )
  const keystore = new FakeKeystore()
  const selectedAccount = new FakeSelectedAccount()
  const onAccountsRemoved = jest.fn(async () => {})
  const controller = new TornadoCashController({
    keystore: keystore as unknown as IKeystoreController,
    featureFlags: new FakeFeatureFlags() as unknown as IFeatureFlagsController,
    networks: new FakeNetworks() as unknown as INetworksController,
    providers: new FakeProviders() as unknown as IProvidersController,
    selectedAccount: selectedAccount as unknown as ISelectedAccountController,
    storage,
    fetch: jest.fn() as any,
    pluginFactory,
    onAccountsRemoved
  })
  await controller.initialLoadPromise

  return { controller, keystore, selectedAccount, storage, onAccountsRemoved }
}

describe('TornadoCashController', () => {
  it('adds one account per recovery phrase and stores it', async () => {
    const { controller, storage } = await prepareTest({ accounts: [] })

    await controller.addAccount('seed-a')
    await expect(controller.addAccount('seed-a')).rejects.toThrow(
      'This recovery phrase already has a Tornado Cash account.'
    )
    await expect(controller.addAccount('seed-gone')).rejects.toThrow(
      'This recovery phrase is no longer in your wallet.'
    )

    expect(controller.accounts.map(({ seedId }) => seedId)).toEqual(['seed-a'])
    expect((await storage.get('tornadoCashAccounts', [])).map(({ seedId }: any) => seedId)).toEqual(
      ['seed-a']
    )
  })

  it('forgets accounts whose recovery phrase is gone', async () => {
    const { controller, onAccountsRemoved } = await prepareTest({
      accounts: ['seed-a', 'seed-gone']
    })

    expect(controller.accounts.map(({ seedId }) => seedId)).toEqual(['seed-a'])
    expect(onAccountsRemoved).toHaveBeenCalledWith(['seed-gone'])
  })

  it('syncs the selected account and sums its notes per asset, largest first', async () => {
    const { factory } = createFakePluginFactory([
      note('ETH', ETHER / 10n),
      note('ETH', ETHER),
      note('ETH', ETHER / 10n),
      note('USDC', 10n ** 8n)
    ])
    const { controller, selectedAccount } = await prepareTest({ pluginFactory: factory })
    selectedAccount.select({ providerId: 'tornadoCash', seedId: 'seed-a' })

    await controller.syncSelectedAccount()

    expect(controller.syncState.status).toBe('ready')
    expect(controller.balances).toEqual([
      {
        assetAddress: poolOf('ETH', ETHER).assetAddress,
        symbol: 'ETH',
        decimals: 18,
        amount: ETHER + ETHER / 5n,
        notes: [
          { denomination: ETHER, count: 1 },
          { denomination: ETHER / 10n, count: 2 }
        ]
      },
      {
        assetAddress: poolOf('USDC', 10n ** 8n).assetAddress,
        symbol: 'USDC',
        decimals: 6,
        amount: 10n ** 8n,
        notes: [{ denomination: 10n ** 8n, count: 1 }]
      }
    ])
  })

  it('drops the notes and stops the plugin on lock and when another account is selected', async () => {
    const { factory, plugins } = createFakePluginFactory([note('ETH', ETHER)])
    const { controller, keystore, selectedAccount } = await prepareTest({
      accounts: ['seed-a', 'seed-b'],
      pluginFactory: factory
    })
    selectedAccount.select({ providerId: 'tornadoCash', seedId: 'seed-a' })
    await controller.syncSelectedAccount()

    selectedAccount.select({ providerId: 'tornadoCash', seedId: 'seed-b' })
    await flush()
    expect(controller.balances).toBeNull()
    expect(plugins[0]!.dispose).toHaveBeenCalled()

    await controller.syncSelectedAccount()
    keystore.isUnlocked = false
    keystore.fireUpdate()
    await flush()

    expect(controller.balances).toBeNull()
    expect(controller.unavailableReason).toBe('locked')
    expect(plugins[1]!.dispose).toHaveBeenCalled()
  })

  it('starts a new plugin once when the running one stopped', async () => {
    const { factory, plugins } = createFakePluginFactory([note('ETH', ETHER)])
    const { controller, selectedAccount } = await prepareTest({ pluginFactory: factory })
    selectedAccount.select({ providerId: 'tornadoCash', seedId: 'seed-a' })
    await controller.syncSelectedAccount()
    plugins[0]!.sync.mockImplementationOnce(async () => {
      throw new Error(TORNADO_CASH_PLUGIN_STOPPED_MESSAGE)
    })

    await controller.syncSelectedAccount()

    expect(factory).toHaveBeenCalledTimes(2)
    expect(controller.syncState.error).toBeNull()
  })

  describe('deposits', () => {
    const POOL_INTERFACE = new Interface(['function deposit(bytes32 _commitment) payable'])
    const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'
    const depositTx = (denomination: bigint, commitment: string) => ({
      to: poolOf('ETH', denomination).address,
      data: POOL_INTERFACE.encodeFunctionData('deposit', [commitment]),
      value: denomination
    })
    const COMMITMENT_1 = `0x${'01'.repeat(32)}`
    const COMMITMENT_2 = `0x${'02'.repeat(32)}`
    const depositParams = {
      seedId: 'seed-a',
      accountAddr: '0x0000000000000000000000000000000000000abc',
      assetAddress: ETH_ADDRESS,
      amount: ETHER + ETHER / 10n
    }

    const prepareDepositTest = async (txs: ReturnType<typeof depositTx>[]) => {
      const { factory, plugins } = createFakePluginFactory([])
      const test = await prepareTest({ pluginFactory: factory })
      const ready = await factory({} as never)
      plugins.length = 0
      ;(factory as jest.Mock).mockImplementation(async () => ({
        ...ready,
        prepareShield: jest.fn(async () => txs)
      }))

      return test
    }

    it('returns the deposit calls when they are exactly the notes of the amount', async () => {
      const txs = [depositTx(ETHER, COMMITMENT_1), depositTx(ETHER / 10n, COMMITMENT_2)]
      const { controller } = await prepareDepositTest(txs)

      expect(await controller.buildDepositCalls(depositParams)).toEqual(txs)
    })

    it('refuses an amount that is no sum of notes, and anything else the SDK builds', async () => {
      const { controller } = await prepareDepositTest([depositTx(ETHER, COMMITMENT_1)])

      await expect(
        controller.buildDepositCalls({ ...depositParams, amount: ETHER / 20n })
      ).rejects.toThrow('Tornado Cash accepts only 0.1, 1, 10 or 100 ETH, or a sum of them.')
      // The SDK built 1 ETH for 1.1 ETH
      await expect(controller.buildDepositCalls(depositParams)).rejects.toThrow(
        'This send could not be prepared safely'
      )
    })

    it('refuses a deposit that reuses the notes of one still on its way', async () => {
      const txs = [depositTx(ETHER, COMMITMENT_1), depositTx(ETHER / 10n, COMMITMENT_2)]
      const { controller } = await prepareDepositTest(txs)
      const calls = await controller.buildDepositCalls(depositParams)

      controller.onAccountOpBroadcast({ chainId: 1n, calls })

      await expect(controller.buildDepositCalls(depositParams)).rejects.toThrow(
        'Your last send to this account is still on its way.'
      )
    })
  })

  it('is unavailable where the SDK cannot run', async () => {
    const { controller, selectedAccount } = await prepareTest()
    selectedAccount.select({ providerId: 'tornadoCash', seedId: 'seed-a' })

    expect(controller.unavailableReason).toBe('unsupported-platform')
  })
})
