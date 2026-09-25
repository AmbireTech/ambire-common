import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsStoreKey
} from '../../consts/privacyPools'
import { IKeystoreController } from '../../interfaces/keystore'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'
import { PrivacyPoolsController } from './privacyPools'

/**
 * Stands in for the SDK plugin. Each `sync()` waits until the test releases it, so a test can see
 * what runs while another sync is still under way. The phrase a plugin works for is read the way
 * the real one would learn it - by deriving a key through the host.
 */
type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }

const createDeferred = (): Deferred => {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

type RunningSync = { protocol: FakeProtocol; seedId: string; chainId: bigint; gate: Deferred }

const ETHEREUM_ENTRYPOINT = getPrivacyPoolsChainConfig(1n)!.entrypointAddress
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ETHEREUM_ETH_POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const WITHDRAWAL_RECIPIENT = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'
const DEPOSITOR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

const ENTRYPOINT_INTERFACE = new Interface([
  'function deposit(uint256 _precommitment) payable returns (uint256)',
  'function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)',
  'function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)'
])
const ERC20_INTERFACE = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount)'
])

const MINIMUM_DEPOSIT = 10n ** 16n
const MINIMUM_USDC_DEPOSIT = 10n ** 6n

/** How many deposits each phrase has on chain - what its next precommitment follows from. */
let depositCountBySeed: { [seedId: string]: number } = {}
let allowance = 0n
let preparedDepositTarget = ETHEREUM_ENTRYPOINT

const getPrecommitment = (seedId: string) =>
  BigInt(seedId.length * 1000 + (depositCountBySeed[seedId] || 0))

const protocols: FakeProtocol[] = []
let runningSyncs: RunningSync[] = []
let notesBySeed: { [seedId: string]: { label: bigint; amount: bigint; approved: boolean }[] } = {}

class FakeProtocol {
  host: any

  seedId: string | null = null

  syncCount = 0

  prepareShieldCount = 0

  /** How many syncs this plugin had done when it was asked to prove - see `prepareUnshield`. */
  syncCountWhenProving: number | null = null

  constructor(host: any) {
    this.host = host
    protocols.push(this)
  }

  async sync() {
    this.syncCount += 1
    this.seedId = await this.host.keystore.deriveAt("m/28784'/1'/0'/0")
    const chainId: bigint = await this.host.provider.getChainId()
    const gate = createDeferred()
    runningSyncs.push({ protocol: this, seedId: this.seedId as string, chainId, gate })

    await gate.promise

    // What the real plugin does at the end of every sync: persist the chain's public history
    const config = getPrivacyPoolsChainConfig(chainId)
    if (config) await this.host.storage.set(getPrivacyPoolsStoreKey(config), `synced-${Date.now()}`)
  }

  // The real one syncs first as well, which the controller has already queued by this point
  async prepareShield() {
    this.prepareShieldCount += 1
    this.seedId = await this.host.keystore.deriveAt("m/28784'/1'/0'/0")

    return {
      txns: [
        {
          to: preparedDepositTarget,
          value: 1n,
          data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(uint256)', [
            getPrecommitment(this.seedId as string)
          ])
        }
      ]
    }
  }

  // Proving is not faked: a withdrawal the controller would accept needs a signed userOp, and what
  // the tests check is what happens before one is asked for
  async prepareUnshield() {
    this.syncCountWhenProving = this.syncCount
    throw new Error('prepareUnshield is not faked')
  }

  async notes() {
    return (notesBySeed[this.seedId as string] || []).map((note) => ({
      label: note.label,
      assetAddress: 0n,
      balance: note.amount,
      approved: note.approved
    }))
  }
}

jest.mock('@kohaku-eth/privacy-pools', () => ({
  PrivacyPoolsV1Protocol: jest.fn().mockImplementation((host: any) => new FakeProtocol(host)),
  OxBowAspService: jest.fn(),
  createPPv1Broadcaster: jest.fn()
}))

jest.mock('../../libs/privacyPools/dataService', () => ({
  createPrivacyPoolsDataService: jest.fn(async () => ({ dataService: {}, isSagaHydrated: false }))
}))

class FakeKeystore extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  isUnlocked = true

  seeds: { id: string }[] = [{ id: 'seed-a' }, { id: 'seed-b' }]

  keys = []

  // The fake plugin learns its phrase from the "key" it derives
  derivePrivacyPoolsKey = jest.fn(async (seedId: string) => seedId)

  fireUpdate() {
    this.emitUpdate()
  }
}

class FakeSelectedAccount extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  account = null

  privacyPoolsAccountId: string | null = null

  select(seedId: string | null) {
    this.privacyPoolsAccountId = seedId
    this.emitUpdate()
  }
}

class FakeNetworks extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  networks = [{ chainId: 1n, nativeAssetId: 'ethereum', platformId: 'ethereum' }]
}

/** Answers the price service like it would: ETH by its id, tokens by their lowercase address. */
const fakeFetch = jest.fn(async (url: string) => ({
  ok: true,
  json: async () =>
    url.includes('/simple/price')
      ? { ethereum: { usd: 3000 } }
      : { [USDC]: { usd: 1 }, '0xdac17f958d2ee523a2206206994597c13d831ec7': { usd: 1 } }
}))

/** Answers the only two reads a deposit makes: the entrypoint's asset config and an allowance. */
const fakeProviderCall = async ({ data }: { to: string; data: string }) => {
  if (data.startsWith(ENTRYPOINT_INTERFACE.getFunction('assetConfig')!.selector)) {
    const [asset] = ENTRYPOINT_INTERFACE.decodeFunctionData('assetConfig', data)

    return ENTRYPOINT_INTERFACE.encodeFunctionResult('assetConfig', [
      // The Ethereum ETH pool, which the paymaster has an adapter for
      ETHEREUM_ETH_POOL,
      String(asset).toLowerCase() === USDC ? MINIMUM_USDC_DEPOSIT : MINIMUM_DEPOSIT,
      50n,
      100n
    ])
  }

  return ERC20_INTERFACE.encodeFunctionResult('allowance', [allowance])
}

class FakeProviders extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  providers = { '1': { getNetwork: async () => ({ chainId: 1n }), call: fakeProviderCall } }
}

const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

const waitUntil = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return

    await flush()
  }

  throw new Error('waitUntil: condition was never met')
}

const releaseSync = async (seedId: string) => {
  await waitUntil(() => runningSyncs.some((sync) => sync.seedId === seedId))
  const running = runningSyncs.find((sync) => sync.seedId === seedId) as RunningSync
  runningSyncs = runningSyncs.filter((sync) => sync !== running)
  running.gate.resolve()
}

const prepareTest = async ({
  accounts = ['seed-a', 'seed-b'],
  // Passed to start again from what an earlier controller left in storage, as after a restart
  storage = new StorageController(produceMemoryStore())
}: { accounts?: string[]; storage?: StorageController } = {}) => {
  await storage.set(
    'privacyPoolsAccounts',
    accounts.map((seedId) => ({ seedId, createdAt: 1 }))
  )

  const keystore = new FakeKeystore()
  const selectedAccount = new FakeSelectedAccount()
  const onAccountsRemoved = jest.fn<(seedIds: string[]) => Promise<void>>(async () => {})

  const controller = new PrivacyPoolsController({
    keystore: keystore as unknown as IKeystoreController,
    networks: new FakeNetworks() as unknown as INetworksController,
    providers: new FakeProviders() as unknown as IProvidersController,
    selectedAccount: selectedAccount as unknown as ISelectedAccountController,
    storage,
    fetch: fakeFetch as any,
    circuitsBaseUrl: '',
    onAccountsRemoved
  })
  await controller.initialLoadPromise

  return { controller, keystore, selectedAccount, storage, onAccountsRemoved }
}

describe('PrivacyPoolsController', () => {
  beforeEach(() => {
    protocols.length = 0
    runningSyncs = []
    depositCountBySeed = {}
    allowance = 0n
    fakeFetch.mockClear()
    preparedDepositTarget = ETHEREUM_ENTRYPOINT
    notesBySeed = {
      'seed-a': [{ label: 1n, amount: 10n, approved: true }],
      'seed-b': [{ label: 2n, amount: 20n, approved: false }]
    }
  })

  describe('accounts', () => {
    it('adds an account for a stored recovery phrase and persists it', async () => {
      const { controller, storage } = await prepareTest({ accounts: [] })

      await controller.addAccount('seed-a')

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-a'])
      expect((await storage.get('privacyPoolsAccounts', [])).map((a) => a.seedId)).toEqual([
        'seed-a'
      ])
    })

    it('refuses a second account for the same recovery phrase', async () => {
      const { controller } = await prepareTest({ accounts: ['seed-a'] })

      await expect(controller.addAccount('seed-a')).rejects.toThrow(EmittableError)
      expect(controller.accounts).toHaveLength(1)
    })

    it('refuses an account for a recovery phrase the wallet does not have', async () => {
      const { controller } = await prepareTest({ accounts: [] })

      await expect(controller.addAccount('seed-unknown')).rejects.toThrow(EmittableError)
      expect(controller.accounts).toHaveLength(0)
    })

    it('reports a removed account so the selection can move off it', async () => {
      const { controller, onAccountsRemoved } = await prepareTest()

      await controller.removeAccount('seed-a')

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-b'])
      expect(onAccountsRemoved).toHaveBeenCalledWith(['seed-a'])
    })

    it('removes the account of a deleted recovery phrase, with its activity', async () => {
      const { controller, keystore, storage, onAccountsRemoved } = await prepareTest()
      await storage.set('privacyPoolsActivity', [
        { id: 'a', seedId: 'seed-a' } as any,
        { id: 'b', seedId: 'seed-b' } as any
      ])

      keystore.seeds = [{ id: 'seed-b' }]
      keystore.fireUpdate()
      await waitUntil(() => onAccountsRemoved.mock.calls.length > 0)

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-b'])
      expect(onAccountsRemoved).toHaveBeenCalledWith(['seed-a'])
    })

    it('drops accounts whose recovery phrase is gone already on load', async () => {
      const storage = new StorageController(produceMemoryStore())
      await storage.set('privacyPoolsAccounts', [
        { seedId: 'seed-a', createdAt: 1 },
        { seedId: 'seed-gone', createdAt: 1 }
      ])
      const controller = new PrivacyPoolsController({
        keystore: new FakeKeystore() as unknown as IKeystoreController,
        networks: new FakeNetworks() as unknown as INetworksController,
        providers: new FakeProviders() as unknown as IProvidersController,
        selectedAccount: new FakeSelectedAccount() as unknown as ISelectedAccountController,
        storage,
        fetch: fakeFetch as any,
        circuitsBaseUrl: '',
        onAccountsRemoved: jest.fn(async () => {})
      })
      await controller.initialLoadPromise

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-a'])
    })
  })

  describe('selection', () => {
    it('is unavailable until a Privacy Pools account is selected', async () => {
      const { controller, selectedAccount } = await prepareTest()

      expect(controller.unavailableReason).toBe('no-account')
      await expect(controller.syncChain('1')).rejects.toThrow(EmittableError)

      selectedAccount.select('seed-a')

      expect(controller.unavailableReason).toBeNull()
    })

    it('is unavailable for a selected phrase that has no Privacy Pools account', async () => {
      const { controller, selectedAccount } = await prepareTest({ accounts: ['seed-b'] })

      selectedAccount.select('seed-a')

      expect(controller.unavailableReason).toBe('no-account')
    })

    it('asks to unlock only once an account is selected', async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()
      keystore.isUnlocked = false

      expect(controller.unavailableReason).toBe('no-account')

      selectedAccount.select('seed-a')

      expect(controller.unavailableReason).toBe('locked')
    })
  })

  describe('sync queue', () => {
    it('runs syncs of two recovery phrases one after the other', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      await waitUntil(() => runningSyncs.length === 1)
      await flush()
      // The second phrase waits for the first one's sync to finish
      expect(runningSyncs.map((sync) => sync.seedId)).toEqual(['seed-a'])

      await releaseSync('seed-a')
      await syncA
      await releaseSync('seed-b')
      await syncB

      expect(controller.chains['1']?.notes.map((note) => note.label)).toEqual([2n])
      selectedAccount.select('seed-a')
      expect(controller.chains['1']?.notes.map((note) => note.label)).toEqual([1n])
    })

    it('joins a sync already queued for the same network and phrase', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const first = controller.syncChain('1')
      const second = controller.syncChain('1')

      await releaseSync('seed-a')
      await Promise.all([first, second])

      expect(protocols.reduce((total, protocol) => total + protocol.syncCount, 0)).toBe(1)
    })

    it('keeps the network syncing for every account until the last queued sync is done', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      // The very first read of the network, whichever phrase triggered it
      await waitUntil(() => controller.chains['1']?.syncStatus === 'initializing')

      await releaseSync('seed-a')
      await syncA
      // The second phrase reads a network that is no longer cold
      await waitUntil(() => runningSyncs.length === 1)
      expect(controller.chains['1']?.syncStatus).toBe('syncing')

      await releaseSync('seed-b')
      await syncB
      expect(controller.chains['1']?.syncStatus).toBe('ready')
    })

    it('rebuilds a plugin once another phrase has persisted newer history', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const firstA = controller.syncChain('1')
      await releaseSync('seed-a')
      await firstA

      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')
      await releaseSync('seed-b')
      await syncB

      selectedAccount.select('seed-a')
      const secondA = controller.syncChain('1')
      await releaseSync('seed-a')
      await secondA

      expect(protocols.filter((protocol) => protocol.seedId === 'seed-a')).toHaveLength(2)
    })

    it('keeps notes across account switches without syncing again', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncA

      selectedAccount.select('seed-b')
      expect(controller.chains['1']?.notes).toEqual([])
      selectedAccount.select('seed-a')

      expect(controller.chains['1']?.notes.map((note) => note.label)).toEqual([1n])
      expect(protocols).toHaveLength(1)
    })

    it('does not bring back notes when a sync finishes after a lock', async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      keystore.isUnlocked = false
      keystore.fireUpdate()
      await releaseSync('seed-a')
      await syncA

      keystore.isUnlocked = true
      keystore.fireUpdate()
      expect(controller.chains['1']?.notes).toEqual([])
      expect(controller.chains['1']?.lastSyncedAt).toBeNull()
      expect(controller.chains['1']?.syncStatus).toBe('idle')
    })

    it('does not write notes for an account removed while it was syncing', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      await controller.removeAccount('seed-a')
      await releaseSync('seed-a')
      await syncA

      // Added back, it starts with nothing until it is synced again
      await controller.addAccount('seed-a')
      expect(controller.chains['1']?.notes).toEqual([])
      expect(controller.chains['1']?.lastSyncedAt).toBeNull()
    })

    it('lets the syncs behind a failed one run', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      await waitUntil(() => runningSyncs.length === 1)
      const [running] = runningSyncs
      runningSyncs = []
      running!.gate.reject(new Error('RPC is down'))
      await syncA

      await releaseSync('seed-b')
      await syncB
      expect(controller.chains['1']?.notes.map((note) => note.label)).toEqual([2n])
    })
  })
  describe('network statuses', () => {
    it('tells the first read of a network from later ones, with how long each took', async () => {
      const { controller, selectedAccount } = await prepareTest()
      let clock = 1_000
      const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)

      try {
        selectedAccount.select('seed-a')
        const syncA = controller.syncChain('1')
        await waitUntil(() => runningSyncs.length === 1)
        expect(controller.chains['1']?.isInitialSyncDone).toBe(false)

        clock = 61_000
        await releaseSync('seed-a')
        await syncA
        expect(controller.chains['1']).toMatchObject({
          isInitialSyncDone: true,
          initialSyncDuration: 60_000,
          lastSyncDuration: 60_000
        })

        selectedAccount.select('seed-b')
        const syncB = controller.syncChain('1')
        await waitUntil(() => runningSyncs.length === 1)
        clock = 63_000
        await releaseSync('seed-b')
        await syncB

        // The second phrase only read what was new, and the first read is still the first read
        expect(controller.chains['1']).toMatchObject({
          initialSyncDuration: 60_000,
          lastSyncDuration: 2_000
        })
        selectedAccount.select('seed-a')
        expect(controller.chains['1']?.lastSyncDuration).toBe(60_000)
      } finally {
        now.mockRestore()
      }
    })

    it('says a network never read before is in for its first read while it still waits its turn', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncEthereum = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)
      // Queued behind the one running, on a network whose history is not stored either
      const syncSepolia = controller.syncChain('11155111')

      await waitUntil(() => controller.chains['11155111']?.isInitialSyncDone === false)
      expect(controller.chains['11155111']?.syncStatus).toBe('syncing')

      await releaseSync('seed-a')
      await Promise.all([syncEthereum, syncSepolia])
    })

    it('keeps what it knows about a network through a lock', async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncA
      const { initialSyncDuration } = controller.chains['1']!

      keystore.isUnlocked = false
      keystore.fireUpdate()
      keystore.isUnlocked = true
      keystore.fireUpdate()

      expect(controller.chains['1']).toMatchObject({
        isInitialSyncDone: true,
        initialSyncDuration,
        // The phrase's own sync went with the lock
        lastSyncDuration: null
      })
    })

    it('knows a network read before a restart has been read, without timing a first read', async () => {
      const { controller: before, selectedAccount: selectedBefore, storage } = await prepareTest()
      selectedBefore.select('seed-a')
      const firstSync = before.syncChain('1')
      await releaseSync('seed-a')
      await firstSync

      const { controller, selectedAccount } = await prepareTest({ storage })
      selectedAccount.select('seed-a')
      const sync = controller.syncChain('1')
      await waitUntil(() => controller.chains['1']?.isInitialSyncDone === true)
      expect(controller.chains['1']?.syncStatus).toBe('syncing')

      await releaseSync('seed-a')
      await sync
      expect(controller.chains['1']?.initialSyncDuration).toBeNull()
    })

    it('does not count a failed first read as done', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)
      const [running] = runningSyncs
      runningSyncs = []
      running!.gate.reject(new Error('RPC is down'))
      await syncA

      expect(controller.chains['1']).toMatchObject({
        isInitialSyncDone: false,
        initialSyncDuration: null,
        lastSyncDuration: null
      })
    })
  })

  describe('deposits', () => {
    const ONE_ETH = 10n ** 18n

    const buildDeposit = (
      controller: PrivacyPoolsController,
      overrides: Partial<Parameters<PrivacyPoolsController['buildDepositCalls']>[0]> = {}
    ) =>
      controller.buildDepositCalls({
        seedId: 'seed-b',
        accountAddr: DEPOSITOR,
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: ONE_ETH,
        ...overrides
      })

    it('builds a deposit into an account that is not the selected one, after syncing it', async () => {
      const { controller } = await prepareTest()

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building

      expect(calls).toEqual([
        {
          to: ETHEREUM_ENTRYPOINT,
          value: ONE_ETH,
          data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(uint256)', [
            getPrecommitment('seed-b')
          ])
        }
      ])
    })

    it('derives the precommitment once for every amount typed', async () => {
      const { controller } = await prepareTest()

      const first = buildDeposit(controller)
      await releaseSync('seed-b')
      await first
      const [secondCall] = await buildDeposit(controller, { amount: 2n * ONE_ETH })

      expect(secondCall?.value).toBe(2n * ONE_ETH)
      expect(protocols.reduce((total, protocol) => total + protocol.prepareShieldCount, 0)).toBe(1)
      expect(protocols.reduce((total, protocol) => total + protocol.syncCount, 0)).toBe(1)
    })

    it('refuses amounts Privacy Pools does not accept', async () => {
      const { controller } = await prepareTest()

      await expect(buildDeposit(controller, { amount: MINIMUM_DEPOSIT - 1n })).rejects.toThrow(
        EmittableError
      )
      await expect(buildDeposit(controller, { amount: 10_001n * ONE_ETH })).rejects.toThrow(
        EmittableError
      )
      await expect(
        buildDeposit(controller, { tokenAddress: '0x0000000000000000000000000000000000000abc' })
      ).rejects.toThrow(EmittableError)
    })

    it('refuses a deposit into an account the wallet does not have', async () => {
      const { controller } = await prepareTest({ accounts: ['seed-a'] })

      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)
      expect(runningSyncs).toHaveLength(0)
    })

    it('refuses a prepared deposit that goes anywhere but the entrypoint, and retries after', async () => {
      const { controller } = await prepareTest()
      preparedDepositTarget = '0x000000000000000000000000000000000000dEaD'

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      await expect(building).rejects.toThrow(EmittableError)

      preparedDepositTarget = ETHEREUM_ENTRYPOINT
      const retrying = buildDeposit(controller)
      await releaseSync('seed-b')
      await expect(retrying).resolves.toHaveLength(1)
    })

    it('prepends an approval only when the allowance does not cover an ERC-20', async () => {
      const { controller } = await prepareTest()
      const amount = 5n * 10n ** 6n

      const building = buildDeposit(controller, { tokenAddress: USDC, amount })
      await releaseSync('seed-b')
      const withApproval = await building

      expect(withApproval).toEqual([
        {
          // The configured asset address, which is checksummed
          to: getPrivacyPoolsAsset(1n, USDC)!.address,
          value: 0n,
          data: ERC20_INTERFACE.encodeFunctionData('approve', [ETHEREUM_ENTRYPOINT, amount])
        },
        {
          to: ETHEREUM_ENTRYPOINT,
          value: 0n,
          data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(address,uint256,uint256)', [
            USDC,
            amount,
            getPrecommitment('seed-b')
          ])
        }
      ])

      allowance = amount
      await expect(buildDeposit(controller, { tokenAddress: USDC, amount })).resolves.toHaveLength(
        1
      )
    })

    it('records a broadcast deposit with its sender and refuses another until the chain moves on', async () => {
      const { controller, selectedAccount } = await prepareTest()

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building
      await controller.onAccountOpBroadcast({
        accountAddr: DEPOSITOR,
        chainId: 1n,
        calls,
        txnId: '0xabc'
      })

      selectedAccount.select('seed-b')
      expect(controller.activity).toMatchObject([
        {
          type: 'deposit',
          seedId: 'seed-b',
          depositor: DEPOSITOR,
          amount: ONE_ETH,
          tokenAddress: ZERO_ADDRESS,
          isNative: true,
          status: 'pending',
          txnId: '0xabc'
        }
      ])
      // Same precommitment, since the first one has not landed
      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)

      // It lands, and the next sync moves the precommitment on
      depositCountBySeed['seed-b'] = 1
      const syncing = controller.syncChain('1')
      await releaseSync('seed-b')
      await syncing
      const next = buildDeposit(controller)
      await releaseSync('seed-b')
      await expect(next).resolves.toHaveLength(1)
    })

    it('settles a recorded deposit once the account op it went out in has an outcome', async () => {
      const { controller, selectedAccount } = await prepareTest()
      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building
      await controller.onAccountOpBroadcast({
        id: 'account-op-1',
        accountAddr: DEPOSITOR,
        chainId: 1n,
        calls
      })
      selectedAccount.select('seed-b')

      // Still on its way: nothing to settle yet
      await controller.onAccountOpStatusUpdate({
        id: 'account-op-1',
        status: AccountOpStatus.BroadcastedButNotConfirmed
      })
      expect(controller.activity[0]?.status).toBe('pending')

      // Another account op says nothing about this deposit
      await controller.onAccountOpStatusUpdate({
        id: 'account-op-2',
        status: AccountOpStatus.Success
      })
      expect(controller.activity[0]?.status).toBe('pending')

      await controller.onAccountOpStatusUpdate({
        id: 'account-op-1',
        status: AccountOpStatus.Failure
      })
      expect(controller.activity[0]?.status).toBe('failed')
      // Settled once: a later status does not reopen it
      await controller.onAccountOpStatusUpdate({
        id: 'account-op-1',
        status: AccountOpStatus.Success
      })
      expect(controller.activity[0]?.status).toBe('failed')
    })

    it('ignores deposits it did not prepare', async () => {
      const { controller, selectedAccount } = await prepareTest()

      await controller.onAccountOpBroadcast({
        accountAddr: DEPOSITOR,
        chainId: 1n,
        calls: [
          {
            to: ETHEREUM_ENTRYPOINT,
            value: ONE_ETH,
            data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(uint256)', [123n])
          }
        ]
      })

      selectedAccount.select('seed-b')
      expect(controller.activity).toEqual([])
    })
  })
  describe('sending from a Privacy Pools account', () => {
    it('refuses to prove a transfer to something that is not an address', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      await expect(
        controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          amount: 10n ** 17n,
          recipient: 'vitalik'
        })
      ).rejects.toThrow(EmittableError)
      await expect(
        controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          amount: 10n ** 17n,
          recipient: ZERO_ADDRESS
        })
      ).rejects.toThrow(EmittableError)

      expect(controller.operation).toBeNull()
      expect(runningSyncs).toHaveLength(0)
    })

    it('syncs the account through the queue before proving', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const preparing = controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: 10n ** 17n,
        recipient: WITHDRAWAL_RECIPIENT
      })
      await releaseSync('seed-a')
      await preparing

      const [protocol] = protocols
      expect(protocol?.syncCountWhenProving).toBe(1)
      // Proving itself failed, which leaves the transfer failed with a sentence for the user
      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.'
      })
    })
  })
  describe('prices', () => {
    it('prices every asset the pools accept, not only those held, when syncing', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing
      await waitUntil(() => Object.keys(controller.prices).length > 0)

      expect(controller.prices).toMatchObject({
        [`1:${ZERO_ADDRESS}`]: 3000,
        [`1:${USDC}`]: 1,
        '1:0xdac17f958d2ee523a2206206994597c13d831ec7': 1
      })
      const tokenPriceUrl = fakeFetch.mock.calls
        .map(([url]) => url)
        .find((url) => url.includes('/token_price/'))
      // Every configured token of the chain is asked for, so the request reveals no holdings
      getPrivacyPoolsChainConfig(1n)!
        .assets.filter(({ isNative }) => !isNative)
        .forEach(({ address }) => expect(tokenPriceUrl).toContain(address.toLowerCase()))
    })

    it('does not ask again while the prices are fresh', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const first = controller.syncChain('1')
      await releaseSync('seed-a')
      await first
      await waitUntil(() => Object.keys(controller.prices).length > 0)
      const requestsAfterFirst = fakeFetch.mock.calls.length

      const second = controller.syncChain('1')
      await releaseSync('seed-a')
      await second

      expect(fakeFetch.mock.calls.length).toBe(requestsAfterFirst)
    })
  })
})
