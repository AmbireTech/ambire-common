import { AbiCoder, Interface, toBeHex, ZeroHash } from 'ethers'
import { EventEmitter as NodeEventEmitter } from 'events'

import { expect, jest } from '@jest/globals'
import { createPPv1Broadcaster } from '@kohaku-eth/privacy-pools'

import { produceMemoryStore } from '../../../test/helpers'
import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsStoreKey
} from '../../consts/privacyPools'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IUiController, View } from '../../interfaces/ui'
import { IrCall } from '../../libs/humanizer/interfaces'
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover'
import { POOL_RAGEQUIT_INTERFACE } from '../../libs/privacyPools/ragequit'
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

const ETHEREUM_PAYMASTER = getPrivacyPoolsChainConfig(1n)!.paymaster!
const WITHDRAWAL_AMOUNT = 10n ** 17n
const WITHDRAWAL_FEE = 2n * 10n ** 15n
const WITHDRAWAL_REFUND = 12n * 10n ** 14n
/** Where `eth_simulateV1` reports native transfers when asked to trace them. */
const SIMULATED_NATIVE_TRANSFERS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const SIMULATION_LOGS_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
])

const WITHDRAWAL_SENDER = '0xA3a4D83896ec4b595668fA3d5430157cd235F720'

/** A pool's ragequit the way the SDK encodes it, public signals `[commitment, nullifierHash, value, label]`. */
const encodeRagequit = (amount: bigint, label: bigint) =>
  POOL_RAGEQUIT_INTERFACE.encodeFunctionData('ragequit', [
    {
      pA: [1n, 2n],
      pB: [
        [3n, 4n],
        [5n, 6n]
      ],
      pC: [7n, 8n],
      pubSignals: [11n, 12n, amount, label]
    }
  ])

const toFakeProof = (withdrawnValue: bigint) => ({
  pA: [1n, 2n],
  pB: [
    [3n, 4n],
    [5n, 6n]
  ],
  pC: [7n, 8n],
  pubSignals: [11n, 12n, withdrawnValue, 14n, 15n, 16n, 17n, 18n]
})

/**
 * What a batch of two deposits runs once the larger one is paid to the sender: the sender withdraws
 * the other one itself, then forwards everything minus the fee.
 */
const encodeBatchCalls = (sponsoredValue: bigint) =>
  new Interface([
    'function executeBatch((address target, uint256 value, bytes data)[] calls)'
  ]).encodeFunctionData('executeBatch', [
    [
      {
        target: ETHEREUM_ETH_POOL,
        value: 0n,
        data: new Interface([
          'function withdraw((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
        ]).encodeFunctionData('withdraw', [
          { processooor: WITHDRAWAL_SENDER, data: '0x' },
          toFakeProof(WITHDRAWAL_AMOUNT - sponsoredValue)
        ])
      },
      { target: WITHDRAWAL_RECIPIENT, value: WITHDRAWAL_AMOUNT - WITHDRAWAL_FEE, data: '0x' }
    ]
  ])

/**
 * A proved withdrawal the way the SDK hands it over, with the fee, recipient and amount encoded
 * where `readPaymasterWithdrawal` checks them. The proof itself is never verified off chain.
 *
 * As a batch, it spends two deposits: the sponsored one is paid to the sender, which forwards it.
 * The unused gas is refunded to the recipient either way.
 */
const buildPreparedWithdrawal = ({ isBatch = false }: { isBatch?: boolean } = {}) => {
  const coder = AbiCoder.defaultAbiCoder()
  const adapter = ETHEREUM_PAYMASTER.poolAdapters[ETHEREUM_ETH_POOL]!
  const sponsoredValue = isBatch ? (WITHDRAWAL_AMOUNT * 3n) / 5n : WITHDRAWAL_AMOUNT
  const feeData = coder.encode(
    ['tuple(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'],
    [
      {
        recipient: isBatch ? WITHDRAWAL_SENDER : WITHDRAWAL_RECIPIENT,
        feeRecipient: ETHEREUM_PAYMASTER.paymasterAddress,
        fee: WITHDRAWAL_FEE,
        refundRecipient: WITHDRAWAL_RECIPIENT
      }
    ]
  )
  const adapterData = coder.encode(
    [
      'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
    ],
    [
      {
        withdrawal: { processooor: adapter, data: feeData },
        proof: toFakeProof(sponsoredValue)
      }
    ]
  )

  return {
    mode: 'paymaster',
    withdrawal: {
      poolAddress: BigInt(ETHEREUM_ETH_POOL),
      paymasterAddress: ETHEREUM_PAYMASTER.paymasterAddress,
      entryPointAddress: ETHEREUM_PAYMASTER.entryPointAddress,
      userOperation: {
        sender: WITHDRAWAL_SENDER,
        nonce: '0x0',
        callData: isBatch ? encodeBatchCalls(sponsoredValue) : '0x',
        callGasLimit: isBatch ? toBeHex(580_000n) : '0x0',
        verificationGasLimit: toBeHex(50_000n),
        preVerificationGas: toBeHex(100_000n),
        maxFeePerGas: toBeHex(10n ** 9n),
        maxPriorityFeePerGas: toBeHex(10n ** 8n),
        paymaster: ETHEREUM_PAYMASTER.paymasterAddress,
        paymasterVerificationGasLimit: toBeHex(1_200_000n),
        paymasterPostOpGasLimit: toBeHex(50_000n),
        paymasterData: coder.encode(
          ['tuple(address adapter, bytes adapterData)'],
          [{ adapter, adapterData }]
        ),
        signature: `0x${'11'.repeat(65)}`,
        eip7702Auth: { address: '0xe6Cae83BdE06E4c305530e199D7217f42808555B' }
      }
    }
  }
}

/**
 * What a node answers when it runs that withdrawal and the paymaster refunds part of the fee - to
 * the recipient, unless another address is given.
 */
const successfulSimulation = (
  refundRecipient = WITHDRAWAL_RECIPIENT,
  refund = WITHDRAWAL_REFUND
) => [
  {
    calls: [
      {
        status: '0x1',
        logs: [
          {
            address: SIMULATED_NATIVE_TRANSFERS,
            ...SIMULATION_LOGS_INTERFACE.encodeEventLog('Transfer', [
              ETHEREUM_PAYMASTER.paymasterAddress,
              refundRecipient,
              refund
            ])
          },
          {
            address: ETHEREUM_PAYMASTER.entryPointAddress,
            ...SIMULATION_LOGS_INTERFACE.encodeEventLog('UserOperationEvent', [
              ZeroHash,
              WITHDRAWAL_SENDER,
              ETHEREUM_PAYMASTER.paymasterAddress,
              0n,
              true,
              1n,
              1n
            ])
          }
        ]
      }
    ]
  }
]

/** How many deposits each phrase has on chain - what its next precommitment follows from. */
let depositCountBySeed: { [seedId: string]: number } = {}
let allowance = 0n
let preparedDepositTarget = ETHEREUM_ENTRYPOINT

const getPrecommitment = (seedId: string) =>
  BigInt(seedId.length * 1000 + (depositCountBySeed[seedId] || 0))

const protocols: FakeProtocol[] = []
let runningSyncs: RunningSync[] = []
let notesBySeed: {
  [seedId: string]: {
    label: bigint
    amount: bigint
    approved: boolean
    assetAddress?: bigint
    /** `DEPOSITOR` when not set. */
    depositor?: string
    /** The account's deposit number, 0 when not set. */
    deposit?: number
  }[]
} = {}
/** What `ragequit` returns instead of a call for every note asked for, when set. */
let ragequitTxns: { to: string; data: string; value: bigint }[] | null = null
/** Holds `ragequit` until the test releases it, when set. */
let ragequitGate: Deferred | null = null
/** What `prepareUnshield` returns, or null for it to fail like proving did. */
let preparedWithdrawal: ReturnType<typeof buildPreparedWithdrawal> | null = null
/** What `prepareUnshield` throws instead, when set - the SDK's thunks throw plain objects, not `Error`s. */
let prepareUnshieldFailure: unknown = null
/** Whether `prepareUnshield` proves through the controller's prover first, as the SDK does. */
let isProvingOnUnshield = false
/** The latest block's base fee. A proved withdrawal signs 1 gwei as its most per gas. */
let latestBaseFee = 10n ** 8n
/** How the node answers `eth_simulateV1`. */
let simulateWithdrawal: () => Promise<unknown> = async () => successfulSimulation()
let rpcNoStateOverride = false
/** The pool the entrypoint lists for any asset. */
let entrypointPool = ETHEREUM_ETH_POOL

class FakeProtocol {
  host: any

  seedId: string | null = null

  syncCount = 0

  prepareShieldCount = 0

  /** How many syncs this plugin had done when it was asked to prove - see `prepareUnshield`. */
  syncCountWhenProving: number | null = null

  /** The options it was last asked to prove with. */
  unshieldOptions: unknown = null

  /** What the controller constructed it with - the prover factory among them. */
  params: any

  constructor(host: any, params: any) {
    this.host = host
    this.params = params
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

  ragequitLabels: bigint[][] = []

  // The real one syncs first and proves each note with the 'commitment' circuit
  async ragequit(labels: bigint[]) {
    this.ragequitLabels.push(labels)
    const prover = await this.params.proverFactory()
    await prover.prove('commitment', { value: 1n })
    if (ragequitGate) await ragequitGate.promise
    if (ragequitTxns) return { txns: ragequitTxns }

    const notes = notesBySeed[this.seedId as string] || []
    return {
      txns: notes
        .filter((note) => labels.includes(note.label))
        .map((note) => ({
          to: ETHEREUM_ETH_POOL,
          value: 0n,
          data: encodeRagequit(note.amount, note.label)
        }))
    }
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

  // Proving is not faked: unless a test hands it a signed withdrawal, this fails the way proving
  // would, for tests that check what happens before one is asked for
  async prepareUnshield(_assets: unknown, _to: unknown, options: unknown) {
    this.syncCountWhenProving = this.syncCount
    this.unshieldOptions = options
    if (isProvingOnUnshield) {
      const prover = await this.params.proverFactory()
      await prover.prove('withdraw', { existingSecret: 1n })
    }
    if (prepareUnshieldFailure) throw prepareUnshieldFailure
    if (preparedWithdrawal) return preparedWithdrawal

    throw new Error('prepareUnshield is not faked')
  }

  // The real one syncs before every read, so the fake does too: a controller that also calls
  // `sync()` itself is caught by the sync counts
  async notes() {
    await this.sync()

    return (notesBySeed[this.seedId as string] || []).map((note) => ({
      label: note.label,
      assetAddress: note.assetAddress ?? 0n,
      balance: note.amount,
      approved: note.approved,
      depositor: BigInt(note.depositor ?? DEPOSITOR),
      deposit: note.deposit ?? 0
    }))
  }
}

jest.mock('@kohaku-eth/privacy-pools', () => ({
  PrivacyPoolsV1Protocol: jest
    .fn()
    .mockImplementation((host: any, params: any) => new FakeProtocol(host, params)),
  OxBowAspService: jest.fn(),
  createPPv1Broadcaster: jest.fn()
}))

jest.mock('../../libs/privacyPools/dataService', () => ({
  createPrivacyPoolsDataService: jest.fn(async () => ({ dataService: {}, isSagaHydrated: false }))
}))

// A second network (10, see `OTHER_CHAIN_ID`), configured like Ethereum, so tests can tell what
// runs per network. Supported only where `prepareTest` adds it to the user's networks.
jest.mock('../../consts/privacyPools', () => {
  const actual = jest.requireActual<typeof import('../../consts/privacyPools')>(
    '../../consts/privacyPools'
  )
  // The actual lookups read this same object, so they find it too
  actual.PRIVACY_POOLS_CHAINS['10'] = { ...actual.PRIVACY_POOLS_CHAINS['1']!, chainId: 10n }

  return {
    ...actual,
    PRIVACY_POOLS_SUPPORTED_CHAIN_IDS: [...actual.PRIVACY_POOLS_SUPPORTED_CHAIN_IDS, 10n]
  }
})

const OTHER_CHAIN_ID = 10n

class FakeKeystore extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  isUnlocked = true

  areSeedsLoaded = true

  seeds: { id: string; notBackedUp?: boolean }[] = [{ id: 'seed-a' }, { id: 'seed-b' }]

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

/** Reports views and their routes like `UiController`: a closed view is gone before the event. */
class FakeUi {
  views: View[] = []

  uiEvent = new NodeEventEmitter()

  message = { sendUiMessage: jest.fn() }

  open(id: string, type: View['type'], route: string) {
    this.views.push({ id, type, currentRoute: route })
  }

  navigate(id: string, route: string, searchParams?: View['searchParams']) {
    const view = this.views.find((v) => v.id === id) as View
    view.previousRoute = view.currentRoute
    view.currentRoute = route
    view.searchParams = searchParams
    this.uiEvent.emit('updateView', view)
  }

  close(id: string) {
    const view = this.views.find((v) => v.id === id) as View
    this.views = this.views.filter((v) => v !== view)
    this.uiEvent.emit('removeView', view)
  }
}

class FakeFeatureFlags extends EventEmitter {
  flags: { [flag: string]: boolean } = { tokenPrices: true, erc4337: true }

  isFeatureEnabled(flag: string) {
    return this.flags[flag]
  }

  set(flag: string, value: boolean) {
    this.flags[flag] = value
    this.emitUpdate()
  }
}

class FakeNetworks extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  networks = [
    { chainId: 1n, nativeAssetId: 'ethereum', platformId: 'ethereum', rpcNoStateOverride }
  ]
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
      // The Ethereum ETH pool by default, which the paymaster has an adapter for
      entrypointPool,
      String(asset).toLowerCase() === USDC ? MINIMUM_USDC_DEPOSIT : MINIMUM_DEPOSIT,
      50n,
      100n
    ])
  }

  return ERC20_INTERFACE.encodeFunctionResult('allowance', [allowance])
}

const createFakeProvider = (chainId: bigint) => ({
  getNetwork: async () => ({ chainId }),
  call: fakeProviderCall,
  getBlock: async () => ({ baseFeePerGas: latestBaseFee }),
  send: jest.fn(async (method: string) => {
    if (method === 'eth_simulateV1') return simulateWithdrawal()

    throw new Error(`FakeProviders: ${method} is not faked`)
  })
})

type FakeProvider = ReturnType<typeof createFakeProvider>

class FakeProviders extends EventEmitter {
  initialLoadPromise = Promise.resolve()

  providers: { [chainId: string]: FakeProvider; '1': FakeProvider } = {
    '1': createFakeProvider(1n)
  }
}

const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

/** What the selected account holds on Ethereum, per token - seed-a holds 10, seed-b 20. */
const getHeldAmounts = (controller: PrivacyPoolsController) =>
  (controller.balances['1'] || []).map(({ totalAmount }) => totalAmount)

const waitUntil = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return

    await flush()
  }

  throw new Error('waitUntil: condition was never met')
}

/** Takes the running sync of that phrase on that network out of `runningSyncs`, once it runs. */
const takeRunningSync = async (seedId: string, chainId: bigint) => {
  const isIt = (sync: RunningSync) => sync.seedId === seedId && sync.chainId === chainId
  await waitUntil(() => runningSyncs.some(isIt))
  const running = runningSyncs.find(isIt) as RunningSync
  runningSyncs = runningSyncs.filter((sync) => sync !== running)

  return running
}

const releaseSync = async (seedId: string, chainId = 1n) => {
  const running = await takeRunningSync(seedId, chainId)
  running.gate.resolve()
}

const prepareTest = async ({
  accounts = ['seed-a', 'seed-b'],
  // Passed to start again from what an earlier controller left in storage, as after a restart
  storage = new StorageController(produceMemoryStore()),
  proverFactory,
  // Adds `OTHER_CHAIN_ID` to the user's networks, with a provider
  hasOtherChain = false
}: {
  accounts?: string[]
  storage?: StorageController
  proverFactory?: PrivacyPoolsProverFactory
  hasOtherChain?: boolean
} = {}) => {
  await storage.set(
    'privacyPoolsAccounts',
    accounts.map((seedId) => ({ seedId, createdAt: 1 }))
  )

  const keystore = new FakeKeystore()
  const featureFlags = new FakeFeatureFlags()
  const selectedAccount = new FakeSelectedAccount()
  const networks = new FakeNetworks()
  const providers = new FakeProviders()
  const ui = new FakeUi()
  const onAccountsRemoved = jest.fn<(seedIds: string[]) => Promise<void>>(async () => {})

  if (hasOtherChain) {
    networks.networks.push({
      chainId: OTHER_CHAIN_ID,
      nativeAssetId: 'ethereum',
      platformId: 'optimistic-ethereum',
      rpcNoStateOverride
    })
    providers.providers[OTHER_CHAIN_ID.toString()] = createFakeProvider(OTHER_CHAIN_ID)
  }

  const controller = new PrivacyPoolsController({
    keystore: keystore as unknown as IKeystoreController,
    featureFlags: featureFlags as unknown as IFeatureFlagsController,
    networks: networks as unknown as INetworksController,
    providers: providers as unknown as IProvidersController,
    selectedAccount: selectedAccount as unknown as ISelectedAccountController,
    storage,
    ui: ui as unknown as IUiController,
    fetch: fakeFetch as any,
    circuitsBaseUrl: '',
    proverFactory,
    onAccountsRemoved
  })
  await controller.initialLoadPromise

  return {
    controller,
    keystore,
    featureFlags,
    selectedAccount,
    providers,
    ui,
    storage,
    onAccountsRemoved
  }
}

describe('PrivacyPoolsController', () => {
  beforeEach(() => {
    protocols.length = 0
    runningSyncs = []
    depositCountBySeed = {}
    allowance = 0n
    fakeFetch.mockClear()
    preparedDepositTarget = ETHEREUM_ENTRYPOINT
    preparedWithdrawal = null
    prepareUnshieldFailure = null
    isProvingOnUnshield = false
    latestBaseFee = 10n ** 8n
    simulateWithdrawal = async () => successfulSimulation()
    rpcNoStateOverride = false
    entrypointPool = ETHEREUM_ETH_POOL
    notesBySeed = {
      'seed-a': [{ label: 1n, amount: 10n, approved: true }],
      'seed-b': [{ label: 2n, amount: 20n, approved: false }]
    }
    ragequitTxns = null
    ragequitGate = null
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

    it('removes the account of a deleted recovery phrase', async () => {
      const { controller, keystore, onAccountsRemoved } = await prepareTest()

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
        featureFlags: new FakeFeatureFlags() as unknown as IFeatureFlagsController,
        networks: new FakeNetworks() as unknown as INetworksController,
        providers: new FakeProviders() as unknown as IProvidersController,
        selectedAccount: new FakeSelectedAccount() as unknown as ISelectedAccountController,
        storage,
        ui: new FakeUi() as unknown as IUiController,
        fetch: fakeFetch as any,
        circuitsBaseUrl: '',
        onAccountsRemoved: jest.fn(async () => {})
      })
      await controller.initialLoadPromise

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-a'])
    })

    it('keeps every account when the recovery phrases could not be read', async () => {
      const storage = new StorageController(produceMemoryStore())
      await storage.set('privacyPoolsAccounts', [{ seedId: 'seed-a', createdAt: 1 }])
      const keystore = new FakeKeystore()
      keystore.areSeedsLoaded = false
      keystore.seeds = []
      const onAccountsRemoved = jest.fn(async () => {})
      const controller = new PrivacyPoolsController({
        keystore: keystore as unknown as IKeystoreController,
        featureFlags: new FakeFeatureFlags() as unknown as IFeatureFlagsController,
        networks: new FakeNetworks() as unknown as INetworksController,
        providers: new FakeProviders() as unknown as IProvidersController,
        selectedAccount: new FakeSelectedAccount() as unknown as ISelectedAccountController,
        storage,
        ui: new FakeUi() as unknown as IUiController,
        fetch: fakeFetch as any,
        circuitsBaseUrl: '',
        onAccountsRemoved
      })
      await controller.initialLoadPromise
      keystore.fireUpdate()

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-a'])
      expect(await storage.get('privacyPoolsAccounts', [])).toHaveLength(1)
      expect(onAccountsRemoved).not.toHaveBeenCalled()
    })
  })

  describe('state sent to the UI', () => {
    it('holds only the public state, nothing derived from a phrase', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')
      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      expect(Object.keys(controller.toJSON()).sort()).toEqual(
        [
          'accounts',
          'balances',
          'chains',
          'depositAssetConfigs',
          'emittedErrors',
          'hasPersistedSendForm',
          'hasSyncedAnyChain',
          'id',
          'initialLoadPromise',
          'isAvailableForSelectedAccount',
          'name',
          'operation',
          'prices',
          'sendForm',
          'sendFormResetCounter',
          'statuses',
          'supportedChainIds',
          'unavailableReason'
        ].sort()
      )
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

    it('updates the UI on a selected account update only when the selection changed', async () => {
      const { controller, selectedAccount } = await prepareTest()
      const onUpdate = jest.fn()
      controller.onUpdate(onUpdate)

      selectedAccount.select('seed-a')
      await flush()
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // A portfolio refresh of the selected account updates it without changing the selection
      selectedAccount.select('seed-a')
      await flush()
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    it('passes no updates on while the wallet has no Privacy Pools account', async () => {
      const { controller, keystore } = await prepareTest({ accounts: [] })
      const onUpdate = jest.fn()
      controller.onUpdate(onUpdate)

      keystore.fireUpdate()
      await flush()

      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('sync queue', () => {
    it("reads a network's shared state once, with the other accounts waiting for that read", async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      await waitUntil(() => runningSyncs.length === 1)
      await flush()
      // The second phrase waits for the first one's read of the network
      expect(runningSyncs.map((sync) => sync.seedId)).toEqual(['seed-a'])

      await releaseSync('seed-a')
      await syncA
      await releaseSync('seed-b')
      await syncB

      expect(getHeldAmounts(controller)).toEqual([20n])
      selectedAccount.select('seed-a')
      expect(getHeldAmounts(controller)).toEqual([10n])
    })

    it('syncs accounts side by side once the network has been read', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const firstA = controller.syncChain('1')
      await releaseSync('seed-a')
      await firstA

      const secondA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      await waitUntil(() => runningSyncs.length === 2)
      expect(runningSyncs.map((sync) => sync.seedId).sort()).toEqual(['seed-a', 'seed-b'])

      await releaseSync('seed-b')
      await syncB
      await releaseSync('seed-a')
      await secondA
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

    it("joins a sync still waiting for the network's first read", async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const firstB = controller.syncChain('1')
      const secondB = controller.syncChain('1')

      await releaseSync('seed-a')
      await syncA
      await releaseSync('seed-b')
      await Promise.all([firstB, secondB])

      const syncsOfB = protocols
        .filter((protocol) => protocol.seedId === 'seed-b')
        .reduce((total, protocol) => total + protocol.syncCount, 0)
      expect(syncsOfB).toBe(1)
    })

    it("shows each account's own sync, and the network's first read to every account", async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      // Waiting for the first phrase's read, which every phrase is told is the long first one
      await waitUntil(() => controller.chains['1']?.isInitialSyncDone === false)
      expect(controller.chains['1']?.syncStatus).toBe('syncing')

      await releaseSync('seed-a')
      await syncA
      await waitUntil(() => runningSyncs.length === 1)
      expect(controller.chains['1']?.syncStatus).toBe('syncing')
      selectedAccount.select('seed-a')
      expect(controller.chains['1']?.syncStatus).toBe('ready')

      await releaseSync('seed-b')
      await syncB
      selectedAccount.select('seed-b')
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

    it('counts only approved notes as what a transfer can send', async () => {
      notesBySeed['seed-a'] = [
        { label: 1n, amount: 10n, approved: true },
        { label: 2n, amount: 30n, approved: true },
        { label: 3n, amount: 50n, approved: false }
      ]
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      // A transfer combines approved notes only, so the pending one does not count
      expect(controller.balances['1']).toEqual([
        expect.objectContaining({ approvedAmount: 40n, pendingAmount: 50n, totalAmount: 90n })
      ])
    })

    it('sends the UI balances, never the notes and their deposit labels', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      const { chains, balances } = controller.toJSON()
      expect(chains['1']).not.toHaveProperty('notes')
      expect(balances['1']).toHaveLength(1)
    })

    it('keeps notes across account switches without syncing again', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncA

      selectedAccount.select('seed-b')
      expect(getHeldAmounts(controller)).toEqual([])
      selectedAccount.select('seed-a')

      expect(getHeldAmounts(controller)).toEqual([10n])
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
      expect(getHeldAmounts(controller)).toEqual([])
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
      expect(getHeldAmounts(controller)).toEqual([])
      expect(controller.chains['1']?.lastSyncedAt).toBeNull()
    })

    it('syncs an account opened while another one still syncs', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.sync()
      await waitUntil(() => runningSyncs.length === 1)

      // Opening the second account while the first one's read is still under way
      selectedAccount.select('seed-b')
      const syncB = controller.sync()

      await releaseSync('seed-a')
      await releaseSync('seed-b')
      await Promise.all([syncA, syncB])

      expect(getHeldAmounts(controller)).toEqual([20n])
    })

    it("fails the syncs waiting for a failed first read, and reads the network's state again on the next one", async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const syncA = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const syncB = controller.syncChain('1')

      await waitUntil(() => runningSyncs.length === 1)
      const [running] = runningSyncs
      runningSyncs = []
      running!.gate.reject(new Error('RPC is down'))
      await Promise.all([syncA, syncB])

      // The second phrase never read on its own: it failed along with the read it waited for
      expect(protocols.filter((protocol) => protocol.seedId === 'seed-b')).toHaveLength(0)
      expect(controller.chains['1']).toMatchObject({
        syncStatus: 'idle',
        error: 'Could not load your Privacy Pools balance on this network. Please try again.',
        isInitialSyncDone: false
      })

      const retry = controller.syncChain('1')
      await releaseSync('seed-b')
      await retry
      expect(controller.chains['1']?.isInitialSyncDone).toBe(true)
      expect(getHeldAmounts(controller)).toEqual([20n])
    })

    it("waits after a lock for the network's first read still running from before, instead of reading beside it", async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const beforeLock = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      keystore.isUnlocked = false
      keystore.fireUpdate()
      keystore.isUnlocked = true
      keystore.fireUpdate()

      const afterUnlock = controller.syncChain('1')
      await flush()
      expect(runningSyncs).toHaveLength(1)

      await releaseSync('seed-a')
      await beforeLock
      // Starts from the state the read before the lock persisted
      await waitUntil(() => runningSyncs.length === 1)
      expect(controller.chains['1']?.isInitialSyncDone).toBe(true)

      await releaseSync('seed-a')
      await afterUnlock
      expect(getHeldAmounts(controller)).toEqual([10n])
    })
  })

  describe('networks side by side', () => {
    const OTHER = OTHER_CHAIN_ID.toString()

    const describeRunningSyncs = () =>
      runningSyncs.map(({ seedId, chainId }) => `${seedId} on ${chainId}`).sort()

    it('syncs every network of an account at once', async () => {
      const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })
      selectedAccount.select('seed-a')

      const syncing = controller.sync()
      await waitUntil(() => runningSyncs.length === 2)
      expect(describeRunningSyncs()).toEqual(['seed-a on 1', 'seed-a on 10'])

      // In either order: one network is not held up by the other
      await releaseSync('seed-a', OTHER_CHAIN_ID)
      await waitUntil(() => controller.chains[OTHER]?.syncStatus === 'ready')
      expect(controller.chains['1']?.syncStatus).toBe('syncing')

      await releaseSync('seed-a')
      await syncing
      expect(controller.chains['1']?.syncStatus).toBe('ready')
      expect(controller.balances[OTHER]).toEqual([expect.objectContaining({ totalAmount: 10n })])
    })

    it("reads one network's shared state without holding up the other accounts on another network", async () => {
      const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })

      selectedAccount.select('seed-a')
      const aOnEthereum = controller.syncChain('1')
      selectedAccount.select('seed-b')
      const bOnOther = controller.syncChain(OTHER)
      const bOnEthereum = controller.syncChain('1')

      // The second phrase reads the other network at once, and waits on Ethereum only
      await waitUntil(() => runningSyncs.length === 2)
      await flush()
      expect(describeRunningSyncs()).toEqual(['seed-a on 1', 'seed-b on 10'])

      await releaseSync('seed-b', OTHER_CHAIN_ID)
      await bOnOther
      await releaseSync('seed-a')
      await aOnEthereum
      await releaseSync('seed-b')
      await bOnEthereum

      expect(controller.chains['1']?.syncStatus).toBe('ready')
      expect(controller.chains[OTHER]?.syncStatus).toBe('ready')
    })

    it('keeps the other networks when the first read of one fails', async () => {
      const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })
      selectedAccount.select('seed-a')

      const syncing = controller.sync()
      const onEthereum = await takeRunningSync('seed-a', 1n)
      onEthereum.gate.reject(new Error('RPC is down'))
      await releaseSync('seed-a', OTHER_CHAIN_ID)
      await syncing

      expect(controller.chains['1']).toMatchObject({
        syncStatus: 'idle',
        error: 'Could not load your Privacy Pools balance on this network. Please try again.',
        isInitialSyncDone: false
      })
      expect(controller.chains[OTHER]).toMatchObject({
        syncStatus: 'ready',
        error: null,
        isInitialSyncDone: true
      })
      expect(controller.balances[OTHER]).toEqual([expect.objectContaining({ totalAmount: 10n })])
    })

    it('proves a transfer without waiting for a sync of another network', async () => {
      const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })
      selectedAccount.select('seed-a')

      const syncingOther = controller.syncChain(OTHER)
      await waitUntil(() => runningSyncs.length === 1)

      await controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: 10n ** 17n,
        recipient: WITHDRAWAL_RECIPIENT
      })

      // Reached proving with the other network's sync still running
      const provingProtocol = protocols.find((protocol) => protocol.syncCountWhenProving !== null)
      expect(provingProtocol?.syncCountWhenProving).toBe(0)
      expect(describeRunningSyncs()).toEqual(['seed-a on 10'])

      await releaseSync('seed-a', OTHER_CHAIN_ID)
      await syncingOther
    })
  })
  describe('syncing on opening an account', () => {
    it('reads only the networks not read in the last 10 minutes', async () => {
      const { controller, selectedAccount } = await prepareTest()
      let clock = 1_000_000
      const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)

      try {
        selectedAccount.select('seed-a')
        const firstOpening = controller.syncIfStale()
        await releaseSync('seed-a')
        await firstOpening

        clock += 599_000
        await controller.syncIfStale()
        expect(runningSyncs).toHaveLength(0)

        clock += 1_000
        const laterOpening = controller.syncIfStale()
        await releaseSync('seed-a')
        await laterOpening

        expect(protocols.reduce((total, protocol) => total + protocol.syncCount, 0)).toBe(2)
      } finally {
        now.mockRestore()
      }
    })

    it('reads each account on its own schedule', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const openingA = controller.syncIfStale()
      await releaseSync('seed-a')
      await openingA

      // Read a moment ago for the first phrase, never for the second
      selectedAccount.select('seed-b')
      const openingB = controller.syncIfStale()
      await releaseSync('seed-b')
      await openingB

      expect(controller.chains['1']?.lastSyncedAt).not.toBeNull()
    })

    it('does not read an account until its recovery phrase is backed up', async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()
      keystore.seeds = [{ id: 'seed-a', notBackedUp: true }, { id: 'seed-b' }]

      selectedAccount.select('seed-a')
      await controller.syncIfStale()
      expect(runningSyncs).toHaveLength(0)
      expect(controller.chains['1']?.syncStatus).toBe('idle')

      keystore.seeds = [{ id: 'seed-a' }, { id: 'seed-b' }]
      const opening = controller.syncIfStale()
      await releaseSync('seed-a')
      await opening
      expect(controller.chains['1']?.lastSyncedAt).not.toBeNull()
    })

    it('reads again on a refresh however recent the last read is', async () => {
      const { controller, selectedAccount } = await prepareTest()

      selectedAccount.select('seed-a')
      const opening = controller.syncIfStale()
      await releaseSync('seed-a')
      await opening

      const refresh = controller.sync()
      await releaseSync('seed-a')
      await refresh

      expect(protocols.reduce((total, protocol) => total + protocol.syncCount, 0)).toBe(2)
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

    it('refuses a token that could not be sent out of the account again', async () => {
      const { controller } = await prepareTest()
      const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

      await expect(buildDeposit(controller, { tokenAddress: DAI })).rejects.toThrow(
        'This token cannot be sent to a Privacy Pools account.'
      )
      expect(runningSyncs).toHaveLength(0)
    })

    it('refuses a deposit into a pool the paymaster has no adapter for', async () => {
      const { controller } = await prepareTest()
      entrypointPool = '0x000000000000000000000000000000000000bEEF'

      await expect(buildDeposit(controller)).rejects.toThrow(
        'Sending ETH to a Privacy Pools account is not supported yet.'
      )
      expect(runningSyncs).toHaveLength(0)
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
      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
      expect(runningSyncs).toHaveLength(0)
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

    // USDT refuses to change one non-zero allowance into another
    it('resets a leftover allowance before approving the deposit', async () => {
      const { controller } = await prepareTest()
      const amount = 5n * 10n ** 6n
      allowance = 1n

      const building = buildDeposit(controller, { tokenAddress: USDC, amount })
      await releaseSync('seed-b')
      const [resetCall, approveCall, depositCall] = await building

      expect(resetCall?.data).toBe(
        ERC20_INTERFACE.encodeFunctionData('approve', [ETHEREUM_ENTRYPOINT, 0n])
      )
      expect(approveCall?.data).toBe(
        ERC20_INTERFACE.encodeFunctionData('approve', [ETHEREUM_ENTRYPOINT, amount])
      )
      expect(depositCall?.to).toBe(ETHEREUM_ENTRYPOINT)
    })

    it('refuses another deposit until the broadcast one lands and the chain moves on', async () => {
      const { controller, selectedAccount } = await prepareTest()

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building
      controller.onAccountOpBroadcast({ chainId: 1n, calls })

      // Same precommitment, since the first one has not landed
      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)

      // It lands, and the next sync moves the precommitment on
      depositCountBySeed['seed-b'] = 1
      selectedAccount.select('seed-b')
      const syncing = controller.syncChain('1')
      await releaseSync('seed-b')
      await syncing
      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
      expect(runningSyncs).toHaveLength(0)
    })

    it('does not block a deposit over a broadcast it did not prepare', async () => {
      const { controller } = await prepareTest()

      // Carries the precommitment the next deposit derives, but this wallet did not build it
      controller.onAccountOpBroadcast({
        chainId: 1n,
        calls: [
          {
            to: ETHEREUM_ENTRYPOINT,
            value: ONE_ETH,
            data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(uint256)', [
              getPrecommitment('seed-b')
            ])
          }
        ]
      })

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      await expect(building).resolves.toHaveLength(1)
    })

    it('does not block a deposit over a broadcast on another chain', async () => {
      const { controller } = await prepareTest()

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building
      controller.onAccountOpBroadcast({ chainId: 10n, calls })

      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
    })
  })
  describe('send form', () => {
    const SEND_ROUTE = 'privacy-pools-send'

    const prepareFilledForm = async (viewType: View['type'] = 'popup') => {
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')
      test.ui.open('view-1', viewType, 'dashboard')
      test.ui.navigate('view-1', SEND_ROUTE)
      test.controller.updateSendForm({ recipientFieldValue: 'vitalik.eth', amount: '0.1' })

      return test
    }

    it('keeps the form of a closed popup, so it reopens on it', async () => {
      const { controller, ui } = await prepareFilledForm()

      ui.close('view-1')

      expect(controller.sendForm).toMatchObject({
        recipientFieldValue: 'vitalik.eth',
        amount: '0.1'
      })
      expect(controller.hasPersistedSendForm).toBe(true)
    })

    it('picks the token the screen is opened for, like the regular Send', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.open('view-1', 'popup', 'dashboard')

      ui.navigate('view-1', SEND_ROUTE, { chainId: '1', address: '0xAbCd' })

      expect(controller.sendForm.tokenId).toBe('1:0xabcd')
      expect(controller.hasPersistedSendForm).toBe(false)
    })

    it('keeps the token pick of the form when the screen is opened without one', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.open('view-1', 'popup', 'dashboard')
      controller.updateSendForm({ tokenId: '1:0xabcd' })

      ui.navigate('view-1', SEND_ROUTE)
      ui.navigate('view-1', SEND_ROUTE, { chainId: '1' })

      expect(controller.sendForm.tokenId).toBe('1:0xabcd')
    })

    it('ignores a token in the params of another screen', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.open('view-1', 'popup', 'dashboard')

      ui.navigate('view-1', 'transfer', { chainId: '1', address: '0xabcd' })

      expect(controller.sendForm.tokenId).toBe('')
    })

    it('does not count a picked token alone as something to come back to', async () => {
      const { controller } = await prepareTest()

      controller.updateSendForm({ tokenId: '1:0x0', amountFieldMode: 'fiat' })

      expect(controller.hasPersistedSendForm).toBe(false)
    })

    it('starts a closed side panel or tab on a blank form', async () => {
      const sidePanel = await prepareFilledForm('side-panel')
      sidePanel.ui.close('view-1')
      expect(sidePanel.controller.hasPersistedSendForm).toBe(false)

      const tab = await prepareFilledForm('tab')
      tab.ui.close('view-1')
      expect(tab.controller.hasPersistedSendForm).toBe(false)
    })

    it('clears the form on leaving the screen, and tells the screen to drop its copy', async () => {
      const { controller, ui } = await prepareFilledForm()
      const resetCounter = controller.sendFormResetCounter

      ui.navigate('view-1', 'dashboard')

      expect(controller.hasPersistedSendForm).toBe(false)
      expect(controller.sendFormResetCounter).toBe(resetCounter + 1)
    })

    it('keeps the form while another view still shows the screen', async () => {
      const { controller, ui } = await prepareFilledForm()
      ui.open('view-2', 'tab', SEND_ROUTE)

      ui.navigate('view-1', 'dashboard')
      ui.close('view-1')

      expect(controller.hasPersistedSendForm).toBe(true)
    })

    it('ignores views that never showed the screen', async () => {
      const { controller, ui } = await prepareFilledForm()
      ui.open('view-2', 'tab', 'dashboard')

      ui.navigate('view-2', 'settings')
      ui.close('view-2')

      expect(controller.hasPersistedSendForm).toBe(true)
    })

    it('clears the form on switching accounts, without emitting when it is already blank', async () => {
      const { controller, selectedAccount } = await prepareFilledForm()

      selectedAccount.select('seed-b')
      expect(controller.hasPersistedSendForm).toBe(false)

      const resetCounter = controller.sendFormResetCounter
      controller.resetSendForm()
      expect(controller.sendFormResetCounter).toBe(resetCounter)
    })

    it('stops following views once destroyed', async () => {
      const { controller, ui } = await prepareFilledForm()

      controller.destroy()
      ui.navigate('view-1', 'dashboard')

      expect(controller.hasPersistedSendForm).toBe(true)
      expect(ui.uiEvent.listenerCount('updateView')).toBe(0)
      expect(ui.uiEvent.listenerCount('removeView')).toBe(0)
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

    it('refuses to prove a transfer while the user has opted out of ERC-4337', async () => {
      const { controller, featureFlags, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')
      featureFlags.set('erc4337', false)

      await expect(
        controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          amount: 10n ** 17n,
          recipient: WITHDRAWAL_RECIPIENT
        })
      ).rejects.toThrow(EmittableError)

      expect(controller.operation).toBeNull()
      expect(protocols).toHaveLength(0)
    })

    it('leaves the sync before proving to the SDK when none is queued', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      await controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: 10n ** 17n,
        recipient: WITHDRAWAL_RECIPIENT
      })

      const [protocol] = protocols
      expect(protocol?.syncCountWhenProving).toBe(0)
      expect(runningSyncs).toHaveLength(0)
      // Proving itself failed, which leaves the transfer failed with a sentence for the user
      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.'
      })
    })

    it('waits for a queued sync to finish before proving, without adding one', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const syncing = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      const preparing = controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: 10n ** 17n,
        recipient: WITHDRAWAL_RECIPIENT
      })
      await flush()
      const [protocol] = protocols
      expect(protocol?.syncCountWhenProving).toBeNull()

      await releaseSync('seed-a')
      await syncing
      await preparing

      expect(protocol?.syncCountWhenProving).toBe(1)
      expect(protocol?.syncCount).toBe(1)
      expect(runningSyncs).toHaveLength(0)
    })

    const prepareSignedWithdrawal = async ({ isBatch = false }: { isBatch?: boolean } = {}) => {
      preparedWithdrawal = buildPreparedWithdrawal({ isBatch })
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')

      await test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })

      return test
    }

    /** How the SDK's `unwrapResult` rethrows a thunk's failure: serialized, not an `Error`. */
    const toThunkFailure = (message: string) => ({
      name: 'Error',
      message,
      stack: `Error: ${message}\n    at paymasterWithdrawThunk`
    })

    const prepareFailingWithdrawal = async () => {
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')

      await test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })

      return test
    }

    it('explains a fee above the amount, although the SDK throws it from a thunk', async () => {
      prepareUnshieldFailure = toThunkFailure(
        'Withdrawal amount too small to cover the sponsored gas fee'
      )

      const { controller } = await prepareFailingWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error:
          'This amount is too small to cover the network fee for sending it. Please try a larger amount.'
      })
    })

    it('keeps what the SDK said about a failure it cannot explain to the user', async () => {
      prepareUnshieldFailure = toThunkFailure('Leaf not found in the leaves array.')

      const { controller } = await prepareFailingWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.'
      })
      const emitted = controller.emittedErrors.at(-1)
      expect(emitted?.level).toBe('major')
      expect(emitted?.error.message).toBe('Leaf not found in the leaves array.')
    })

    it('drops a proved transfer with its account, so re-adding the account cannot send it', async () => {
      const { controller } = await prepareSignedWithdrawal()
      expect(controller.operation).toMatchObject({ phase: 'ready' })
      jest.mocked(createPPv1Broadcaster).mockClear()

      await controller.removeAccount('seed-a')
      await controller.addAccount('seed-a')

      expect(controller.operation).toBeNull()
      await expect(controller.broadcastWithdrawal()).rejects.toThrow(
        'There is no transfer ready to send.'
      )
      expect(createPPv1Broadcaster).not.toHaveBeenCalled()
    })

    it('shows what a proved transfer costs by running it, next to the most it can cost', async () => {
      const { controller, providers } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'pending',
        phase: 'ready',
        quote: {
          feeAmount: WITHDRAWAL_FEE,
          amountAfterFee: WITHDRAWAL_AMOUNT - WITHDRAWAL_FEE,
          expectedFeeAmount: WITHDRAWAL_FEE - WITHDRAWAL_REFUND
        }
      })
      // Run as the bundler will submit it: through the paymaster's entry point
      const [method, [params]] = providers.providers['1'].send.mock.calls[0] as [string, any[]]
      expect(method).toBe('eth_simulateV1')
      expect(params.blockStateCalls[0].calls[0].to).toBe(ETHEREUM_PAYMASTER.entryPointAddress)
    })

    it('clears the send form once the transfer is sent, like a regular transfer', async () => {
      const { controller } = await prepareSignedWithdrawal()
      controller.updateSendForm({ recipientFieldValue: WITHDRAWAL_RECIPIENT, amount: '0.1' })
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({ broadcast: async () => {} } as any)

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.status === 'success')

      expect(controller.hasPersistedSendForm).toBe(false)

      await releaseSync('seed-a')
      await broadcasting
    })

    it('clears the send form when the transfer could not be sent', async () => {
      const { controller } = await prepareSignedWithdrawal()
      controller.updateSendForm({ recipientFieldValue: WITHDRAWAL_RECIPIENT, amount: '0.1' })
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
        broadcast: async () => {
          throw new Error('bundler rejected it')
        }
      } as any)

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.status === 'failed')
      await releaseSync('seed-a')
      await broadcasting

      expect(controller.hasPersistedSendForm).toBe(false)
    })

    it('reports a transfer that could not be sent without a toast, as the open sheet shows it', async () => {
      const { controller } = await prepareSignedWithdrawal()
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
        broadcast: async () => {
          throw new Error('bundler rejected it')
        }
      } as any)
      const errorCount = controller.emittedErrors.length

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.status === 'failed')

      expect(controller.operation?.error).toBe(
        'We could not confirm the transfer yet. Check your balance before you send it again.'
      )
      expect(controller.emittedErrors.slice(errorCount)).toEqual([
        expect.objectContaining({ level: 'silent' })
      ])

      await releaseSync('seed-a')
      await broadcasting
    })

    describe('sent a while after it was proved', () => {
      const RECHECK_AFTER_MS = 30 * 1000
      let now: number

      beforeEach(() => {
        now = Date.now()
        jest.spyOn(Date, 'now').mockImplementation(() => now)
        jest.mocked(createPPv1Broadcaster).mockClear()
      })

      afterEach(() => {
        jest.mocked(Date.now).mockRestore()
      })

      const countSimulations = (providers: FakeProviders) =>
        providers.providers['1'].send.mock.calls.filter(([method]) => method === 'eth_simulateV1')
          .length

      const mockBroadcast = () => {
        const broadcast = jest.fn(async () => {})
        jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({ broadcast } as any)

        return broadcast
      }

      const sendSuccessfully = async (controller: PrivacyPoolsController) => {
        const broadcasting = controller.broadcastWithdrawal()
        await waitUntil(() => controller.operation?.status === 'success')
        await releaseSync('seed-a')
        await broadcasting
      }

      const getShownErrors = (controller: PrivacyPoolsController) =>
        controller.emittedErrors.filter(({ level }) => level !== 'silent')

      it('sends one proved just now without running it again', async () => {
        const { controller, providers } = await prepareSignedWithdrawal()
        const simulations = countSimulations(providers)
        const broadcast = mockBroadcast()

        now += RECHECK_AFTER_MS - 1
        await sendSuccessfully(controller)

        expect(countSimulations(providers)).toBe(simulations)
        expect(broadcast).toHaveBeenCalledTimes(1)
      })

      it('runs an older one again, and sends it when it still goes through', async () => {
        const { controller, providers } = await prepareSignedWithdrawal()
        const simulations = countSimulations(providers)
        const broadcast = mockBroadcast()

        now += RECHECK_AFTER_MS
        await sendSuccessfully(controller)

        expect(countSimulations(providers)).toBe(simulations + 1)
        expect(broadcast).toHaveBeenCalledTimes(1)
      })

      const expectSentBackToPrepareAgain = async (controller: PrivacyPoolsController) => {
        expect(controller.operation).toMatchObject({
          status: 'failed',
          // Nothing was sent, which the sheet tells by the phase
          phase: 'ready',
          error: 'This transfer has expired. Go back to prepare it again.'
        })
        expect(createPPv1Broadcaster).not.toHaveBeenCalled()
        // Nothing to pick up, so no sync
        expect(runningSyncs).toHaveLength(0)
        // Its proof is gone: only a new one can be sent
        await expect(controller.broadcastWithdrawal()).rejects.toThrow(
          'There is no transfer ready to send.'
        )
        controller.dismissOperation()
        expect(controller.operation).toBeNull()
      }

      it('does not send an older one whose gas price the network fee has outgrown', async () => {
        const { controller } = await prepareSignedWithdrawal()
        const shownErrors = getShownErrors(controller).length

        now += RECHECK_AFTER_MS
        latestBaseFee = 2n * 10n ** 9n
        await controller.broadcastWithdrawal()

        // Shown in the sheet, not as a toast
        expect(getShownErrors(controller)).toHaveLength(shownErrors)
        await expectSentBackToPrepareAgain(controller)
      })

      it('does not send an older one that would now fail, as over a root that moved on', async () => {
        const { controller } = await prepareSignedWithdrawal()

        now += RECHECK_AFTER_MS
        simulateWithdrawal = async () => [
          { calls: [{ status: '0x0', error: { message: 'execution reverted' } }] }
        ]
        await controller.broadcastWithdrawal()

        await expectSentBackToPrepareAgain(controller)
      })

      it('sends an older one it cannot run again, leaving a stale one to the bundler', async () => {
        const { controller } = await prepareSignedWithdrawal()
        const broadcast = mockBroadcast()

        now += RECHECK_AFTER_MS
        simulateWithdrawal = async () => {
          throw new Error('the node is down')
        }
        await sendSuccessfully(controller)

        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(controller.emittedErrors.at(-1)).toMatchObject({ level: 'silent' })
      })

      describe('on opening the screen again', () => {
        it('leaves one proved just now alone', async () => {
          const { controller, providers } = await prepareSignedWithdrawal()
          const simulations = countSimulations(providers)

          now += RECHECK_AFTER_MS - 1
          await controller.recheckWithdrawal()

          expect(countSimulations(providers)).toBe(simulations)
        })

        it('runs an older one again, shows what it costs now, and sends it without running it again', async () => {
          const { controller, providers } = await prepareSignedWithdrawal()
          const simulations = countSimulations(providers)

          now += RECHECK_AFTER_MS
          const refundNow = WITHDRAWAL_REFUND / 2n
          simulateWithdrawal = async () => successfulSimulation(WITHDRAWAL_RECIPIENT, refundNow)
          await controller.recheckWithdrawal()

          expect(countSimulations(providers)).toBe(simulations + 1)
          expect(controller.operation).toMatchObject({
            status: 'pending',
            phase: 'ready',
            quote: { feeAmount: WITHDRAWAL_FEE, expectedFeeAmount: WITHDRAWAL_FEE - refundNow }
          })

          const broadcast = mockBroadcast()
          await sendSuccessfully(controller)

          expect(countSimulations(providers)).toBe(simulations + 1)
          expect(broadcast).toHaveBeenCalledTimes(1)
        })

        it('sends the user back to prepare again an older one gone stale', async () => {
          const { controller } = await prepareSignedWithdrawal()

          now += RECHECK_AFTER_MS
          latestBaseFee = 2n * 10n ** 9n
          await controller.recheckWithdrawal()

          await expectSentBackToPrepareAgain(controller)
        })

        it('keeps an older one it cannot run again, for Send to check it again', async () => {
          const { controller, providers } = await prepareSignedWithdrawal()
          const simulations = countSimulations(providers)

          now += RECHECK_AFTER_MS
          simulateWithdrawal = async () => {
            throw new Error('the node is down')
          }
          await controller.recheckWithdrawal()
          expect(controller.operation).toMatchObject({ status: 'pending', phase: 'ready' })

          simulateWithdrawal = async () => successfulSimulation()
          mockBroadcast()
          await sendSuccessfully(controller)

          expect(countSimulations(providers)).toBe(simulations + 2)
        })
      })

      it('does not send one checked across a lock', async () => {
        const { controller, keystore } = await prepareSignedWithdrawal()
        now += RECHECK_AFTER_MS
        const answer = createDeferred()
        simulateWithdrawal = async () => {
          await answer.promise

          return successfulSimulation()
        }

        const broadcasting = controller.broadcastWithdrawal()
        await waitUntil(() => controller.operation?.phase === 'broadcasting')
        keystore.isUnlocked = false
        keystore.fireUpdate()
        answer.resolve()
        await broadcasting

        expect(createPPv1Broadcaster).not.toHaveBeenCalled()
      })
    })

    /** The proved transfer's clear-signing card, without the ids the humanizer draws at random. */
    const describeHumanization = (humanization: IrCall | null | undefined) => {
      const card = humanization?.fullVisualization?.[0]
      if (card?.type !== 'erc7730') return card

      return {
        intent: card.intent.map(({ type, content }) => ({ type, content })),
        rows: card.fields.map((row) =>
          row.type === 'single-value'
            ? { label: row.label, address: row.value.address, value: row.value.value }
            : row
        )
      }
    }

    /**
     * The card of the proved transfer: what the recipient gets and the fee are the expected ones
     * when the transfer was simulated, otherwise the bounds the fee cap sets.
     */
    const humanizedSend = (expectedFee: bigint | null) => ({
      intent: [{ type: 'action', content: 'Send' }],
      rows: [
        { label: 'Amount to Send', address: ZERO_ADDRESS, value: WITHDRAWAL_AMOUNT },
        {
          label: 'Recipient Receives',
          address: ZERO_ADDRESS,
          value: WITHDRAWAL_AMOUNT - (expectedFee ?? WITHDRAWAL_FEE)
        },
        { label: 'Recipient', address: WITHDRAWAL_RECIPIENT.toLowerCase(), value: undefined },
        { label: 'Network fee', address: ZERO_ADDRESS, value: expectedFee ?? WITHDRAWAL_FEE }
      ]
    })

    it('describes a proved transfer as a clear-signing card, the refund in what it pays out', async () => {
      const { controller } = await prepareSignedWithdrawal()

      expect(describeHumanization(controller.operation?.humanization)).toEqual(
        humanizedSend(WITHDRAWAL_FEE - WITHDRAWAL_REFUND)
      )
    })

    it('shows the bounds of what the recipient gets and the fee when the transfer could not be run', async () => {
      simulateWithdrawal = async () => {
        throw new Error('the method eth_simulateV1 does not exist/is not available')
      }

      const { controller } = await prepareSignedWithdrawal()

      expect(describeHumanization(controller.operation?.humanization)).toEqual(humanizedSend(null))
    })

    it('describes a transfer only once it is proved', async () => {
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')
      preparedWithdrawal = buildPreparedWithdrawal()

      const preparing = test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })
      expect(test.controller.operation).toMatchObject({ phase: 'proving', humanization: null })

      await preparing
      expect(test.controller.operation?.humanization).not.toBeNull()
    })

    it('refuses a transfer proved from the pool of another token', async () => {
      // A pool the paymaster sponsors too, so only the token tells the two apart
      entrypointPool = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'

      const { controller } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.',
        quote: null,
        humanization: null
      })
      expect(controller.emittedErrors.at(-1)?.error.message).toMatch(/pool of a different token/)
    })

    it('shows only the most a transfer can cost when the node cannot run it', async () => {
      simulateWithdrawal = async () => {
        throw new Error('the method eth_simulateV1 does not exist/is not available')
      }

      const { controller } = await prepareSignedWithdrawal()

      // Still ready to send: the fee in the proof is a limit the user can confirm
      expect(controller.operation).toMatchObject({
        status: 'pending',
        phase: 'ready',
        quote: { feeAmount: WITHDRAWAL_FEE, expectedFeeAmount: null }
      })
      expect(controller.emittedErrors.at(-1)).toMatchObject({ level: 'silent' })
    })

    it('does not fail a transfer the simulation says would revert, leaving that to the bundler', async () => {
      simulateWithdrawal = async () => [{ calls: [{ status: '0x0', logs: [] }] }]

      const { controller } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        phase: 'ready',
        quote: { feeAmount: WITHDRAWAL_FEE, expectedFeeAmount: null }
      })
    })

    it('does not try to run a transfer on a node without state overrides', async () => {
      rpcNoStateOverride = true

      const { controller, providers } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        phase: 'ready',
        quote: { expectedFeeAmount: null }
      })
      expect(providers.providers['1'].send).not.toHaveBeenCalled()
    })

    it('asks the SDK for a batch, whose selection skips pending deposits', async () => {
      await prepareSignedWithdrawal()

      const [protocol] = protocols
      expect(protocol?.unshieldOptions).toEqual({
        mode: 'paymaster',
        batch: true,
        refundRecipient: WITHDRAWAL_RECIPIENT
      })
    })

    describe('combining deposits', () => {
      it('describes it by the forward to the recipient, not by the single-use sender', async () => {
        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        // Its refund goes to the recipient too, so they get the amount net of the expected fee
        expect(describeHumanization(controller.operation?.humanization)).toEqual(
          humanizedSend(WITHDRAWAL_FEE - WITHDRAWAL_REFUND)
        )
      })

      it('shows the fee net of the refund, which goes to the recipient', async () => {
        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        expect(controller.operation).toMatchObject({
          status: 'pending',
          phase: 'ready',
          quote: {
            feeAmount: WITHDRAWAL_FEE,
            amountAfterFee: WITHDRAWAL_AMOUNT - WITHDRAWAL_FEE,
            expectedFeeAmount: WITHDRAWAL_FEE - WITHDRAWAL_REFUND
          }
        })
      })

      it('does not count a refund to the single-use sender', async () => {
        simulateWithdrawal = async () => successfulSimulation(WITHDRAWAL_SENDER)

        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        expect(controller.operation?.quote?.expectedFeeAmount).toBe(WITHDRAWAL_FEE)
      })

      const batchNotConfirmedError =
        'This transfer combines several of your deposits, and we could not confirm it would go through, so it was not sent. Please try again in a moment, or send a smaller amount.'

      it('refuses one the node cannot run', async () => {
        simulateWithdrawal = async () => {
          throw new Error('the method eth_simulateV1 does not exist/is not available')
        }

        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: batchNotConfirmedError
        })
      })

      it('refuses one the simulation says would revert', async () => {
        simulateWithdrawal = async () => [{ calls: [{ status: '0x0', logs: [] }] }]

        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: batchNotConfirmedError
        })
      })

      it('refuses one on a node without state overrides', async () => {
        rpcNoStateOverride = true

        const { controller } = await prepareSignedWithdrawal({ isBatch: true })

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: batchNotConfirmedError
        })
      })
    })
  })
  describe('cancelling a transfer', () => {
    const SEND_ROUTE = 'privacy-pools-send'

    const startWithdrawal = (controller: PrivacyPoolsController) =>
      controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })

    /**
     * A prover whose proofs run until the test finishes them. Like the in-process one, it ignores
     * the signal it is given, so a cancelled proof still runs to the end.
     */
    const createGatedProver = () => {
      const proofs: { signal?: AbortSignal; gate: Deferred }[] = []
      const proverFactory = jest.fn(
        async () =>
          ({
            prove: async (
              _circuit: unknown,
              _signals: unknown,
              options?: { signal?: AbortSignal }
            ) => {
              const gate = createDeferred()
              proofs.push({ signal: options?.signal, gate })
              await gate.promise

              return { proof: {}, publicSignals: [], mappedSignals: {} }
            }
          }) as any
      )

      return { proverFactory, proofs }
    }

    /** A transfer from seed-a, proving from a filled Send form. */
    const startProving = async (viewType: View['type'] = 'side-panel') => {
      isProvingOnUnshield = true
      preparedWithdrawal = buildPreparedWithdrawal()
      const { proverFactory, proofs } = createGatedProver()
      const test = await prepareTest({ proverFactory })
      test.selectedAccount.select('seed-a')
      test.ui.open('view-1', viewType, 'dashboard')
      test.ui.navigate('view-1', SEND_ROUTE)
      test.controller.updateSendForm({ recipientFieldValue: WITHDRAWAL_RECIPIENT, amount: '0.1' })

      const preparing = startWithdrawal(test.controller)
      await waitUntil(() => proofs.length === 1)

      return { ...test, proofs, preparing }
    }

    it('cancels a transfer being proved on leaving the screen, without telling the user it failed', async () => {
      const { controller, ui, proofs, preparing } = await startProving()
      const errorCount = controller.emittedErrors.length

      ui.navigate('view-1', 'dashboard')

      expect(proofs[0]!.signal?.aborted).toBe(true)
      expect(controller.operation).toBeNull()

      // A proof that cannot stop midway finishes, and is dropped
      proofs[0]!.gate.resolve()
      await preparing

      expect(controller.operation).toBeNull()
      expect(controller.emittedErrors).toHaveLength(errorCount)
      await expect(controller.broadcastWithdrawal()).rejects.toThrow(
        'There is no transfer ready to send.'
      )
    })

    it('keeps proving for a closed popup, which reopens on its form', async () => {
      const { controller, ui, proofs, preparing } = await startProving('popup')

      ui.close('view-1')
      expect(proofs[0]!.signal?.aborted).toBe(false)

      proofs[0]!.gate.resolve()
      await preparing

      expect(controller.operation).toMatchObject({ status: 'pending', phase: 'ready' })
    })

    it('drops a proved transfer on leaving the screen, so its proof is never sent', async () => {
      const { controller, ui, proofs, preparing } = await startProving()
      proofs[0]!.gate.resolve()
      await preparing
      expect(controller.operation).toMatchObject({ phase: 'ready' })

      ui.navigate('view-1', 'dashboard')

      expect(controller.operation).toBeNull()
      await expect(controller.broadcastWithdrawal()).rejects.toThrow(
        'There is no transfer ready to send.'
      )
    })

    it('lets a transfer being sent finish when the user leaves the screen', async () => {
      const { controller, ui, proofs, preparing } = await startProving()
      proofs[0]!.gate.resolve()
      await preparing
      const sending = createDeferred()
      jest
        .mocked(createPPv1Broadcaster)
        .mockReturnValueOnce({ broadcast: () => sending.promise } as any)

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.phase === 'broadcasting')
      ui.navigate('view-1', 'dashboard')

      expect(controller.operation).toMatchObject({ status: 'pending', phase: 'broadcasting' })

      sending.resolve()
      await waitUntil(() => controller.operation?.status === 'success')
      await releaseSync('seed-a')
      await broadcasting
    })

    it('cancels it on switching accounts, and proves the next one only once it has stopped', async () => {
      const { controller, selectedAccount, proofs, preparing } = await startProving()

      selectedAccount.select('seed-b')
      expect(proofs[0]!.signal?.aborted).toBe(true)

      // Not refused as another transfer in progress
      const next = startWithdrawal(controller)
      expect(controller.operation).toMatchObject({
        seedId: 'seed-b',
        status: 'pending',
        phase: 'proving'
      })
      await flush()
      await flush()
      expect(proofs).toHaveLength(1)

      proofs[0]!.gate.resolve()
      await preparing
      await waitUntil(() => proofs.length === 2)
      expect(proofs[1]!.signal?.aborted).toBe(false)

      proofs[1]!.gate.resolve()
      await next
      expect(controller.operation).toMatchObject({ seedId: 'seed-b', phase: 'ready' })
    })

    it('cancels it on lock, without telling the user it failed', async () => {
      const { controller, keystore, proofs, preparing } = await startProving()
      const errorCount = controller.emittedErrors.length

      keystore.isUnlocked = false
      keystore.fireUpdate()
      expect(proofs[0]!.signal?.aborted).toBe(true)

      proofs[0]!.gate.resolve()
      await preparing

      expect(controller.operation).toBeNull()
      expect(controller.emittedErrors).toHaveLength(errorCount)
    })

    it('stops waiting for a queued sync once cancelled, and never proves', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.open('view-1', 'side-panel', SEND_ROUTE)
      const syncing = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      const preparing = startWithdrawal(controller)
      await flush()
      ui.navigate('view-1', 'dashboard')
      await preparing

      expect(controller.operation).toBeNull()
      expect(protocols[0]?.syncCountWhenProving).toBeNull()

      await releaseSync('seed-a')
      await syncing
      expect(protocols[0]?.syncCountWhenProving).toBeNull()
    })
  })

  describe('taking back deposits (ragequit)', () => {
    const USDC_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
    const OTHER_DEPOSITOR = '0x0000000000000000000000000000000000000001'

    beforeEach(() => {
      notesBySeed = {
        'seed-a': [
          { label: 1n, amount: 10n, approved: true, deposit: 0 },
          // Made after label 6, as labels say nothing of the order
          { label: 3n, amount: 30n, approved: false, deposit: 4 },
          // Spent in full: nothing left to take back
          { label: 4n, amount: 0n, approved: false, deposit: 1 },
          {
            label: 5n,
            amount: 5n,
            approved: false,
            assetAddress: BigInt(USDC),
            depositor: OTHER_DEPOSITOR,
            deposit: 2
          },
          { label: 6n, amount: 60n, approved: false, depositor: OTHER_DEPOSITOR, deposit: 3 }
        ],
        'seed-b': [{ label: 2n, amount: 20n, approved: false }]
      }
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    const prove = jest.fn(async () => ({}) as any)

    const prepareSynced = async () => {
      const prepared = await prepareTest({ proverFactory: async () => ({ prove }) })
      prepared.selectedAccount.select('seed-a')
      const syncing = prepared.controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      return { ...prepared, protocol: protocols[0]! }
    }

    const buildRagequit = (controller: PrivacyPoolsController, label: bigint) =>
      controller.buildRagequitCalls({ chainId: '1', label })

    it("lists the token's deposits still being verified, newest first, with their account", async () => {
      const { controller } = await prepareSynced()

      await expect(controller.getRagequitDeposits('1', ZERO_ADDRESS)).resolves.toEqual([
        { label: 3n, amount: 30n, depositorAddr: DEPOSITOR },
        { label: 6n, amount: 60n, depositorAddr: OTHER_DEPOSITOR }
      ])
      await expect(controller.getRagequitDeposits('1', USDC.toUpperCase())).resolves.toEqual([
        { label: 5n, amount: 5n, depositorAddr: OTHER_DEPOSITOR }
      ])
    })

    it('keeps the depositor checksummed, as the SDK reports it as a number', async () => {
      const { controller } = await prepareSynced()

      const [newest] = await controller.getRagequitDeposits('1', ZERO_ADDRESS)

      expect(newest?.depositorAddr).toBe(DEPOSITOR)
      expect(newest?.depositorAddr).not.toBe(DEPOSITOR.toLowerCase())
    })

    it('asks the network nothing to list them, and does not sync again', async () => {
      const { controller, protocol, providers } = await prepareSynced()
      const syncCount = protocol.syncCount

      await controller.getRagequitDeposits('1', ZERO_ADDRESS)

      expect(protocol.syncCount).toBe(syncCount)
      expect(providers.providers['1'].send).not.toHaveBeenCalled()
    })

    it('lists nothing before a sync, nor for a token with no deposits being verified', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      await expect(controller.getRagequitDeposits('1', ZERO_ADDRESS)).resolves.toEqual([])
    })

    it('answers the Rage quit sheet, and tells it why when it cannot', async () => {
      const { controller, ui, selectedAccount } = await prepareSynced()

      await controller.getRagequitDepositsAndSendResToUi('1', ZERO_ADDRESS, 'request-1')
      selectedAccount.select(null)
      await controller.getRagequitDepositsAndSendResToUi('1', ZERO_ADDRESS, 'request-2')

      expect(ui.message.sendUiMessage).toHaveBeenNthCalledWith(1, {
        requestId: 'request-1',
        ok: true,
        res: [
          expect.objectContaining({ label: 3n, amount: 30n, depositorAddr: DEPOSITOR }),
          expect.objectContaining({ label: 6n })
        ]
      })
      expect(ui.message.sendUiMessage).toHaveBeenNthCalledWith(2, {
        requestId: 'request-2',
        ok: false,
        error: 'Please select a Privacy Pools account first.'
      })
      expect(controller.emittedErrors.at(-1)?.message).toBe(
        'Please select a Privacy Pools account first.'
      )
    })

    it('builds the reclaim as a call of the account the deposit came from', async () => {
      const { controller, protocol } = await prepareSynced()

      await expect(buildRagequit(controller, 3n)).resolves.toEqual({
        accountAddr: DEPOSITOR,
        calls: [{ to: ETHEREUM_ETH_POOL, value: 0n, data: encodeRagequit(30n, 3n) }]
      })
      await expect(buildRagequit(controller, 6n)).resolves.toEqual({
        accountAddr: OTHER_DEPOSITOR,
        calls: [{ to: ETHEREUM_ETH_POOL, value: 0n, data: encodeRagequit(60n, 6n) }]
      })
      expect(protocol.ragequitLabels).toEqual([[3n], [6n]])
    })

    it('never takes back a verified deposit, one spent in full, or one it does not know', async () => {
      const { controller, protocol } = await prepareSynced()

      await expect(buildRagequit(controller, 1n)).rejects.toThrow(
        'This deposit can no longer be taken back. It may have been verified or taken back already.'
      )
      await expect(buildRagequit(controller, 4n)).rejects.toThrow(EmittableError)
      await expect(buildRagequit(controller, 99n)).rejects.toThrow(EmittableError)
      // Another account's deposit, though it is being verified
      await expect(buildRagequit(controller, 2n)).rejects.toThrow(EmittableError)
      expect(protocol.ragequitLabels).toEqual([])
    })

    it('refuses what the SDK built when it is not the reclaim of that deposit', async () => {
      const { controller } = await prepareSynced()
      const message = 'Could not prepare taking back this deposit. Please try again.'
      const builtFor = (txns: { to: string; data: string; value: bigint }[]) => {
        ragequitTxns = txns
        return buildRagequit(controller, 3n)
      }

      // It leaves out a deposit it could not prove for
      await expect(builtFor([])).rejects.toThrow(message)
      const reclaim = { to: ETHEREUM_ETH_POOL, value: 0n, data: encodeRagequit(30n, 3n) }
      await expect(builtFor([reclaim, reclaim])).rejects.toThrow(message)
      await expect(builtFor([{ ...reclaim, data: encodeRagequit(30n, 1n) }])).rejects.toThrow(
        message
      )
      await expect(builtFor([{ ...reclaim, data: encodeRagequit(29n, 3n) }])).rejects.toThrow(
        message
      )
      // Another token's pool, or one we do not know
      await expect(builtFor([{ ...reclaim, to: USDC_POOL }])).rejects.toThrow(message)
      await expect(builtFor([{ ...reclaim, to: WITHDRAWAL_RECIPIENT }])).rejects.toThrow(message)
      await expect(builtFor([{ ...reclaim, value: 1n }])).rejects.toThrow(message)
      await expect(builtFor([{ ...reclaim, data: '0x12345678' }])).rejects.toThrow(message)
    })

    it('hands nothing over once the wallet was locked while proving', async () => {
      const { controller, keystore } = await prepareSynced()
      ragequitGate = createDeferred()

      const building = buildRagequit(controller, 3n)
      await waitUntil(() => protocols[0]!.ragequitLabels.length > 0)
      keystore.isUnlocked = false
      keystore.fireUpdate()
      ragequitGate.resolve()

      await expect(building).rejects.toThrow('Please unlock your wallet to use Privacy Pools.')
    })

    it("proves with no cancel signal, which only a withdrawal's proofs get", async () => {
      const { controller } = await prepareSynced()

      await buildRagequit(controller, 3n)

      expect(prove).toHaveBeenLastCalledWith('commitment', { value: 1n }, { signal: undefined })
    })
  })

  describe('proving', () => {
    const syncedProtocol = async (proverFactory?: PrivacyPoolsProverFactory) => {
      const { controller, selectedAccount } = await prepareTest({ proverFactory })
      selectedAccount.select('seed-a')
      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      const [protocol] = protocols
      return protocol!
    }

    it('hands the SDK the platform prover when there is one', async () => {
      const proof = { proof: { pi_a: ['1'] }, publicSignals: ['2'], mappedSignals: {} }
      const prove = jest.fn(async () => proof)
      const proverFactory = jest.fn(async () => ({ prove }) as any)

      const protocol = await syncedProtocol(proverFactory)
      const prover = await protocol.params.proverFactory()

      await expect(prover.prove('commitment', { value: 1n })).resolves.toBe(proof)
      expect(proverFactory).toHaveBeenCalledTimes(1)
      // No signal outside a withdrawal
      expect(prove).toHaveBeenCalledWith('commitment', { value: 1n }, { signal: undefined })
    })

    it('proves in its own context without one, from the circuits base URL', async () => {
      const protocol = await syncedProtocol()

      // The test passes no base URL, which is what a platform without artifacts does
      await expect(protocol.params.proverFactory()).rejects.toThrow(
        'privacyPools: proving is not available on this platform (no circuit artifacts)'
      )
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

    it('asks for no prices while the user has opted out of them, and drops those it had', async () => {
      const { controller, featureFlags, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const first = controller.syncChain('1')
      await releaseSync('seed-a')
      await first
      await waitUntil(() => Object.keys(controller.prices).length > 0)

      featureFlags.set('tokenPrices', false)
      expect(controller.prices).toEqual({})

      fakeFetch.mockClear()
      const second = controller.syncChain('1')
      await releaseSync('seed-a')
      await second

      expect(fakeFetch).not.toHaveBeenCalled()
      expect(controller.prices).toEqual({})
    })
  })
})
