import { AbiCoder, Interface, makeError, toBeHex, ZeroHash } from 'ethers'
import { EventEmitter as NodeEventEmitter } from 'events'

import { expect, jest } from '@jest/globals'
import { createPPv1Broadcaster } from '@kohaku-eth/privacy-pools'
import type { PPv1HistoryEvent } from '@kohaku-eth/privacy-pools'

import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsDepositAsset,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsStoreKey
} from '../../consts/privacyPools'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { PrivacyPoolsBroadcaster } from '../../interfaces/privacyPools'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IUiController, View } from '../../interfaces/ui'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { IrCall } from '../../libs/humanizer/interfaces'
import { createPrivacyPoolsDataService } from '../../libs/privacyPools/dataService'
import {
  getDepositAmountWithVettingFee,
  getMaxDepositPoolValue
} from '../../libs/privacyPools/entrypointAssetConfig'
import { getPrivacyPoolsPoolLabels } from '../../libs/privacyPools/poolStats'
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover'
import { POOL_RAGEQUIT_INTERFACE } from '../../libs/privacyPools/ragequit'
import { getRpcProvider } from '../../services/provider'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'
import { TokenPricesController } from '../tokenPrices/tokenPrices'
import { PendingAccountOp } from './context'
import { OPEN_SYNC_MAX_AGE_MS, PrivacyPoolsController } from './privacyPools'

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
const VETTING_FEE_BPS = 50n
const MINIMUM_USDC_DEPOSIT = 10n ** 6n

const ETHEREUM_PAYMASTER = getPrivacyPoolsChainConfig(1n)!.paymaster!
/** The bundler a prepared withdrawal carries, which it is sent to and its block is read from. */
const PAYMASTER_BUNDLER_URL = 'https://bundler.example/v2/1/rpc'
const USER_OP_HASH = `0x${'ab'.repeat(32)}`
/** What the SDK's broadcaster returns once the bundler accepted the withdrawal. */
const BROADCAST_RESULT = { requestId: USER_OP_HASH }
/** The block a withdrawal lands in, according to its bundler. */
const WITHDRAWAL_BLOCK = 21_000_000
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

/** The ETH pool's scope, which a relayed withdrawal names its pool by. */
const ETH_POOL_SCOPE = 4321n
/** 0.18%, as Fast Relay quotes a send of 0.1 ETH. */
const RELAY_FEE_BPS = 18n
const RELAYED_WITHDRAWAL_FEE = (WITHDRAWAL_AMOUNT * RELAY_FEE_BPS) / 10_000n
const RELAYER_FEE_RECIPIENT = '0xEC15c20015e72748F03065ed80c41cb882E3fB66'
const RELAYED_BROADCAST_RESULT = {
  success: true,
  timestamp: 1,
  requestId: 'relayer-request',
  txHash: `0x${'ab'.repeat(32)}`
}
const POOL_SCOPE_INTERFACE = new Interface(['function SCOPE() view returns (uint256)'])
const RELAY_INTERFACE = new Interface([
  'function relay((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof, uint256 scope)'
])

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
 * A relayed withdrawal the way the SDK hands it over, proved against Fast Relay's quote, which runs
 * out `expiresIn` from now.
 */
const buildPreparedRelayedWithdrawal = ({
  expiresIn = 50_000,
  recipient = WITHDRAWAL_RECIPIENT
}: { expiresIn?: number; recipient?: string } = {}) => {
  const withdrawalData = AbiCoder.defaultAbiCoder().encode(
    ['tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)'],
    [{ recipient, feeRecipient: RELAYER_FEE_RECIPIENT, relayFeeBPS: RELAY_FEE_BPS }]
  )

  return {
    mode: 'relayer',
    rawData: {
      context: 1n,
      relayData: { recipient, feeRecipient: RELAYER_FEE_RECIPIENT, relayFeeBps: RELAY_FEE_BPS },
      proof: {
        proof: {
          pi_a: ['1', '2', '1'],
          pi_b: [
            ['3', '4'],
            ['5', '6'],
            ['1', '0']
          ],
          pi_c: ['7', '8', '1']
        },
        publicSignals: ['11', '12', WITHDRAWAL_AMOUNT.toString(), '14', '15', '16', '17', '18']
      },
      withdrawalPayload: { processooor: ETHEREUM_ENTRYPOINT, data: withdrawalData },
      chainId: 1n,
      scope: ETH_POOL_SCOPE
    },
    txData: { to: ETHEREUM_ENTRYPOINT, data: '0x', value: 0n },
    quoteData: {
      quote: {
        baseFeeBPS: '10',
        feeBPS: RELAY_FEE_BPS.toString(),
        gasPrice: '1',
        feeCommitment: {
          expiration: Date.now() + expiresIn,
          withdrawalData,
          signedRelayerCommitment: '0x'
        },
        detail: {}
      },
      relayerId: 'Fast Relay'
    }
  }
}

/**
 * A proved withdrawal the way the SDK hands it over, with the fee, recipient and amount encoded
 * where `readPaymasterWithdrawal` checks them. The proof itself is never verified off chain.
 * It spends one deposit, paid to the recipient, who also gets the unused gas back.
 */
const buildPreparedWithdrawal = () => {
  const coder = AbiCoder.defaultAbiCoder()
  const adapter = ETHEREUM_PAYMASTER.poolAdapters[ETHEREUM_ETH_POOL]!
  const feeData = coder.encode(
    ['tuple(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'],
    [
      {
        recipient: WITHDRAWAL_RECIPIENT,
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
        proof: toFakeProof(WITHDRAWAL_AMOUNT)
      }
    ]
  )

  return {
    mode: 'paymaster',
    withdrawal: {
      poolAddress: BigInt(ETHEREUM_ETH_POOL),
      paymasterAddress: ETHEREUM_PAYMASTER.paymasterAddress,
      entryPointAddress: ETHEREUM_PAYMASTER.entryPointAddress,
      bundlerUrl: PAYMASTER_BUNDLER_URL,
      userOperation: {
        sender: WITHDRAWAL_SENDER,
        nonce: '0x0',
        callData: '0x',
        callGasLimit: '0x0',
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
    /** What the deposit put into the pool, `amount` when not set. */
    value?: bigint
    /** Sends already made from it, 0 when not set. */
    withdraw?: number
    /** The deposit's block, 1 when not set. */
    blockNumber?: bigint
  }[]
} = {}
/** What `history()` returns per phrase, or per `${seedId}:${chainId}` - see `FakeProtocol.history`. */
let historyBySeed: { [seedId: string]: PPv1HistoryEvent[] } = {}
/** Thrown by `history()` when set. */
let historyFailure: Error | null = null
/** Holds `history()` back, once counted, until resolved - when set. */
let historyGate: Deferred | null = null

/** One of a phrase's events as the plugin's `history()` reports it. */
const historyEvent = (overrides: Partial<PPv1HistoryEvent> = {}): PPv1HistoryEvent =>
  ({
    type: 'withdrawal',
    transactionHash: 0xabcn,
    blockNumber: 100n,
    logIndex: 0,
    timestamp: 1_700_000_000n,
    poolAddress: BigInt(ETHEREUM_ETH_POOL),
    assetAddress: 0n,
    value: 1n,
    ...overrides
  }) as PPv1HistoryEvent

/** Scope of a chain's first pool. Each next one in the config has the next number. */
const FIRST_POOL_SCOPE = 42n

/** A pool's event, for `toStoredPoolState`. Made in block 1000 when `blockNumber` is not set. */
type StoredPoolEventInput = { pool: string; value: bigint; blockNumber?: bigint }

/**
 * A chain's public history as the SDK persists it, synced up to `lastSyncedBlock` (1000 when not
 * set): every pool of the chain registered (see `FIRST_POOL_SCOPE`), with these events.
 */
const toStoredPoolState = ({
  deposits = [],
  withdrawals = [],
  aspLeaves = [],
  isEveryDepositApproved = false,
  lastSyncedBlock = 1000n
}: {
  deposits?: StoredPoolEventInput[]
  withdrawals?: StoredPoolEventInput[]
  aspLeaves?: bigint[]
  /** Adds every deposit's label to `aspLeaves`, so all of them count as cover. */
  isEveryDepositApproved?: boolean
  lastSyncedBlock?: bigint
} = {}) => {
  const hex = (value: bigint) => `0x${value.toString(16)}`
  const poolAddresses = Object.keys(getPrivacyPoolsChainConfig(1n)!.pools)
  const depositLabels = isEveryDepositApproved
    ? poolAddresses.flatMap((address, index) => {
        const depositsCount = deposits.filter(
          ({ pool }) => pool.toLowerCase() === address.toLowerCase()
        ).length

        return getPrivacyPoolsPoolLabels(
          FIRST_POOL_SCOPE + BigInt(index),
          1n,
          BigInt(depositsCount)
        )
      })
    : []
  const toTuples = (events: StoredPoolEventInput[], poolField: 'pool' | 'poolAddress') =>
    events.map(({ pool, value, blockNumber = 1000n }, index) => [
      hex(BigInt(index + 1)),
      { value: hex(value), blockNumber: hex(blockNumber), [poolField]: hex(BigInt(pool)) }
    ])

  return JSON.stringify({
    pools: {
      poolsTuples: poolAddresses.map((address, index) => [
        address,
        { address, scope: hex(FIRST_POOL_SCOPE + BigInt(index)) }
      ])
    },
    entrypointDeposits: { entrypointDepositsTuples: toTuples(deposits, 'poolAddress') },
    withdrawals: { withdrawalsTuples: toTuples(withdrawals, 'pool') },
    ragequits: { ragequitsTuples: [] },
    asp: { leaves: [...aspLeaves, ...depositLabels].map(hex) },
    sync: { lastSyncedBlock: hex(lastSyncedBlock) }
  })
}

/**
 * The chain's public history a sync persists the way the SDK does, when set. Pools with no events
 * otherwise, as most tests need nothing of it.
 */
let storedPoolState: string | null = null
/** What `ragequit` returns instead of a call for every note asked for, when set. */
let ragequitTxns: { to: string; data: string; value: bigint }[] | null = null
/** Holds `ragequit` until the test releases it, when set. */
let ragequitGate: Deferred | null = null
/** What `prepareUnshield` returns, or null for it to fail like proving did. */
let preparedWithdrawal:
  | ReturnType<typeof buildPreparedWithdrawal>
  | ReturnType<typeof buildPreparedRelayedWithdrawal>
  | null = null
/** What a run of a relayed withdrawal throws, when set: the node's revert, or its failure. */
let relayFailure: unknown = null
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
const SEND_SESSION = 'send-session-1'
const NEXT_SEND_SESSION = 'send-session-2'
/** Thrown by the entrypoint's asset config read when set. */
let assetConfigReadFailure: Error | null = null
let assetConfigReadCount = 0

/** The block our node is at. */
let nodeBlockNumber = WITHDRAWAL_BLOCK

/** Stands in for the connection to a withdrawal's bundler, see `readBlockNumber`. */
const bundlerProvider = {
  send: jest.fn<(method: string, params: unknown[]) => Promise<unknown>>(),
  destroy: jest.fn()
}
/** What the bundler answers when asked for the receipt of a withdrawal. */
const toUserOpReceipt = (blockNumber = WITHDRAWAL_BLOCK) => ({
  receipt: { blockNumber: toBeHex(blockNumber) }
})

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
    if (config)
      await this.host.storage.set(
        getPrivacyPoolsStoreKey(config),
        storedPoolState ?? toStoredPoolState()
      )
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
    // The real one syncs first, so it knows the phrase's notes after proving
    this.seedId = await this.host.keystore.deriveAt("m/28784'/1'/0'/0")
    if (isProvingOnUnshield) {
      const prover = await this.params.proverFactory()
      await prover.prove('withdraw', { existingSecret: 1n })
    }
    if (prepareUnshieldFailure) throw prepareUnshieldFailure
    if (preparedWithdrawal) return preparedWithdrawal

    throw new Error('prepareUnshield is not faked')
  }

  historyCount = 0

  // Syncs first too unless told not to, like the real one. Without a sync of its own, a plugin
  // knows nothing of the phrase (`seedId` is set by `sync`), so it reports no events, as the
  // real one would with no discovered secrets
  async history(_assets?: unknown, { sync = true }: { sync?: boolean } = {}) {
    if (sync) await this.sync()
    this.historyCount += 1
    if (historyGate) await historyGate.promise
    if (historyFailure) throw historyFailure

    const chainId: bigint = await this.host.provider.getChainId()

    return historyBySeed[`${this.seedId}:${chainId}`] || historyBySeed[this.seedId as string] || []
  }

  // The real one syncs before every read unless told not to, so the fake does too: a controller
  // that also calls `sync()` itself is caught by the sync counts. Like the real one, it leaves out
  // notes with no balance unless asked for them.
  async notes(_assets?: unknown, includeSpent = false, { sync = true } = {}) {
    if (sync) await this.sync()

    const notes = (notesBySeed[this.seedId as string] || []).filter(
      (note) => includeSpent || note.amount > 0n
    )

    return notes.map((note) => ({
      label: note.label,
      assetAddress: note.assetAddress ?? 0n,
      balance: note.amount,
      approved: note.approved,
      depositor: BigInt(note.depositor ?? DEPOSITOR),
      deposit: note.deposit ?? 0,
      value: note.value ?? note.amount,
      withdraw: note.withdraw ?? 0,
      blockNumber: note.blockNumber ?? 1n
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

jest.mock('../../services/provider', () => ({
  ...jest.requireActual<typeof import('../../services/provider')>('../../services/provider'),
  getRpcProvider: jest.fn()
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
  derivePrivacyKey = jest.fn(async (seedId: string) => seedId)

  removePrivacyKey = jest.fn(async () => {})

  isPrivacyKeyAvailable = jest.fn<(seedId: string, providerId: string) => boolean>(() => true)

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

  /** `open`, and tells the listeners a view appeared, as the popup does when the user opens it. */
  add(id: string, type: View['type'], route: string) {
    this.open(id, type, route)
    this.uiEvent.emit('addView', this.views.at(-1))
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
  if (data.startsWith(POOL_SCOPE_INTERFACE.getFunction('SCOPE')!.selector))
    return POOL_SCOPE_INTERFACE.encodeFunctionResult('SCOPE', [ETH_POOL_SCOPE])
  if (data.startsWith(RELAY_INTERFACE.getFunction('relay')!.selector)) {
    if (relayFailure) throw relayFailure

    return '0x'
  }
  if (data.startsWith(ENTRYPOINT_INTERFACE.getFunction('assetConfig')!.selector)) {
    assetConfigReadCount += 1
    if (assetConfigReadFailure) throw assetConfigReadFailure

    const [asset] = ENTRYPOINT_INTERFACE.decodeFunctionData('assetConfig', data)

    return ENTRYPOINT_INTERFACE.encodeFunctionResult('assetConfig', [
      // The Ethereum ETH pool by default, which the paymaster has an adapter for
      entrypointPool,
      String(asset).toLowerCase() === USDC ? MINIMUM_USDC_DEPOSIT : MINIMUM_DEPOSIT,
      VETTING_FEE_BPS,
      100n
    ])
  }

  return ERC20_INTERFACE.encodeFunctionResult('allowance', [allowance])
}

const createFakeProvider = (chainId: bigint) => ({
  getNetwork: async () => ({ chainId }),
  call: fakeProviderCall,
  getBlock: async () => ({ baseFeePerGas: latestBaseFee }),
  getBlockNumber: jest.fn(async () => nodeBlockNumber),
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

/** The selected account's row of a token on Ethereum, native by default. */
const getBalance = (controller: PrivacyPoolsController, tokenAddress = ZERO_ADDRESS) =>
  controller.balances['1']?.find((balance) => balance.tokenAddress === tokenAddress)

const WAIT_UNTIL_TIMEOUT_MS = 5000

/**
 * Resolves once the condition holds, or throws after WAIT_UNTIL_TIMEOUT_MS. A time limit and
 * not a count of event loop turns, as a busy CI machine needs many more turns for the same work.
 */
const waitUntil = async (condition: () => boolean) => {
  const deadline = Date.now() + WAIT_UNTIL_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (condition()) return

    await flush()
  }

  if (condition()) return

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
  hasOtherChain = false,
  // The paymaster, which most of these tests prove through. Null leaves the choice unset
  storedBroadcaster = 'kohaku'
}: {
  accounts?: string[]
  storage?: StorageController
  proverFactory?: PrivacyPoolsProverFactory
  hasOtherChain?: boolean
  storedBroadcaster?: string | null
} = {}) => {
  await storage.set(
    'privacyPoolsAccounts',
    accounts.map((seedId) => ({ seedId, createdAt: 1 }))
  )
  // Typed loosely, to also store a choice no longer offered
  if (storedBroadcaster !== null)
    await storage.set('privacyPoolsBroadcaster', storedBroadcaster as PrivacyPoolsBroadcaster)

  const keystore = new FakeKeystore()
  const featureFlags = new FakeFeatureFlags()
  const selectedAccount = new FakeSelectedAccount()
  const networks = new FakeNetworks()
  const providers = new FakeProviders()
  const ui = new FakeUi()
  // What `MainController` reports as waiting for the chain: broadcast, or in the request batch
  const pendingAccountOps: PendingAccountOp[] = []
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
    onAccountsRemoved,
    getPendingAccountOps: () => pendingAccountOps,
    tokenPrices: new TokenPricesController({
      fetch: fakeFetch as any,
      isTokenPricesEnabled: () => featureFlags.isFeatureEnabled('tokenPrices') === true
    })
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
    onAccountsRemoved,
    pendingAccountOps
  }
}

const ONE_ETH = 10n ** 18n
/** What a deposit putting `ONE_ETH` into the pool sends, with the fake entrypoint's 50 basis points on top. */
const ONE_ETH_WITH_VETTING_FEE = getDepositAmountWithVettingFee(ONE_ETH, VETTING_FEE_BPS)

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

/** Builds a deposit into a phrase's account, which syncs it first, and broadcasts it. */
const buildAndBroadcastDeposit = async (
  controller: PrivacyPoolsController,
  seedId = 'seed-b'
): Promise<Call[]> => {
  const building = buildDeposit(controller, { seedId })
  await releaseSync(seedId)
  const calls = await building
  controller.onAccountOpBroadcast({ chainId: 1n, calls })

  return calls
}

type PreparedTest = Awaited<ReturnType<typeof prepareTest>>

const getSyncCount = (seedId?: string) =>
  protocols
    .filter((protocol) => !seedId || protocol.seedId === seedId)
    .reduce((total, protocol) => total + protocol.syncCount, 0)

/** Waits until the chain's sync of the selected account is over. */
const waitForSynced = (controller: PrivacyPoolsController) =>
  waitUntil(() => controller.chains['1']?.syncStatus === 'ready')

/** Runs one round of the background sync and releases the syncs it starts, by default seed-b's. */
const syncRound = async (
  controller: PrivacyPoolsController,
  syncs: [seedId: string, chainId?: bigint][] = [['seed-b']]
) => {
  const round = controller.syncInBackground()
  await Promise.all(syncs.map(([seedId, chainId]) => releaseSync(seedId, chainId)))
  await round
}

/** The note a deposit into seed-b creates, once it lands. */
const landDeposit = () => {
  notesBySeed['seed-b'] = [
    ...notesBySeed['seed-b']!,
    // A deposit after the account's first one, so a higher index than any note it held
    { label: 3n, amount: ONE_ETH, approved: false, deposit: 1 }
  ]
}

/** Tells the controller a transaction got its outcome. Settles once the sync it starts, if any, ends. */
const finalize = (
  controller: PrivacyPoolsController,
  calls: Call[],
  status = AccountOpStatus.Success
) =>
  controller.onAccountOpsFinalized([
    { chainId: 1n, status, calls } as unknown as SubmittedAccountOp
  ])

/** Finalizes the transaction and waits for the read it starts, of seed-b by default. */
const finalizeAndRead = async (
  controller: PrivacyPoolsController,
  calls: Call[],
  seedId = 'seed-b'
) => {
  const finalizing = finalize(controller, calls)
  await releaseSync(seedId)
  await finalizing
}

/** Replaces `Date.now`, so a test can pass minutes at once. Call `restore` when done. */
const mockClock = (startMs = 1_000_000) => {
  let now = startMs
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => now)

  return {
    advance: (ms: number) => {
      now += ms
    },
    restore: () => spy.mockRestore()
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
    relayFailure = null
    prepareUnshieldFailure = null
    isProvingOnUnshield = false
    latestBaseFee = 10n ** 8n
    simulateWithdrawal = async () => successfulSimulation()
    rpcNoStateOverride = false
    entrypointPool = ETHEREUM_ETH_POOL
    assetConfigReadFailure = null
    assetConfigReadCount = 0
    nodeBlockNumber = WITHDRAWAL_BLOCK
    jest.mocked(getRpcProvider).mockReset()
    jest.mocked(getRpcProvider).mockReturnValue(bundlerProvider as any)
    bundlerProvider.send.mockReset()
    bundlerProvider.send.mockImplementation(async () => toUserOpReceipt())
    bundlerProvider.destroy.mockReset()
    notesBySeed = {
      'seed-a': [{ label: 1n, amount: 10n, approved: true }],
      'seed-b': [{ label: 2n, amount: 20n, approved: false }]
    }
    storedPoolState = null
    ragequitTxns = null
    ragequitGate = null
    historyBySeed = {}
    historyFailure = null
    historyGate = null
  })

  describe('accounts', () => {
    it('adds an account for a stored recovery phrase and persists it', async () => {
      const { controller, storage } = await prepareTest({ accounts: [] })

      await controller.addAccount('seed-a', 'Private account 1')

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-a'])
      expect((await storage.get('privacyPoolsAccounts', [])).map((a) => a.seedId)).toEqual([
        'seed-a'
      ])
    })

    it('stores the name the account is added with', async () => {
      const { controller, storage } = await prepareTest({ accounts: [] })

      await controller.addAccount('seed-a', 'Savings')

      expect(controller.accounts[0]?.label).toBe('Savings')
      expect((await storage.get('privacyPoolsAccounts', []))[0]?.label).toBe('Savings')
    })

    it('names a new account after the accounts there are already', async () => {
      const { controller } = await prepareTest({ accounts: [] })
      expect(controller.defaultAccountLabel).toBe('Private account 1')

      await controller.addAccount('seed-a', controller.defaultAccountLabel)

      expect(controller.defaultAccountLabel).toBe('Private account 2')
    })

    it('renames an account and persists the new name', async () => {
      const { controller, storage, ui } = await prepareTest({ accounts: [] })
      await controller.addAccount('seed-a', 'Private account 1')

      await controller.updateAccountLabel('seed-a', '  Savings  ', 'request-1')

      expect(controller.accounts[0]?.label).toBe('Savings')
      expect((await storage.get('privacyPoolsAccounts', []))[0]?.label).toBe('Savings')
      expect(ui.message.sendUiMessage).toHaveBeenCalledWith({ requestId: 'request-1', ok: true })
    })

    it('keeps the name when renamed to an empty one, and tells the rename sheet', async () => {
      const { controller, ui } = await prepareTest({ accounts: [] })
      await controller.addAccount('seed-a', 'Private account 1')

      await controller.updateAccountLabel('seed-a', '   ', 'request-1')

      expect(controller.accounts[0]?.label).toBe('Private account 1')
      expect(ui.message.sendUiMessage).toHaveBeenCalledWith({
        requestId: 'request-1',
        ok: false,
        error: "Couldn't rename the account. Please try again."
      })
    })

    it('renames no account for a recovery phrase without one', async () => {
      const { controller, storage } = await prepareTest({ accounts: ['seed-a'] })
      const storedBefore = await storage.get('privacyPoolsAccounts', [])

      await controller.updateAccountLabel('seed-b', 'Savings')

      expect(controller.accounts.map(({ seedId }) => seedId)).toEqual(['seed-a'])
      expect(controller.accounts.some(({ label }) => label === 'Savings')).toBe(false)
      expect(await storage.get('privacyPoolsAccounts', [])).toEqual(storedBefore)
      expect(controller.emittedErrors.at(-1)?.message).toBe(
        "Couldn't rename the account. Please try again."
      )
    })

    it('moves an account to another place in the list and saves the order', async () => {
      const { controller, storage } = await prepareTest()

      await controller.reorderAccounts({ fromIndex: 1, toIndex: 0 })

      expect(controller.accounts.map(({ seedId }) => seedId)).toEqual(['seed-b', 'seed-a'])
      expect((await storage.get('privacyPoolsAccounts', [])).map(({ seedId }) => seedId)).toEqual([
        'seed-b',
        'seed-a'
      ])
    })

    it('keeps the order when asked to move an account out of the list', async () => {
      const { controller, storage } = await prepareTest()
      const storedBefore = await storage.get('privacyPoolsAccounts', [])

      await controller.reorderAccounts({ fromIndex: 0, toIndex: 2 })

      expect(controller.accounts.map(({ seedId }) => seedId)).toEqual(['seed-a', 'seed-b'])
      expect(await storage.get('privacyPoolsAccounts', [])).toEqual(storedBefore)
      expect(controller.emittedErrors.at(-1)?.message).toBe(
        "Couldn't reorder the accounts. Please reload the page and try again."
      )
    })

    it('tells whether an account can be added, without adding it', async () => {
      const { controller } = await prepareTest({ accounts: ['seed-a'] })

      await expect(controller.assertCanAddAccount('seed-a')).rejects.toThrow(EmittableError)
      await expect(controller.assertCanAddAccount('seed-unknown')).rejects.toThrow(EmittableError)
      await expect(controller.assertCanAddAccount('seed-b')).resolves.toBeUndefined()
      expect(controller.accounts).toHaveLength(1)
    })

    it('refuses a second account for the same recovery phrase', async () => {
      const { controller } = await prepareTest({ accounts: ['seed-a'] })

      await expect(controller.addAccount('seed-a', 'Private account 1')).rejects.toThrow(
        EmittableError
      )
      expect(controller.accounts).toHaveLength(1)
    })

    it('refuses an account for a recovery phrase the wallet does not have', async () => {
      const { controller } = await prepareTest({ accounts: [] })

      await expect(controller.addAccount('seed-unknown', 'Private account 1')).rejects.toThrow(
        EmittableError
      )
      expect(controller.accounts).toHaveLength(0)
    })

    it('reports a removed account so the selection can move off it', async () => {
      const { controller, onAccountsRemoved } = await prepareTest()

      await controller.removeAccount('seed-a')

      expect(controller.accounts.map((account) => account.seedId)).toEqual(['seed-b'])
      expect(onAccountsRemoved).toHaveBeenCalledWith(['seed-a'])
    })

    it("drops a removed account's stored key, so re-adding it asks for the passphrase", async () => {
      const { controller, keystore } = await prepareTest()

      await controller.removeAccount('seed-a')

      expect(keystore.removePrivacyKey).toHaveBeenCalledTimes(1)
      expect(keystore.removePrivacyKey).toHaveBeenCalledWith('seed-a', 'privacyPools')
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
        onAccountsRemoved: jest.fn(async () => {}),
        getPendingAccountOps: () => [],
        tokenPrices: new TokenPricesController({ fetch: fakeFetch as any })
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
        onAccountsRemoved,
        getPendingAccountOps: () => [],
        tokenPrices: new TokenPricesController({ fetch: fakeFetch as any })
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
          'broadcaster',
          'chains',
          'depositAssetConfigs',
          'hasPersistedSendForm',
          'hasSyncedAnyChain',
          'history',
          'id',
          'initialLoadPromise',
          'isAvailableForSelectedAccount',
          'name',
          'operation',
          'poolStats',
          'prices',
          'sendableDeposits',
          'sendForm',
          'sendFormResetCounter',
          'statuses',
          'supportedChainIds',
          'unavailableReason',
          'withdrawalPrivacy'
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

    it("reads nothing, and stays silent, when the account's key is not available", async () => {
      const { controller, keystore, selectedAccount } = await prepareTest()
      keystore.isPrivacyKeyAvailable.mockImplementation((seedId) => seedId !== 'seed-a')

      selectedAccount.select('seed-a')
      expect(controller.unavailableReason).toBe('passphrase-needed')
      expect(keystore.isPrivacyKeyAvailable).toHaveBeenCalledWith('seed-a', 'privacyPools')

      const emittedErrorsCount = controller.emittedErrors.length
      await controller.syncInBackground()
      expect(runningSyncs).toHaveLength(0)
      expect(controller.emittedErrors).toHaveLength(emittedErrorsCount)

      // Unlocking comes first, as the key can't be read before it anyway
      keystore.isUnlocked = false
      expect(controller.unavailableReason).toBe('locked')
      keystore.isUnlocked = true

      selectedAccount.select('seed-b')
      expect(controller.unavailableReason).toBeNull()
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

      const { chains, balances, sendableDeposits } = controller.toJSON()
      expect(chains['1']).not.toHaveProperty('notes')
      expect(balances['1']).toHaveLength(1)
      // Named by number: a label would point to the deposit on chain
      expect(sendableDeposits['1']).toEqual([expect.objectContaining({ number: 1 })])
      expect(sendableDeposits['1']?.[0]).not.toHaveProperty('label')
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
      await controller.addAccount('seed-a', 'Private account 1')
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
      const { restore } = suppressConsole()
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
      restore()
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
      const { restore } = suppressConsole()
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
      restore()
    })

    it('proves a transfer without waiting for a sync of another network', async () => {
      const { restore } = suppressConsole()
      const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })
      selectedAccount.select('seed-a')

      const syncingOther = controller.syncChain(OTHER)
      await waitUntil(() => runningSyncs.length === 1)

      await controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
        amount: 10n ** 17n,
        recipient: WITHDRAWAL_RECIPIENT
      })

      // Reached proving with the other network's sync still running
      const provingProtocol = protocols.find((protocol) => protocol.syncCountWhenProving !== null)
      expect(provingProtocol?.syncCountWhenProving).toBe(0)
      expect(describeRunningSyncs()).toEqual(['seed-a on 10'])

      await releaseSync('seed-a', OTHER_CHAIN_ID)
      await syncingOther
      restore()
    })
  })
  describe('syncing on opening an account', () => {
    it('reads only the networks not read in the last 2 minutes', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      const clock = mockClock()

      try {
        selectedAccount.select('seed-a')
        ui.add('view-1', 'popup', 'dashboard')
        await releaseSync('seed-a')
        await waitForSynced(controller)

        clock.advance(OPEN_SYNC_MAX_AGE_MS - 1_000)
        ui.add('view-2', 'tab', 'dashboard')
        await flush()
        expect(runningSyncs).toHaveLength(0)

        clock.advance(1_000)
        ui.add('view-3', 'tab', 'dashboard')
        await releaseSync('seed-a')

        expect(getSyncCount()).toBe(2)
      } finally {
        clock.restore()
      }
    })

    it('reads on selecting an account when a view is open, each account on its own schedule', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      await flush()
      expect(runningSyncs).toHaveLength(0)

      ui.open('view-1', 'popup', 'dashboard')
      selectedAccount.select('seed-b')
      await releaseSync('seed-b')
      await waitForSynced(controller)

      // Read a moment ago for the second phrase, never for the first
      selectedAccount.select('seed-a')
      expect(controller.chains['1']?.lastSyncedAt).toBeNull()
      await releaseSync('seed-a')
      await waitForSynced(controller)

      expect(controller.chains['1']?.lastSyncedAt).not.toBeNull()
    })

    it.each([
      {
        until: 'its recovery phrase is backed up',
        block: (keystore: FakeKeystore) => {
          keystore.seeds = [{ id: 'seed-a', notBackedUp: true }, { id: 'seed-b' }]
        },
        unblock: (keystore: FakeKeystore) => {
          keystore.seeds = [{ id: 'seed-a' }, { id: 'seed-b' }]
        }
      },
      {
        until: 'the wallet is unlocked',
        block: (keystore: FakeKeystore) => {
          keystore.isUnlocked = false
        },
        unblock: (keystore: FakeKeystore) => {
          keystore.isUnlocked = true
        }
      }
    ])('does not read an account until $until, then reads it, once', async ({ block, unblock }) => {
      const { controller, keystore, selectedAccount, ui } = await prepareTest()
      block(keystore)
      keystore.fireUpdate()
      selectedAccount.select('seed-a')
      ui.add('view-1', 'popup', 'dashboard')
      await flush()
      expect(runningSyncs).toHaveLength(0)
      expect(controller.chains['1']?.syncStatus).toBe('idle')

      unblock(keystore)
      keystore.fireUpdate()
      await releaseSync('seed-a')
      await waitForSynced(controller)
      // Updates of the wallet that change nothing for the account are no reason to read it again
      keystore.fireUpdate()
      keystore.fireUpdate()
      await flush()

      expect(controller.chains['1']?.lastSyncedAt).not.toBeNull()
      expect(getSyncCount()).toBe(1)
    })

    it('reads again on a refresh however recent the last read is', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.add('view-1', 'popup', 'dashboard')
      await releaseSync('seed-a')
      await waitForSynced(controller)

      const refresh = controller.sync()
      await releaseSync('seed-a')
      await refresh

      expect(getSyncCount()).toBe(2)
    })
  })

  describe('syncing after a change', () => {
    it('reads an account that is not selected once its deposit lands', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')
      const calls = await buildAndBroadcastDeposit(controller)

      landDeposit()
      await finalizeAndRead(controller, calls)

      selectedAccount.select('seed-b')
      expect(getHeldAmounts(controller)).toEqual([20n + ONE_ETH])
    })

    it('reads once after a deposit lands, and stops counting it even when its note is not there yet', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-b')
      const calls = await buildAndBroadcastDeposit(controller)
      const syncCount = getSyncCount()

      // Our node can be a block behind the one that confirmed it
      await finalizeAndRead(controller, calls)

      expect(getSyncCount()).toBe(syncCount + 1)
      expect(runningSyncs).toHaveLength(0)
      expect(getBalance(controller)).toMatchObject({ totalAmount: 20n, simulationAmount: 0n })
    })

    it('holds back the next deposit until the sent one is in the notes', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-b')
      await buildAndBroadcastDeposit(controller)

      // No pending transaction is left to tell, so only the amount on its way does
      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)

      depositCountBySeed['seed-b'] = 1
      landDeposit()
      await syncRound(controller)

      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
    })

    it('ignores a transaction that is not finished, and reads once a batch is only partly complete', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-b')
      const calls = await buildAndBroadcastDeposit(controller)

      await finalize(controller, calls, AccountOpStatus.BroadcastedButNotConfirmed)
      expect(runningSyncs).toHaveLength(0)
      expect(getBalance(controller)).toMatchObject({ simulationAmount: ONE_ETH })

      // It lands later, and is still recognised. The deposit may be what landed.
      const finalizing = finalize(controller, calls, AccountOpStatus.PartiallyComplete)
      await releaseSync('seed-b')
      await finalizing
      expect(getBalance(controller)).toMatchObject({ simulationAmount: 0n })
    })

    it('ignores a transaction it did not build, and one it already finalized', async () => {
      const { controller } = await prepareTest()
      const calls = await buildAndBroadcastDeposit(controller)

      await finalize(controller, [{ ...calls[0]!, value: 3n * ONE_ETH }])
      expect(runningSyncs).toHaveLength(0)

      landDeposit()
      await finalizeAndRead(controller, calls)
      const syncCount = getSyncCount()

      await finalize(controller, calls)
      expect(getSyncCount()).toBe(syncCount)
      expect(runningSyncs).toHaveLength(0)
    })

    it.each([
      [
        'the wallet is locked',
        async ({ keystore }: PreparedTest) => {
          keystore.isUnlocked = false
          keystore.fireUpdate()
        }
      ],
      [
        'the account is removed',
        ({ controller }: PreparedTest) => controller.removeAccount('seed-b')
      ]
    ])('does not read the account when its deposit lands after %s', async (_, leave) => {
      const test = await prepareTest()
      const calls = await buildAndBroadcastDeposit(test.controller)
      await leave(test)
      const errorCount = test.controller.emittedErrors.length

      const finalizing = finalize(test.controller, calls)
      await flush()
      expect(runningSyncs).toHaveLength(0)
      runningSyncs.forEach(({ gate }) => gate.resolve())
      await finalizing

      expect(test.controller.emittedErrors).toHaveLength(errorCount)
    })

    it('stops counting a deposit when the read after it failed, as it is not read again', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-b')
      const calls = await buildAndBroadcastDeposit(controller)

      const { restore } = suppressConsole()
      const finalizing = finalize(controller, calls)
      const running = await takeRunningSync('seed-b', 1n)
      running.gate.reject(new Error('node unreachable'))
      await finalizing
      restore()

      expect(getBalance(controller)).toMatchObject({ simulationAmount: 0n })
      expect(runningSyncs).toHaveLength(0)
    })

    describe('the amounts shown while a change is on its way', () => {
      // The vetting fee of 50 basis points does not divide this evenly, and the pool still gets it
      const USDC_DEPOSIT = 5n * 10n ** 6n + 1n

      it('shows a deposit into an account that is not selected, with a row for a token it holds no notes of, until its notes land', async () => {
        const { controller, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-a')
        const building = buildDeposit(controller, { tokenAddress: USDC, amount: USDC_DEPOSIT })
        await releaseSync('seed-b')
        const calls = await building
        controller.onAccountOpBroadcast({ chainId: 1n, calls })

        // The selected account is not the one it goes to
        expect(getBalance(controller, USDC)).toBeUndefined()

        selectedAccount.select('seed-b')
        expect(getBalance(controller, USDC)).toMatchObject({
          totalAmount: 0n,
          simulationAmount: USDC_DEPOSIT,
          approvedAmountPostSimulation: 0n
        })
        expect(getBalance(controller)).toMatchObject({ totalAmount: 20n, simulationAmount: 0n })

        notesBySeed['seed-b'] = [
          ...notesBySeed['seed-b']!,
          {
            label: 3n,
            amount: USDC_DEPOSIT,
            approved: false,
            assetAddress: BigInt(USDC),
            deposit: 1
          }
        ]
        await finalizeAndRead(controller, calls)

        expect(getBalance(controller, USDC)).toMatchObject({
          totalAmount: USDC_DEPOSIT,
          simulationAmount: 0n
        })
      })

      it('does not count the deposit twice when a read shows its note before the transaction is finalized', async () => {
        const { controller, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-b')
        const calls = await buildAndBroadcastDeposit(controller)
        expect(getBalance(controller)).toMatchObject({
          totalAmount: 20n,
          simulationAmount: ONE_ETH
        })

        landDeposit()
        const reading = controller.syncChain('1')
        await releaseSync('seed-b')
        await reading

        expect(getBalance(controller)).toMatchObject({
          totalAmount: 20n + ONE_ETH,
          simulationAmount: 0n
        })

        await finalizeAndRead(controller, calls)
        expect(getBalance(controller)).toMatchObject({ simulationAmount: 0n })
      })

      it.each([
        ['failed', AccountOpStatus.Failure],
        ['was rejected', AccountOpStatus.Rejected],
        ['is stuck', AccountOpStatus.BroadcastButStuck],
        ['was dropped', AccountOpStatus.UnknownButPastNonce]
      ])(
        'stops showing a deposit whose transaction %s at once, without reading the account, and tells the UI',
        async (_, status) => {
          const { controller, selectedAccount } = await prepareTest()
          selectedAccount.select('seed-b')
          const calls = await buildAndBroadcastDeposit(controller)
          expect(getBalance(controller)).toMatchObject({
            simulationAmount: ONE_ETH
          })
          const onUpdate = jest.fn()
          controller.onUpdate(onUpdate)

          await finalize(controller, calls, status)

          expect(getBalance(controller)).toMatchObject({ totalAmount: 20n, simulationAmount: 0n })
          expect(onUpdate).toHaveBeenCalled()
          expect(runningSyncs).toHaveLength(0)
        }
      )

      it('keeps showing a deposit whose transaction is not finished', async () => {
        const { controller, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-b')
        const calls = await buildAndBroadcastDeposit(controller)

        await finalize(controller, calls, AccountOpStatus.BroadcastedButNotConfirmed)

        expect(getBalance(controller)).toMatchObject({
          simulationAmount: ONE_ETH
        })
      })

      it('keeps showing a deposit while another token of the account changes, and drops it once its own note shows', async () => {
        const { controller, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-b')
        await buildAndBroadcastDeposit(controller)

        // Another token's note shows first, which changes the notes but not what was waited for
        notesBySeed['seed-b'] = [
          ...notesBySeed['seed-b']!,
          { label: 4n, amount: 7n, approved: true, assetAddress: BigInt(USDC) }
        ]
        await syncRound(controller)

        expect(getBalance(controller)).toMatchObject({
          totalAmount: 20n,
          simulationAmount: ONE_ETH
        })
        expect(getBalance(controller, USDC)).toMatchObject({
          totalAmount: 7n,
          simulationAmount: 0n
        })

        landDeposit()
        await syncRound(controller)

        expect(getBalance(controller)).toMatchObject({
          totalAmount: 20n + ONE_ETH,
          simulationAmount: 0n
        })
      })

      it('does not show a deposit after a lock, though it was broadcast before it', async () => {
        const { controller, keystore, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-b')
        await buildAndBroadcastDeposit(controller)
        expect(getBalance(controller)).toMatchObject({
          simulationAmount: ONE_ETH
        })

        keystore.isUnlocked = false
        keystore.fireUpdate()
        keystore.isUnlocked = true
        keystore.fireUpdate()
        const reading = controller.syncChain('1')
        await releaseSync('seed-b')
        await reading

        expect(getBalance(controller)).toMatchObject({ totalAmount: 20n, simulationAmount: 0n })
      })
    })

    describe('the background round', () => {
      it('reads every network of the selected account', async () => {
        const { controller, selectedAccount } = await prepareTest({ hasOtherChain: true })
        selectedAccount.select('seed-a')

        const round = controller.syncInBackground()
        await releaseSync('seed-a', 1n)
        await releaseSync('seed-a', OTHER_CHAIN_ID)
        await round

        expect(controller.chains['1']?.lastSyncedAt).not.toBeNull()
        expect(controller.chains[OTHER_CHAIN_ID.toString()]?.lastSyncedAt).not.toBeNull()
      })

      it('reads nothing while locked, or before the phrase is backed up, or with no account selected', async () => {
        const { controller, keystore, selectedAccount } = await prepareTest()

        await controller.syncInBackground()
        selectedAccount.select('seed-a')
        keystore.seeds = [{ id: 'seed-a', notBackedUp: true }, { id: 'seed-b' }]
        await controller.syncInBackground()
        keystore.seeds = [{ id: 'seed-a' }, { id: 'seed-b' }]
        keystore.isUnlocked = false
        await controller.syncInBackground()

        expect(runningSyncs).toHaveLength(0)
        expect(protocols).toHaveLength(0)
      })
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
      const { restore } = suppressConsole()
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
      restore()
    })
  })

  describe('deposits', () => {
    it('builds a deposit into an account that is not the selected one, after syncing it', async () => {
      const { controller } = await prepareTest()

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      const calls = await building

      expect(calls).toEqual([
        {
          to: ETHEREUM_ENTRYPOINT,
          value: ONE_ETH_WITH_VETTING_FEE,
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

      expect(secondCall?.value).toBe(getDepositAmountWithVettingFee(2n * ONE_ETH, VETTING_FEE_BPS))
      expect(protocols.reduce((total, protocol) => total + protocol.prepareShieldCount, 0)).toBe(1)
      expect(protocols.reduce((total, protocol) => total + protocol.syncCount, 0)).toBe(1)
    })

    it('refuses amounts Privacy Pools does not accept', async () => {
      const { controller } = await prepareTest()

      // The minimum is of what is sent, the fee included
      const belowMinimum = getMaxDepositPoolValue(MINIMUM_DEPOSIT, VETTING_FEE_BPS) - 1n
      await expect(buildDeposit(controller, { amount: belowMinimum })).rejects.toThrow(
        EmittableError
      )
      await expect(buildDeposit(controller, { amount: 10_001n * ONE_ETH })).rejects.toThrow(
        EmittableError
      )
      await expect(
        buildDeposit(controller, { tokenAddress: '0x0000000000000000000000000000000000000abc' })
      ).rejects.toThrow(EmittableError)
    })

    it('checks the limits against what is sent, the fee added to the typed amount', async () => {
      const { controller } = await prepareTest()
      const { maxDeposit } = getPrivacyPoolsDepositAsset(1n, ZERO_ADDRESS)!

      // Below the minimum as typed, but not once the fee is added
      const building = buildDeposit(controller, { amount: MINIMUM_DEPOSIT - 1n })
      await releaseSync('seed-b')
      const [justAboveMinimum] = await building
      expect(justAboveMinimum?.value).toBe(
        getDepositAmountWithVettingFee(MINIMUM_DEPOSIT - 1n, VETTING_FEE_BPS)
      )

      const largestAmount = getMaxDepositPoolValue(maxDeposit, VETTING_FEE_BPS)
      const [largest] = await buildDeposit(controller, { amount: largestAmount })
      expect(largest?.value).toBe(getDepositAmountWithVettingFee(largestAmount, VETTING_FEE_BPS))
      expect(largest!.value).toBeLessThanOrEqual(maxDeposit)

      // The maximum as typed, which the fee takes above it
      await expect(buildDeposit(controller, { amount: maxDeposit })).rejects.toThrow(
        'accepts at most'
      )
    })

    it('refuses a deposit into an account whose key is not available, before reading it', async () => {
      const { controller, keystore } = await prepareTest()
      keystore.isPrivacyKeyAvailable.mockReturnValue(false)

      await expect(buildDeposit(controller)).rejects.toThrow('needs its passphrase again')
      expect(keystore.isPrivacyKeyAvailable).toHaveBeenCalledWith('seed-b', 'privacyPools')
      expect(runningSyncs).toHaveLength(0)
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

    it('reads what the entrypoint accepts once per Send session', async () => {
      const { controller } = await prepareTest()
      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, SEND_SESSION)
      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, SEND_SESSION)

      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      await building
      await buildDeposit(controller)

      expect(assetConfigReadCount).toBe(1)
    })

    it('refuses a deposit into a pool 0xBow replaced before the next Send session', async () => {
      const { controller } = await prepareTest()
      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, SEND_SESSION)
      entrypointPool = '0x000000000000000000000000000000000000bEEF'
      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, NEXT_SEND_SESSION)

      await expect(buildDeposit(controller)).rejects.toThrow(
        'Sending ETH to a Privacy Pools account is not supported yet.'
      )
      expect(runningSyncs).toHaveLength(0)
    })

    it("keeps the last read when the next Send session's read fails", async () => {
      const { controller } = await prepareTest()
      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, SEND_SESSION)
      assetConfigReadFailure = new Error('RPC unavailable')

      await expect(
        controller.loadDepositAssetConfig('1', ZERO_ADDRESS, NEXT_SEND_SESSION)
      ).resolves.toEqual({ minimumDepositAmount: MINIMUM_DEPOSIT, vettingFeeBPS: VETTING_FEE_BPS })
      const building = buildDeposit(controller)
      await releaseSync('seed-b')

      await expect(building).resolves.toHaveLength(1)
      expect(assetConfigReadCount).toBe(2)
    })

    it('reads again on building a deposit when no read succeeded yet', async () => {
      const { controller } = await prepareTest()
      assetConfigReadFailure = new Error('RPC unavailable')
      await expect(
        controller.loadDepositAssetConfig('1', ZERO_ADDRESS, SEND_SESSION)
      ).rejects.toThrow(
        'Could not check what Privacy Pools accepts for this token. Please try again.'
      )
      assetConfigReadFailure = null

      const building = buildDeposit(controller)
      await releaseSync('seed-b')

      await expect(building).resolves.toHaveLength(1)
      expect(assetConfigReadCount).toBe(2)
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
      const depositAmount = getDepositAmountWithVettingFee(amount, VETTING_FEE_BPS)

      const building = buildDeposit(controller, { tokenAddress: USDC, amount })
      await releaseSync('seed-b')
      const withApproval = await building

      expect(withApproval).toEqual([
        {
          // The configured asset address, which is checksummed
          to: getPrivacyPoolsAsset(1n, USDC)!.address,
          value: 0n,
          data: ERC20_INTERFACE.encodeFunctionData('approve', [ETHEREUM_ENTRYPOINT, depositAmount])
        },
        {
          to: ETHEREUM_ENTRYPOINT,
          value: 0n,
          data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(address,uint256,uint256)', [
            USDC,
            depositAmount,
            getPrecommitment('seed-b')
          ])
        }
      ])

      allowance = depositAmount
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
        ERC20_INTERFACE.encodeFunctionData('approve', [
          ETHEREUM_ENTRYPOINT,
          getDepositAmountWithVettingFee(amount, VETTING_FEE_BPS)
        ])
      )
      expect(depositCall?.to).toBe(ETHEREUM_ENTRYPOINT)
    })

    /** Builds and broadcasts a deposit, which Activity then lists as waiting for the chain. */
    const pendDeposit = async (
      controller: PrivacyPoolsController,
      pendingAccountOps: PendingAccountOp[]
    ) => {
      const calls = await buildAndBroadcastDeposit(controller)
      pendingAccountOps.push({ chainId: 1n, calls })

      return calls
    }

    it('refuses another deposit until the broadcast one lands and the chain moves on', async () => {
      const { controller, pendingAccountOps } = await prepareTest()
      const calls = await pendDeposit(controller, pendingAccountOps)

      // Same precommitment, since the first one has not landed, whatever the amount
      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)
      await expect(buildDeposit(controller, { amount: 2n * ONE_ETH })).rejects.toThrow(
        EmittableError
      )

      // It lands, and the sync that follows moves the precommitment on
      depositCountBySeed['seed-b'] = 1
      landDeposit()
      pendingAccountOps.length = 0
      await finalizeAndRead(controller, calls)

      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
      expect(runningSyncs).toHaveLength(0)
    })

    // It reads the precommitment from Activity's op, not from what this session built
    it('refuses a deposit still pending from before a restart', async () => {
      const first = await prepareTest()
      const calls = await buildAndBroadcastDeposit(first.controller)

      const { controller, pendingAccountOps } = await prepareTest({ storage: first.storage })
      pendingAccountOps.push({ chainId: 1n, calls })
      const refusal = expect(buildDeposit(controller)).rejects.toThrow(EmittableError)
      // The account is read again, the network is not
      await flush()
      runningSyncs.forEach((sync) => sync.gate.resolve())

      await refusal
    })

    // The 15 minutes it was refused for before are long gone, yet a raw transaction can still be mined
    it('keeps refusing a deposit for as long as its transaction can still be mined', async () => {
      const { controller, pendingAccountOps } = await prepareTest()
      await pendDeposit(controller, pendingAccountOps)
      const clock = mockClock(Date.now() + 60 * 60 * 1000)

      try {
        await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)
      } finally {
        clock.restore()
      }
    })

    it.each([
      AccountOpStatus.Failure,
      AccountOpStatus.Rejected,
      AccountOpStatus.UnknownButPastNonce,
      AccountOpStatus.BroadcastButStuck
    ])('lets the next deposit through once the transaction is %s', async (status) => {
      const { controller, pendingAccountOps } = await prepareTest()
      const calls = await pendDeposit(controller, pendingAccountOps)
      await expect(buildDeposit(controller)).rejects.toThrow(EmittableError)

      // Activity no longer lists it as waiting for the chain
      pendingAccountOps.length = 0
      await finalize(controller, calls, status)

      await expect(buildDeposit(controller)).resolves.toHaveLength(1)
      // Nothing landed, so there is nothing to look for
      expect(runningSyncs).toHaveLength(0)
    })

    it.each([
      [
        'another precommitment',
        (): PendingAccountOp => ({
          chainId: 1n,
          calls: [
            {
              to: ETHEREUM_ENTRYPOINT,
              value: ONE_ETH,
              // The fake derives the same precommitment for every phrase of one length, so another one
              data: ENTRYPOINT_INTERFACE.encodeFunctionData('deposit(uint256)', [
                getPrecommitment('seed-b') + 1n
              ])
            }
          ]
        })
      ],
      ['another chain', (calls: Call[]): PendingAccountOp => ({ chainId: 10n, calls })]
    ])('does not block a deposit over a pending one with %s', async (_, toPendingOp) => {
      const { controller, pendingAccountOps } = await prepareTest()
      // Not broadcast, as that alone holds back the next deposit
      const building = buildDeposit(controller)
      await releaseSync('seed-b')
      pendingAccountOps.push(toPendingOp(await building))

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

    it('keeps a deposit the form picked when the screen is opened for its token', async () => {
      const { controller, selectedAccount, ui } = await prepareTest()
      selectedAccount.select('seed-a')
      ui.open('view-1', 'popup', 'dashboard')
      controller.updateSendForm({ tokenId: '1:0xabcd:2' })

      ui.navigate('view-1', SEND_ROUTE, { chainId: '1', address: '0xAbCd' })
      expect(controller.sendForm.tokenId).toBe('1:0xabcd:2')

      // Not a deposit of it: a token whose address starts the same
      ui.navigate('view-1', SEND_ROUTE, { chainId: '1', address: '0xAb' })
      expect(controller.sendForm.tokenId).toBe('1:0xab')
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
    beforeEach(() => {
      // A deposit that pays a send of WITHDRAWAL_AMOUNT
      notesBySeed['seed-a'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
    })

    it('refuses to prove a transfer to something that is not an address', async () => {
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      await expect(
        controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          depositNumber: 1,
          amount: 10n ** 17n,
          recipient: 'vitalik'
        })
      ).rejects.toThrow(EmittableError)
      await expect(
        controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          depositNumber: 1,
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
          depositNumber: 1,
          amount: 10n ** 17n,
          recipient: WITHDRAWAL_RECIPIENT
        })
      ).rejects.toThrow(EmittableError)

      expect(controller.operation).toBeNull()
      expect(protocols).toHaveLength(0)
    })

    it('leaves the sync before proving to the SDK when none is queued', async () => {
      const { restore } = suppressConsole()
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      await controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
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
      restore()
    })

    it('waits for a queued sync to finish before proving, without adding one', async () => {
      const { restore } = suppressConsole()
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')

      const syncing = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)

      const preparing = controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
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
      restore()
    })

    const prepareSignedWithdrawal = async () => {
      preparedWithdrawal = buildPreparedWithdrawal()
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')

      await test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
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
        depositNumber: 1,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })

      return test
    }

    it('explains a fee above the amount, although the SDK throws it from a thunk', async () => {
      const { restore } = suppressConsole()
      prepareUnshieldFailure = toThunkFailure(
        'Withdrawal amount too small to cover the sponsored gas fee'
      )

      const { controller } = await prepareFailingWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error:
          'This amount is too small to cover the network fee for sending it. Please try a larger amount.'
      })
      restore()
    })

    it('keeps what the SDK said about a failure it cannot explain to the user', async () => {
      const { restore } = suppressConsole()
      prepareUnshieldFailure = toThunkFailure('Leaf not found in the leaves array.')

      const { controller } = await prepareFailingWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.'
      })
      const emitted = controller.emittedErrors.at(-1)
      expect(emitted?.level).toBe('major')
      expect(emitted?.error.message).toBe('Leaf not found in the leaves array.')
      restore()
    })

    it('drops a proved transfer with its account, so re-adding the account cannot send it', async () => {
      const { controller } = await prepareSignedWithdrawal()
      expect(controller.operation).toMatchObject({ phase: 'ready' })
      jest.mocked(createPPv1Broadcaster).mockClear()

      await controller.removeAccount('seed-a')
      await controller.addAccount('seed-a', 'Private account 1')

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
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
        broadcast: async () => BROADCAST_RESULT
      } as any)

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.status === 'success')

      expect(controller.hasPersistedSendForm).toBe(false)

      await releaseSync('seed-a')
      await broadcasting
    })

    it('reads the history along with the sync after the transfer, so the activity lists it at once', async () => {
      const { controller } = await prepareSignedWithdrawal()
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
        broadcast: async () => BROADCAST_RESULT
      } as any)
      historyBySeed = { 'seed-a': [historyEvent({ value: WITHDRAWAL_AMOUNT })] }

      const broadcasting = controller.broadcastWithdrawal()
      await releaseSync('seed-a')
      await broadcasting

      // Though no screen showed it
      expect(protocols[0]!.historyCount).toBe(1)
      expect(protocols[0]!.syncCount).toBe(1)

      // Opening the activity then neither syncs nor reads it again
      await controller.filterHistory('dashboard')
      expect(runningSyncs).toHaveLength(0)
      expect(protocols[0]!.historyCount).toBe(1)
      expect(controller.history.dashboard?.result?.items.map(({ amount }) => amount)).toEqual([
        WITHDRAWAL_AMOUNT
      ])
    })

    it('clears the send form when the transfer could not be sent', async () => {
      const { restore } = suppressConsole()
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
      restore()
    })

    it('reports a transfer that could not be sent without a toast, as the open sheet shows it', async () => {
      const { restore } = suppressConsole()
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
      restore()
    })

    describe('reading the account after it was sent', () => {
      /** Reads the proved withdrawal's account, so there are notes to compare with after. */
      const prepareReadWithdrawal = async (
        notes: (typeof notesBySeed)[string] = [
          { label: 1n, amount: WITHDRAWAL_AMOUNT + 10n, approved: true }
        ]
      ) => {
        notesBySeed['seed-a'] = notes
        const test = await prepareSignedWithdrawal()
        const syncing = test.controller.syncChain('1')
        await releaseSync('seed-a')
        await syncing

        return test
      }

      const mockBroadcastResult = () =>
        jest
          .mocked(createPPv1Broadcaster)
          .mockReturnValueOnce({ broadcast: async () => BROADCAST_RESULT } as any)

      /** A broadcast that settles once the test says the bundler accepted the withdrawal. */
      const mockReceiptWait = () => {
        const receipt = createDeferred()
        jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
          broadcast: () => receipt.promise.then(() => BROADCAST_RESULT)
        } as any)

        return receipt
      }

      /** Holds back the bundler's answer to the next request for a withdrawal's block. */
      const holdBlockRead = () => {
        const answer = createDeferred()
        bundlerProvider.send.mockImplementationOnce(async () => {
          await answer.promise

          return toUserOpReceipt()
        })

        return answer
      }

      it.each([
        ['a regular account', null],
        ['another Privacy Pools account', 'seed-b']
      ])(
        'reads the account it came from, though the user switched to %s while it was sent',
        async (_, switchedTo) => {
          const { controller, selectedAccount } = await prepareSignedWithdrawal()
          const receipt = mockReceiptWait()

          const broadcasting = controller.broadcastWithdrawal()
          await waitUntil(() => controller.operation?.phase === 'broadcasting')
          selectedAccount.select(switchedTo)
          receipt.resolve()
          await releaseSync('seed-a')

          // With no account selected, the sync of the selected account threw
          await expect(broadcasting).resolves.toBeUndefined()
          expect(controller.emittedErrors).toHaveLength(0)
          expect(protocols).toHaveLength(1)
          expect(runningSyncs).toHaveLength(0)
        }
      )

      it('asks for the block of the withdrawal from the bundler it was sent to, and closes that connection', async () => {
        const { controller } = await prepareReadWithdrawal()
        mockBroadcastResult()

        const broadcasting = controller.broadcastWithdrawal()
        await releaseSync('seed-a')
        await broadcasting

        // Not Ambire's own bundler account, which would link the withdrawal to it
        expect(getRpcProvider).toHaveBeenCalledTimes(1)
        expect(getRpcProvider).toHaveBeenCalledWith([PAYMASTER_BUNDLER_URL], 1n)
        expect(bundlerProvider.send).toHaveBeenCalledWith('eth_getUserOperationReceipt', [
          USER_OP_HASH
        ])
        expect(bundlerProvider.destroy).toHaveBeenCalledTimes(1)
      })

      it('waits for our node to reach the block of the withdrawal, then reads the account once', async () => {
        nodeBlockNumber = WITHDRAWAL_BLOCK - 1
        const { controller, providers } = await prepareReadWithdrawal()
        const syncCount = getSyncCount()
        mockBroadcastResult()

        const broadcasting = controller.broadcastWithdrawal()
        await waitUntil(() => providers.providers['1'].getBlockNumber.mock.calls.length >= 2)
        expect(runningSyncs).toHaveLength(0)

        nodeBlockNumber = WITHDRAWAL_BLOCK
        notesBySeed['seed-a'] = [{ label: 7n, amount: 10n, approved: true }]
        await releaseSync('seed-a')
        await broadcasting

        expect(getSyncCount()).toBe(syncCount + 1)
        expect(getBalance(controller)).toMatchObject({ totalAmount: 10n, simulationAmount: 0n })
      })

      it.each([
        ['cannot be reached', () => bundlerProvider.send.mockRejectedValueOnce(new Error('down'))],
        ['has no receipt yet', () => bundlerProvider.send.mockResolvedValueOnce(null)]
      ])(
        'reads the account at once when the bundler %s, and closes the connection',
        async (_, breakBundler) => {
          const { restore } = suppressConsole()
          const { controller, providers } = await prepareReadWithdrawal()
          const syncCount = getSyncCount()
          mockBroadcastResult()
          breakBundler()

          const broadcasting = controller.broadcastWithdrawal()
          await releaseSync('seed-a')
          await broadcasting
          restore()

          expect(getSyncCount()).toBe(syncCount + 1)
          expect(providers.providers['1'].getBlockNumber).not.toHaveBeenCalled()
          expect(controller.emittedErrors).toEqual([expect.objectContaining({ level: 'silent' })])
          expect(bundlerProvider.destroy).toHaveBeenCalledTimes(1)
        }
      )

      it('does not read the account when the wallet is locked by the time the transfer lands', async () => {
        const { controller, keystore } = await prepareReadWithdrawal()
        const receipt = mockReceiptWait()

        const broadcasting = controller.broadcastWithdrawal()
        await waitUntil(() => controller.operation?.phase === 'broadcasting')
        keystore.isUnlocked = false
        keystore.fireUpdate()
        receipt.resolve()
        await broadcasting

        expect(runningSyncs).toHaveLength(0)
      })

      it('reads the account once and stops counting the transfer, even when its notes do not show it yet', async () => {
        const { controller } = await prepareReadWithdrawal()
        const syncCount = getSyncCount()
        mockBroadcastResult()

        const broadcasting = controller.broadcastWithdrawal()
        await releaseSync('seed-a')
        await broadcasting

        expect(getSyncCount()).toBe(syncCount + 1)
        expect(runningSyncs).toHaveLength(0)
        expect(getHeldAmounts(controller)).toEqual([WITHDRAWAL_AMOUNT + 10n])
        expect(getBalance(controller)).toMatchObject({
          simulationAmount: 0n,
          approvedAmountPostSimulation: WITHDRAWAL_AMOUNT + 10n
        })
      })

      it('reads the account at once, and stops counting the transfer, when it could not be confirmed', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareReadWithdrawal()
        const syncCount = getSyncCount()
        jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
          broadcast: async () => {
            throw new Error('receipt wait timed out')
          }
        } as any)

        const broadcasting = controller.broadcastWithdrawal()
        await releaseSync('seed-a')
        await broadcasting
        restore()

        // It may have landed all the same
        expect(getSyncCount()).toBe(syncCount + 1)
        expect(getBalance(controller)).toMatchObject({ simulationAmount: 0n })
      })

      it('does not hold back a deposit into the account while the transfer is on its way', async () => {
        const { controller } = await prepareReadWithdrawal()
        const receipt = mockReceiptWait()

        const broadcasting = controller.broadcastWithdrawal()
        await waitUntil(() => controller.operation?.phase === 'broadcasting')
        expect(getBalance(controller)).toMatchObject({ simulationAmount: -WITHDRAWAL_AMOUNT })

        // A transfer does not change the next deposit's precommitment
        await expect(buildDeposit(controller, { seedId: 'seed-a' })).resolves.toHaveLength(1)

        receipt.resolve()
        await releaseSync('seed-a')
        await broadcasting
      })

      describe('the amounts shown while it is on its way', () => {
        it('shows the amount as gone from the approved balance until the notes show it', async () => {
          const { controller } = await prepareReadWithdrawal()
          expect(getBalance(controller)).toMatchObject({
            approvedAmountPostSimulation: WITHDRAWAL_AMOUNT + 10n,
            simulationAmount: 0n
          })
          const receipt = mockReceiptWait()

          const broadcasting = controller.broadcastWithdrawal()
          await waitUntil(() => controller.operation?.phase === 'broadcasting')

          // The notes still hold all of it
          expect(getBalance(controller)).toMatchObject({
            totalAmount: WITHDRAWAL_AMOUNT + 10n,
            approvedAmount: WITHDRAWAL_AMOUNT + 10n,
            simulationAmount: -WITHDRAWAL_AMOUNT,
            approvedAmountPostSimulation: 10n
          })

          notesBySeed['seed-a'] = [{ label: 7n, amount: 10n, approved: true }]
          receipt.resolve()
          await releaseSync('seed-a')
          await broadcasting

          expect(getBalance(controller)).toMatchObject({
            totalAmount: 10n,
            simulationAmount: 0n,
            approvedAmountPostSimulation: 10n
          })
        })

        it('shows the amount as gone from the deposit it is sent from, and only from it', async () => {
          const { controller } = await prepareReadWithdrawal([
            { label: 1n, amount: ONE_ETH, approved: true, deposit: 0 },
            { label: 2n, amount: ONE_ETH, approved: true, deposit: 1 }
          ])
          const block = holdBlockRead()
          mockBroadcastResult()

          const broadcasting = controller.broadcastWithdrawal()
          await waitUntil(() => bundlerProvider.send.mock.calls.length === 1)

          expect(
            controller.sendableDeposits['1']?.map(({ number, availableAmount }) => ({
              number,
              availableAmount
            }))
          ).toEqual([
            { number: 1, availableAmount: ONE_ETH - WITHDRAWAL_AMOUNT },
            { number: 2, availableAmount: ONE_ETH }
          ])

          notesBySeed['seed-a'] = [
            { label: 1n, amount: ONE_ETH - WITHDRAWAL_AMOUNT, approved: true, deposit: 0 },
            { label: 2n, amount: ONE_ETH, approved: true, deposit: 1 }
          ]
          block.resolve()
          await releaseSync('seed-a')
          await broadcasting

          // Not taken out twice once the notes show it
          expect(controller.sendableDeposits['1']?.[0]?.availableAmount).toBe(
            ONE_ETH - WITHDRAWAL_AMOUNT
          )
        })

        it('keeps showing a transfer when the notes only show another one, sent before it, that spent a different note of the token', async () => {
          const { controller } = await prepareReadWithdrawal([
            { label: 1n, amount: ONE_ETH, approved: true },
            { label: 2n, amount: ONE_ETH, approved: true }
          ])
          // Both are on their way: the bundler has taken them, and their blocks are not known yet
          const firstBlock = holdBlockRead()
          const secondBlock = holdBlockRead()
          mockBroadcastResult()
          const first = controller.broadcastWithdrawal()
          await waitUntil(() => bundlerProvider.send.mock.calls.length === 1)

          await controller.prepareWithdrawal({
            chainId: '1',
            tokenAddress: ZERO_ADDRESS,
            depositNumber: 1,
            amount: WITHDRAWAL_AMOUNT,
            recipient: WITHDRAWAL_RECIPIENT
          })
          mockBroadcastResult()
          const second = controller.broadcastWithdrawal()
          await waitUntil(() => bundlerProvider.send.mock.calls.length === 2)
          expect(getBalance(controller)).toMatchObject({
            totalAmount: 2n * ONE_ETH,
            simulationAmount: -2n * WITHDRAWAL_AMOUNT,
            approvedAmountPostSimulation: 2n * ONE_ETH - 2n * WITHDRAWAL_AMOUNT
          })

          // The first lands and is read, spending from one note. The second is still on its way.
          notesBySeed['seed-a'] = [
            { label: 1n, amount: ONE_ETH - WITHDRAWAL_AMOUNT, approved: true },
            { label: 2n, amount: ONE_ETH, approved: true }
          ]
          firstBlock.resolve()
          await releaseSync('seed-a')
          await first

          expect(getBalance(controller)).toMatchObject({
            totalAmount: 2n * ONE_ETH - WITHDRAWAL_AMOUNT,
            simulationAmount: -WITHDRAWAL_AMOUNT,
            approvedAmountPostSimulation: 2n * ONE_ETH - 2n * WITHDRAWAL_AMOUNT
          })

          notesBySeed['seed-a'] = [
            { label: 1n, amount: ONE_ETH - WITHDRAWAL_AMOUNT, approved: true },
            { label: 2n, amount: ONE_ETH - WITHDRAWAL_AMOUNT, approved: true }
          ]
          secondBlock.resolve()
          await releaseSync('seed-a')
          await second

          expect(getBalance(controller)).toMatchObject({
            totalAmount: 2n * ONE_ETH - 2n * WITHDRAWAL_AMOUNT,
            simulationAmount: 0n,
            approvedAmountPostSimulation: 2n * ONE_ETH - 2n * WITHDRAWAL_AMOUNT
          })
        })

        it('does not show the transfer after a lock, though it was sent before it', async () => {
          const { controller, keystore } = await prepareReadWithdrawal()
          const receipt = mockReceiptWait()
          const broadcasting = controller.broadcastWithdrawal()
          await waitUntil(() => controller.operation?.phase === 'broadcasting')

          keystore.isUnlocked = false
          keystore.fireUpdate()
          keystore.isUnlocked = true
          keystore.fireUpdate()
          const reading = controller.syncChain('1')
          await releaseSync('seed-a')
          await reading

          expect(getBalance(controller)).toMatchObject({
            totalAmount: WITHDRAWAL_AMOUNT + 10n,
            simulationAmount: 0n,
            approvedAmountPostSimulation: WITHDRAWAL_AMOUNT + 10n
          })

          receipt.resolve()
          await releaseSync('seed-a')
          await broadcasting
        })
      })
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
        const broadcast = jest.fn(async () => BROADCAST_RESULT)
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

      it('does not count a transfer that was never sent because it had gone stale', async () => {
        const { controller } = await prepareSignedWithdrawal()
        const syncing = controller.syncChain('1')
        await releaseSync('seed-a')
        await syncing

        now += RECHECK_AFTER_MS
        latestBaseFee = 2n * 10n ** 9n
        await controller.broadcastWithdrawal()

        // Nothing left the account, so none of it shows as on its way
        expect(getBalance(controller)).toMatchObject({
          totalAmount: ONE_ETH,
          simulationAmount: 0n,
          approvedAmountPostSimulation: ONE_ETH
        })
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
        const { restore } = suppressConsole()
        const { controller } = await prepareSignedWithdrawal()
        const broadcast = mockBroadcast()

        now += RECHECK_AFTER_MS
        simulateWithdrawal = async () => {
          throw new Error('the node is down')
        }
        await sendSuccessfully(controller)

        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(controller.emittedErrors.at(-1)).toMatchObject({ level: 'silent' })
        restore()
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
          const { restore } = suppressConsole()
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
          restore()
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
      const { restore } = suppressConsole()
      simulateWithdrawal = async () => {
        throw new Error('the method eth_simulateV1 does not exist/is not available')
      }

      const { controller } = await prepareSignedWithdrawal()

      expect(describeHumanization(controller.operation?.humanization)).toEqual(humanizedSend(null))
      restore()
    })

    it('describes a transfer only once it is proved', async () => {
      const test = await prepareTest()
      test.selectedAccount.select('seed-a')
      preparedWithdrawal = buildPreparedWithdrawal()

      const preparing = test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })
      expect(test.controller.operation).toMatchObject({ phase: 'proving', humanization: null })

      await preparing
      expect(test.controller.operation?.humanization).not.toBeNull()
    })

    it('refuses a transfer proved from the pool of another token', async () => {
      // A pool the paymaster sponsors too, so only the token tells the two apart
      const { restore } = suppressConsole()
      entrypointPool = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'

      const { controller } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.',
        quote: null,
        humanization: null
      })
      expect(controller.emittedErrors.at(-1)?.error.message).toMatch(/pool of a different token/)
      restore()
    })

    it('shows only the most a transfer can cost when the node cannot run it', async () => {
      const { restore } = suppressConsole()
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
      restore()
    })

    it('does not fail a transfer the simulation says would revert, leaving that to the bundler', async () => {
      const { restore } = suppressConsole()
      simulateWithdrawal = async () => [{ calls: [{ status: '0x0', logs: [] }] }]

      const { controller } = await prepareSignedWithdrawal()

      expect(controller.operation).toMatchObject({
        phase: 'ready',
        quote: { feeAmount: WITHDRAWAL_FEE, expectedFeeAmount: null }
      })
      restore()
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

    it('asks the SDK for one deposit, with the unused gas refunded to the recipient', async () => {
      await prepareSignedWithdrawal()

      const [protocol] = protocols
      expect(protocol?.unshieldOptions).toEqual({
        mode: 'paymaster',
        refundRecipient: WITHDRAWAL_RECIPIENT
      })
    })

    describe('the deposit it is sent from', () => {
      /** seed-a with `notes`, synced, proving a send of `WITHDRAWAL_AMOUNT` from `depositNumber`. */
      const prepareFromDeposit = async (
        notes: (typeof notesBySeed)[string],
        depositNumber: number
      ) => {
        notesBySeed['seed-a'] = notes
        preparedWithdrawal = buildPreparedWithdrawal()
        const test = await prepareTest()
        test.selectedAccount.select('seed-a')
        const syncing = test.controller.syncChain('1')
        await releaseSync('seed-a')
        await syncing

        await test.controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          depositNumber,
          amount: WITHDRAWAL_AMOUNT,
          recipient: WITHDRAWAL_RECIPIENT
        })

        return test
      }

      const DEPOSIT_UNAVAILABLE_ERROR =
        'This deposit does not have enough left for this amount. Please send less, or pick another deposit.'
      const OTHER_DEPOSIT_PICKED_ERROR =
        'This amount cannot be sent from this deposit yet. Please send all of it, or pick another deposit.'

      it('proves a send from the deposit the SDK picks for the amount', async () => {
        const { controller } = await prepareFromDeposit(
          [
            { label: 1n, amount: ONE_ETH, approved: true },
            { label: 2n, amount: WITHDRAWAL_AMOUNT, approved: true }
          ],
          2
        )

        expect(controller.operation).toMatchObject({ status: 'pending', phase: 'ready' })
      })

      it('refuses, before proving, a deposit the SDK would not pick for the amount', async () => {
        const { restore } = suppressConsole()
        // The SDK spends the deposit with the least left that covers the amount
        const { controller } = await prepareFromDeposit(
          [
            { label: 1n, amount: ONE_ETH, approved: true },
            { label: 2n, amount: WITHDRAWAL_AMOUNT, approved: true }
          ],
          1
        )

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: OTHER_DEPOSIT_PICKED_ERROR
        })
        expect(protocols[0]?.syncCountWhenProving).toBeNull()
        restore()
      })

      it('refuses a deposit the SDK would skip for a smaller pending one', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareFromDeposit(
          [
            { label: 1n, amount: ONE_ETH, approved: true },
            { label: 2n, amount: WITHDRAWAL_AMOUNT, approved: false }
          ],
          1
        )

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: OTHER_DEPOSIT_PICKED_ERROR
        })
        restore()
      })

      it('refuses a pending deposit, one too small, and one the account does not have', async () => {
        const { restore } = suppressConsole()
        const pending = await prepareFromDeposit(
          [{ label: 1n, amount: ONE_ETH, approved: false }],
          1
        )
        expect(pending.controller.operation?.error).toBe(DEPOSIT_UNAVAILABLE_ERROR)

        const tooSmall = await prepareFromDeposit(
          [{ label: 1n, amount: WITHDRAWAL_AMOUNT - 1n, approved: true }],
          1
        )
        expect(tooSmall.controller.operation?.error).toBe(DEPOSIT_UNAVAILABLE_ERROR)

        const unknown = await prepareFromDeposit(
          [{ label: 1n, amount: ONE_ETH, approved: true }],
          9
        )
        expect(unknown.controller.operation?.error).toBe(DEPOSIT_UNAVAILABLE_ERROR)
        restore()
      })

      it("refuses a proof once the SDK's own sync shows it would pick another deposit", async () => {
        const { restore } = suppressConsole()
        notesBySeed['seed-a'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
        preparedWithdrawal = buildPreparedWithdrawal()
        const { controller, selectedAccount } = await prepareTest()
        selectedAccount.select('seed-a')
        const syncing = controller.syncChain('1')
        await releaseSync('seed-a')
        await syncing
        // A deposit the last sync did not see, which the SDK spends instead
        notesBySeed['seed-a'] = [
          { label: 1n, amount: ONE_ETH, approved: true },
          { label: 2n, amount: WITHDRAWAL_AMOUNT, approved: true }
        ]

        await controller.prepareWithdrawal({
          chainId: '1',
          tokenAddress: ZERO_ADDRESS,
          depositNumber: 1,
          amount: WITHDRAWAL_AMOUNT,
          recipient: WITHDRAWAL_RECIPIENT
        })

        expect(controller.operation).toMatchObject({
          status: 'failed',
          error: OTHER_DEPOSIT_PICKED_ERROR
        })
        restore()
      })
    })
  })
  describe('choosing who sends', () => {
    it('sends through 0xBow unless the user chose otherwise, also over a choice no longer offered', async () => {
      const unset = await prepareTest({ storedBroadcaster: null })
      expect(unset.controller.broadcaster).toBe('0xbow')

      const unknown = await prepareTest({ storedBroadcaster: 'railgun' })
      expect(unknown.controller.broadcaster).toBe('0xbow')
    })

    it('keeps the choice after a restart', async () => {
      const storage = new StorageController(produceMemoryStore())
      const { controller } = await prepareTest({ storage, storedBroadcaster: null })

      await controller.setBroadcaster('kohaku')
      expect(controller.broadcaster).toBe('kohaku')

      const restarted = await prepareTest({ storage, storedBroadcaster: null })
      expect(restarted.controller.broadcaster).toBe('kohaku')
    })

    it('drops a transfer proved for the other one, which only it could send', async () => {
      notesBySeed['seed-a'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
      preparedWithdrawal = buildPreparedWithdrawal()
      const { controller, selectedAccount } = await prepareTest()
      selectedAccount.select('seed-a')
      await controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })
      expect(controller.operation?.phase).toBe('ready')

      await controller.setBroadcaster('0xbow')

      expect(controller.operation).toBeNull()
      await expect(controller.broadcastWithdrawal()).rejects.toThrow(EmittableError)
    })
  })

  describe('sending through the 0xBow relayers', () => {
    beforeEach(() => {
      notesBySeed['seed-a'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
      jest.mocked(createPPv1Broadcaster).mockClear()
    })

    const prepareRelayedWithdrawal = async (
      withdrawal: ReturnType<typeof buildPreparedRelayedWithdrawal> | null = null,
      beforePreparing: (test: Awaited<ReturnType<typeof prepareTest>>) => void = () => {}
    ) => {
      preparedWithdrawal = withdrawal ?? buildPreparedRelayedWithdrawal()
      const test = await prepareTest({ storedBroadcaster: '0xbow' })
      test.selectedAccount.select('seed-a')
      beforePreparing(test)

      await test.controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
        amount: WITHDRAWAL_AMOUNT,
        recipient: WITHDRAWAL_RECIPIENT
      })

      return test
    }

    const OFFER_EXPIRED_ERROR =
      'The price for sending this ran out while the transfer was being prepared. Please try again.'

    it('asks the SDK for a relayed withdrawal and shows its fee as exact, without running it', async () => {
      const { controller, providers } = await prepareRelayedWithdrawal()

      expect(protocols[0]?.unshieldOptions).toEqual({ mode: 'relayer' })
      expect(protocols[0]?.params.relayersList).toEqual(getPrivacyPoolsChainConfig(1n)!.relayers)
      expect(controller.operation).toMatchObject({
        broadcaster: '0xbow',
        status: 'pending',
        phase: 'ready',
        quote: {
          feeAmount: RELAYED_WITHDRAWAL_FEE,
          amountAfterFee: WITHDRAWAL_AMOUNT - RELAYED_WITHDRAWAL_FEE,
          expectedFeeAmount: RELAYED_WITHDRAWAL_FEE
        }
      })
      // The fee is exact, so there is nothing to run for it
      expect(providers.providers['1'].send).not.toHaveBeenCalled()
    })

    it('does not need ERC-4337 smart account features, which only Kohaku goes through', async () => {
      const { controller } = await prepareRelayedWithdrawal(null, ({ featureFlags }) =>
        featureFlags.set('erc4337', false)
      )

      expect(controller.operation).toMatchObject({ status: 'pending', phase: 'ready' })
    })

    it('refuses a relayed withdrawal that pays out to someone else', async () => {
      const { restore } = suppressConsole()
      const { controller } = await prepareRelayedWithdrawal(
        buildPreparedRelayedWithdrawal({ recipient: RELAYER_FEE_RECIPIENT })
      )

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error: 'The transfer could not be prepared. Please try again.'
      })
      restore()
    })

    it('refuses an offer that runs out before the user could confirm it', async () => {
      const { restore } = suppressConsole()
      const { controller } = await prepareRelayedWithdrawal(
        buildPreparedRelayedWithdrawal({ expiresIn: 5_000 })
      )

      expect(controller.operation).toMatchObject({ status: 'failed', error: OFFER_EXPIRED_ERROR })
      restore()
    })

    it('explains when no relayer gave a usable price', async () => {
      const { restore } = suppressConsole()
      prepareUnshieldFailure = new Error('All relayers failed to provide a quote')

      const { controller } = await prepareRelayedWithdrawal()

      expect(controller.operation).toMatchObject({
        status: 'failed',
        error:
          'The 0xBow relayers could not take this transfer right now. Please try again in a moment, or choose Kohaku in the send settings.'
      })
      restore()
    })

    it('sends it to the relayers, and reads the account a few blocks on without asking for its receipt', async () => {
      const { controller, providers } = await prepareRelayedWithdrawal()
      const broadcast = jest.fn(async () => RELAYED_BROADCAST_RESULT)
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({ broadcast } as any)
      const syncCount = getSyncCount()

      const broadcasting = controller.broadcastWithdrawal()
      await waitUntil(() => controller.operation?.status === 'success')
      expect(jest.mocked(createPPv1Broadcaster).mock.calls[0]![1]).toEqual({
        broadcasterUrl: getPrivacyPoolsChainConfig(1n)!.relayers
      })
      expect(broadcast).toHaveBeenCalledWith(preparedWithdrawal)

      // Waits for our node to pass the block it most likely lands in
      await waitUntil(() => providers.providers['1'].getBlockNumber.mock.calls.length >= 2)
      expect(runningSyncs).toHaveLength(0)
      nodeBlockNumber = WITHDRAWAL_BLOCK + 3
      await releaseSync('seed-a')
      await broadcasting

      expect(getSyncCount()).toBe(syncCount + 1)
      // Neither the bundler nor anyone else is asked about the transaction
      expect(getRpcProvider).not.toHaveBeenCalled()
      expect(providers.providers['1'].send).not.toHaveBeenCalled()
    })

    describe('sent a while after it was proved', () => {
      let now: number

      beforeEach(() => {
        now = Date.now()
        jest.spyOn(Date, 'now').mockImplementation(() => now)
      })

      afterEach(() => {
        jest.mocked(Date.now).mockRestore()
      })

      const STALE_ERROR = 'This transfer has expired. Go back to prepare it again.'

      it('goes stale once the offer runs out, and is never sent', async () => {
        const { controller } = await prepareRelayedWithdrawal()

        // Before the recheck interval, but too close to the offer's end for the relayer
        now += 41_000
        await controller.broadcastWithdrawal()

        expect(controller.operation).toMatchObject({ status: 'failed', error: STALE_ERROR })
        expect(createPPv1Broadcaster).not.toHaveBeenCalled()
      })

      it('runs an older one again, and goes stale when it would now fail on chain', async () => {
        const { controller } = await prepareRelayedWithdrawal()
        relayFailure = makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: ETHEREUM_ENTRYPOINT, data: '0x' },
          invocation: null,
          revert: null
        })

        now += 31_000
        await controller.recheckWithdrawal()

        expect(controller.operation).toMatchObject({ status: 'failed', error: STALE_ERROR })
      })

      it('keeps an older one the node cannot run, for the relayer to check', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareRelayedWithdrawal()
        relayFailure = new Error('fetch failed')

        now += 31_000
        await controller.recheckWithdrawal()

        expect(controller.operation).toMatchObject({ status: 'pending', phase: 'ready' })
        restore()
      })
    })
  })

  describe('cancelling a transfer', () => {
    beforeEach(() => {
      // A deposit that pays a send of WITHDRAWAL_AMOUNT
      notesBySeed['seed-a'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
    })

    const SEND_ROUTE = 'privacy-pools-send'

    const startWithdrawal = (controller: PrivacyPoolsController) =>
      controller.prepareWithdrawal({
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        depositNumber: 1,
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
      jest.mocked(createPPv1Broadcaster).mockReturnValueOnce({
        broadcast: () => sending.promise.then(() => BROADCAST_RESULT)
      } as any)

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
      notesBySeed['seed-b'] = [{ label: 1n, amount: ONE_ETH, approved: true }]
      const { controller, selectedAccount, proofs, preparing } = await startProving()

      selectedAccount.select('seed-b')
      expect(proofs[0]!.signal?.aborted).toBe(true)
      // The open view reads the account that was selected, which the next proof waits for
      await releaseSync('seed-b')

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

  describe('history', () => {
    const SESSION = 'privacy-pools-dashboard'
    const DEPOSIT = historyEvent({
      type: 'deposit',
      depositor: BigInt(DEPOSITOR),
      label: 1n,
      aspStatus: 'approved',
      value: 10n,
      blockNumber: 101n,
      timestamp: 1_700_000_100n
    } as Partial<PPv1HistoryEvent>)
    const WITHDRAWAL = historyEvent({ value: 4n })

    beforeEach(() => {
      historyBySeed = {
        'seed-a': [DEPOSIT, WITHDRAWAL],
        'seed-b': [historyEvent({ value: 99n })]
      }
    })

    const getPage = (controller: PrivacyPoolsController) => controller.history[SESSION]?.result

    const getAmounts = (controller: PrivacyPoolsController) =>
      getPage(controller)?.items.map(({ amount }) => amount)

    /** Opens a screen, then lets through the sync that reads the notes, and the history with them. */
    const openHistory = async (
      controller: PrivacyPoolsController,
      seedId = 'seed-a',
      ...args: Parameters<PrivacyPoolsController['filterHistory']> extends [any, ...infer Rest]
        ? Rest
        : never
    ) => {
      const opening = controller.filterHistory(SESSION, ...args)
      await releaseSync(seedId)
      await opening
    }

    const prepareSelected = async (options: Parameters<typeof prepareTest>[0] = {}) => {
      const prepared = await prepareTest(options)
      prepared.selectedAccount.select('seed-a')

      return prepared
    }

    it('is not read while no screen shows it', async () => {
      const { controller } = await prepareSelected()

      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      expect(protocols[0]!.historyCount).toBe(0)
      expect(controller.history).toEqual({})
    })

    it('is read by a sync once a screen shows it, after the balances are shown', async () => {
      const { controller } = await prepareSelected()
      historyGate = createDeferred()

      const opening = controller.filterHistory(SESSION)
      await flush()
      // Not an empty page: whether there is any activity is not known yet
      expect(controller.history[SESSION]).toMatchObject({ result: null, error: null })

      await releaseSync('seed-a')
      await waitUntil(() => controller.chains['1']?.syncStatus === 'ready')
      expect(getHeldAmounts(controller)).toEqual([10n])
      expect(getPage(controller)).toBeNull()

      historyGate.resolve()
      await opening
      expect(getPage(controller)).toEqual({
        items: [
          expect.objectContaining({ type: 'deposit', amount: 10n, counterpartyAddr: DEPOSITOR }),
          expect.objectContaining({ type: 'withdrawal', amount: 4n, counterpartyAddr: null })
        ],
        itemsTotal: 2,
        currentPage: 0,
        maxPages: 1
      })
      expect(protocols).toHaveLength(1)
      expect(protocols[0]!.historyCount).toBe(1)
      // As of the sync that read the notes, without one of its own
      expect(protocols[0]!.syncCount).toBe(1)
    })

    it('is read from the plugin that read the notes, even once it is dropped', async () => {
      // A plugin that read a cold chain from the CDN is dropped after its sync, and a new one
      // would know none of the account's deposits without syncing again
      jest
        .mocked(createPrivacyPoolsDataService)
        .mockResolvedValueOnce({ dataService: {}, isSagaHydrated: true } as any)
      const { controller } = await prepareSelected()

      await openHistory(controller)

      expect(protocols).toHaveLength(1)
      expect(protocols[0]!.historyCount).toBe(1)
      expect(getAmounts(controller)).toEqual([10n, 4n])
    })

    describe('on opening a screen after a sync that did not read it', () => {
      const syncFirst = async (controller: PrivacyPoolsController, seedId = 'seed-a') => {
        const syncing = controller.syncChain('1')
        await releaseSync(seedId)
        await syncing
      }

      it('is read from that sync, without syncing again', async () => {
        const { controller } = await prepareSelected()
        await syncFirst(controller)
        const syncStatuses: (string | undefined)[] = []
        const unsubscribe = controller.onUpdate(() =>
          syncStatuses.push(controller.chains['1']?.syncStatus)
        )

        const opening = controller.filterHistory(SESSION)
        await flush()
        // The balances are not shown as loading again
        expect(controller.chains['1']?.syncStatus).toBe('ready')
        await opening
        unsubscribe()

        expect(syncStatuses.length).toBeGreaterThan(0)
        expect(syncStatuses).not.toContain('syncing')
        expect(runningSyncs).toHaveLength(0)
        expect(protocols).toHaveLength(1)
        expect(protocols[0]!.syncCount).toBe(1)
        expect(protocols[0]!.historyCount).toBe(1)
        expect(getAmounts(controller)).toEqual([10n, 4n])
      })

      it('syncs again once the plugin that read the notes is gone', async () => {
        // A plugin that read a cold chain from the CDN is dropped after its sync, and a new one
        // would know none of the account's deposits without syncing
        jest
          .mocked(createPrivacyPoolsDataService)
          .mockResolvedValueOnce({ dataService: {}, isSagaHydrated: true } as any)
        const { controller } = await prepareSelected()
        await syncFirst(controller)

        await openHistory(controller)

        expect(protocols).toHaveLength(2)
        expect(protocols[0]!.historyCount).toBe(0)
        expect(protocols[1]!.historyCount).toBe(1)
        expect(getAmounts(controller)).toEqual([10n, 4n])
      })

      it("syncs again once another account's sync of the network has replaced its plugin", async () => {
        const { controller, selectedAccount } = await prepareSelected()
        await syncFirst(controller)
        selectedAccount.select('seed-b')
        await syncFirst(controller, 'seed-b')
        selectedAccount.select('seed-a')

        await openHistory(controller)

        // seed-a's, seed-b's, then seed-a's again, built from what seed-b's sync stored
        expect(protocols).toHaveLength(3)
        expect(protocols[0]!.historyCount).toBe(0)
        expect(protocols[2]!.historyCount).toBe(1)
        expect(getAmounts(controller)).toEqual([10n, 4n])
      })

      it('syncs again when that sync failed', async () => {
        const { controller } = await prepareSelected()
        await syncFirst(controller)
        const failing = controller.syncChain('1')
        const running = await takeRunningSync('seed-a', 1n)
        running.gate.reject(new Error('RPC is down'))
        await failing

        await openHistory(controller)

        expect(protocols[0]!.syncCount).toBe(3)
        expect(controller.chains['1']).toMatchObject({ syncStatus: 'ready', error: null })
        expect(getAmounts(controller)).toEqual([10n, 4n])
      })

      it('is not kept once a newer sync has read it, even one ending in the same millisecond', async () => {
        // Both syncs end at the same time, so only a count of the syncs tells them apart
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
        try {
          const { controller } = await prepareSelected()
          await syncFirst(controller)
          const staleRead = createDeferred()
          jest.spyOn(protocols[0]!, 'history').mockImplementationOnce(async () => {
            await staleRead.promise
            return [WITHDRAWAL]
          })

          const opening = controller.filterHistory(SESSION)
          await flush()
          historyBySeed['seed-a'] = [historyEvent({ value: 7n, blockNumber: 200n })]
          const refreshing = controller.sync()
          await releaseSync('seed-a')
          await refreshing
          staleRead.resolve()
          await opening

          expect(getAmounts(controller)).toEqual([7n])
        } finally {
          now.mockRestore()
        }
      })
    })

    it('reports an empty page for an account with no activity', async () => {
      historyBySeed = {}
      const { controller } = await prepareSelected()

      await openHistory(controller)

      expect(getPage(controller)).toEqual({ items: [], itemsTotal: 0, currentPage: 0, maxPages: 0 })
    })

    it('moves between pages without reading it again', async () => {
      const { controller } = await prepareSelected()
      await openHistory(controller, 'seed-a', {}, { fromPage: 0, itemsPerPage: 1 })
      expect(getAmounts(controller)).toEqual([10n])
      expect(getPage(controller)?.maxPages).toBe(2)

      await controller.filterHistory(SESSION, {}, { fromPage: 1, itemsPerPage: 1 })

      expect(runningSyncs).toHaveLength(0)
      expect(getAmounts(controller)).toEqual([4n])
      expect(protocols[0]!.historyCount).toBe(1)
    })

    it('is read again by every sync while shown', async () => {
      const { controller } = await prepareSelected()
      await openHistory(controller)

      historyBySeed['seed-a'] = [
        historyEvent({ value: 7n, blockNumber: 200n }),
        DEPOSIT,
        WITHDRAWAL
      ]
      const refreshing = controller.sync()
      await releaseSync('seed-a')
      await refreshing

      expect(getAmounts(controller)).toEqual([7n, 10n, 4n])
    })

    it('is no longer read once its screen closes', async () => {
      const { controller } = await prepareSelected()
      await openHistory(controller)

      controller.resetHistoryFilters(SESSION)
      const refreshing = controller.sync()
      await releaseSync('seed-a')
      await refreshing

      expect(controller.history).toEqual({})
      expect(protocols[0]!.historyCount).toBe(1)
    })

    it('keeps another screen open when one closes', async () => {
      const { controller } = await prepareSelected()
      await openHistory(controller)
      await controller.filterHistory('settings')

      controller.resetHistoryFilters(SESSION)

      expect(Object.keys(controller.history)).toEqual(['settings'])
      expect(controller.history.settings?.result?.items).toHaveLength(2)
    })

    it('shows the last list while it is read again on reopening', async () => {
      const { controller } = await prepareSelected()
      await openHistory(controller)
      controller.resetHistoryFilters(SESSION)
      // A sync while no screen shows it leaves the list behind the balances
      const refreshing = controller.sync()
      await releaseSync('seed-a')
      await refreshing

      historyBySeed['seed-a'] = [historyEvent({ value: 7n, blockNumber: 200n })]
      historyGate = createDeferred()
      const reopening = controller.filterHistory(SESSION)
      await waitUntil(() => protocols[0]!.historyCount === 2)
      expect(getAmounts(controller)).toEqual([10n, 4n])

      historyGate.resolve()
      await reopening
      expect(getAmounts(controller)).toEqual([7n])
      // Read as of the last sync, without another
      expect(protocols[0]!.syncCount).toBe(2)
    })

    it('is read by a sync already running when the screen opens, rather than by another', async () => {
      const { controller } = await prepareSelected()

      const syncing = controller.syncChain('1')
      await waitUntil(() => runningSyncs.length === 1)
      const opening = controller.filterHistory(SESSION)
      await releaseSync('seed-a')
      await Promise.all([syncing, opening])

      expect(runningSyncs).toHaveLength(0)
      expect(protocols[0]!.syncCount).toBe(1)
      expect(getAmounts(controller)).toEqual([10n, 4n])
    })

    it("shows the selected account's history only", async () => {
      const { controller, selectedAccount } = await prepareSelected()
      await openHistory(controller)

      selectedAccount.select('seed-b')
      // The other account's list is never shown in its place
      expect(getPage(controller)).toBeNull()

      await openHistory(controller, 'seed-b')
      expect(getAmounts(controller)).toEqual([99n])

      selectedAccount.select('seed-a')
      expect(getAmounts(controller)).toEqual([10n, 4n])
    })

    it('marks a deposit under review only while it is still being verified', async () => {
      notesBySeed = { 'seed-a': [{ label: 2n, amount: 5n, approved: false }] }
      historyBySeed = {
        'seed-a': [
          // Still being verified
          historyEvent({ type: 'deposit', label: 2n, aspStatus: 'pending', depositor: 1n } as any),
          // Taken back, so it has no note left, though the plugin still reports it pending
          historyEvent({ type: 'deposit', label: 3n, aspStatus: 'pending', depositor: 1n } as any),
          historyEvent({ type: 'ragequit', ragequitter: 1n, value: 6n } as any)
        ]
      }
      const { controller } = await prepareSelected()

      await openHistory(controller)

      expect(getPage(controller)?.items.map(({ status }) => status)).toEqual([
        'pending',
        null,
        null
      ])
    })

    it('waits for the recovery phrase to be backed up, like the balances', async () => {
      const { controller, keystore } = await prepareSelected()
      keystore.seeds = [{ id: 'seed-a', notBackedUp: true }, { id: 'seed-b' }]

      await controller.filterHistory(SESSION)

      expect(runningSyncs).toHaveLength(0)
      expect(getPage(controller)).toBeNull()
    })

    it('is not read while locked', async () => {
      const { controller, keystore } = await prepareSelected()
      keystore.isUnlocked = false

      await controller.filterHistory(SESSION)

      expect(runningSyncs).toHaveLength(0)
      expect(controller.emittedErrors).toEqual([])
    })

    it('is dropped on lock', async () => {
      const { controller, keystore } = await prepareSelected()
      await openHistory(controller)

      keystore.isUnlocked = false
      keystore.fireUpdate()
      keystore.isUnlocked = true
      keystore.fireUpdate()

      expect(getPage(controller)).toBeNull()
    })

    it('is not kept from a read that finishes after a lock', async () => {
      const { controller, keystore } = await prepareSelected()
      historyGate = createDeferred()

      const opening = controller.filterHistory(SESSION)
      await releaseSync('seed-a')
      await waitUntil(() => protocols[0]!.historyCount === 1)
      keystore.isUnlocked = false
      keystore.fireUpdate()
      historyGate.resolve()
      await opening
      keystore.isUnlocked = true
      keystore.fireUpdate()

      expect(getPage(controller)).toBeNull()
      expect(controller.emittedErrors).toEqual([])
    })

    it('is not kept for a removed account', async () => {
      const { controller } = await prepareSelected()
      historyGate = createDeferred()

      const opening = controller.filterHistory(SESSION)
      await releaseSync('seed-a')
      await waitUntil(() => protocols[0]!.historyCount === 1)
      await controller.removeAccount('seed-a')
      historyGate.resolve()
      await opening

      expect(protocols[0]!.historyCount).toBe(1)
      expect(getPage(controller)).toBeNull()
    })

    describe('when it cannot be read', () => {
      it('still shows the balances, and an empty page with the reason', async () => {
        historyFailure = new Error('history failed')
        const { controller } = await prepareSelected()

        await openHistory(controller)

        expect(getHeldAmounts(controller)).toEqual([10n])
        expect(controller.chains['1']).toMatchObject({ syncStatus: 'ready', error: null })
        expect(controller.history[SESSION]).toMatchObject({
          result: { items: [] },
          error: 'Could not load your activity on this network. Please try again.'
        })
        expect(controller.emittedErrors.at(-1)).toMatchObject({
          level: 'silent',
          error: historyFailure
        })
      })

      it('keeps the list read before', async () => {
        const { controller } = await prepareSelected()
        await openHistory(controller)

        historyFailure = new Error('history failed')
        const refreshing = controller.sync()
        await releaseSync('seed-a')
        await refreshing

        expect(getAmounts(controller)).toEqual([10n, 4n])
        expect(controller.history[SESSION]?.error).not.toBeNull()
      })

      it('clears the reason once read again', async () => {
        historyFailure = new Error('history failed')
        const { controller } = await prepareSelected()
        await openHistory(controller)

        historyFailure = null
        const refreshing = controller.sync()
        await releaseSync('seed-a')
        await refreshing

        expect(controller.history[SESSION]).toMatchObject({ error: null })
        expect(getAmounts(controller)).toEqual([10n, 4n])
      })

      it('settles the page with the reason when the balances cannot be read either', async () => {
        const { controller } = await prepareSelected()

        const opening = controller.filterHistory(SESSION)
        const running = await takeRunningSync('seed-a', 1n)
        running.gate.reject(new Error('RPC is down'))
        await opening

        expect(controller.history[SESSION]).toMatchObject({
          result: { items: [] },
          error: 'Could not load your Privacy Pools balance on this network. Please try again.'
        })
      })
    })

    describe('on several networks', () => {
      const OTHER = OTHER_CHAIN_ID.toString()

      beforeEach(() => {
        historyBySeed = {
          'seed-a:1': [
            historyEvent({ value: 3n, timestamp: 300n }),
            historyEvent({ value: 1n, timestamp: 100n })
          ],
          [`seed-a:${OTHER}`]: [historyEvent({ value: 2n, timestamp: 200n })]
        }
      })

      it('merges them newest first, once every network is read', async () => {
        const { controller } = await prepareSelected({ hasOtherChain: true })

        const opening = controller.filterHistory(SESSION)
        await releaseSync('seed-a')
        await waitUntil(() => !!controller.chains['1']?.lastSyncedAt)
        // One network alone is not the whole history yet
        expect(getPage(controller)).toBeNull()

        await releaseSync('seed-a', OTHER_CHAIN_ID)
        await opening

        expect(getAmounts(controller)).toEqual([3n, 2n, 1n])
      })

      it('reads and shows only the network it is narrowed to', async () => {
        const { controller } = await prepareSelected({ hasOtherChain: true })

        const opening = controller.filterHistory(SESSION, { chainId: OTHER })
        await releaseSync('seed-a', OTHER_CHAIN_ID)
        await opening

        expect(runningSyncs).toHaveLength(0)
        expect(controller.chains['1']?.lastSyncedAt).toBeNull()
        expect(getAmounts(controller)).toEqual([2n])
        expect(controller.history[SESSION]?.filters).toEqual({ chainId: OTHER })
      })

      it('shows an empty page for a network without Privacy Pools', async () => {
        const { controller } = await prepareSelected({ hasOtherChain: true })

        await controller.filterHistory(SESSION, { chainId: '137' })

        expect(runningSyncs).toHaveLength(0)
        expect(getPage(controller)?.items).toEqual([])
      })
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

    /** Builds it and lets through the sync that reads the deposit again once it is proved. */
    const buildRagequitAfterSync = async (controller: PrivacyPoolsController, label: bigint) => {
      const building = buildRagequit(controller, label)
      await releaseSync('seed-a')

      return building
    }

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

    it('knows the account of a deposit still being verified before proving it', async () => {
      const { controller, protocol } = await prepareSynced()
      const syncCount = protocol.syncCount

      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 3n })).toBe(DEPOSITOR)
      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 6n })).toBe(OTHER_DEPOSITOR)
      expect(prove).not.toHaveBeenCalled()
      expect(protocol.syncCount).toBe(syncCount)
    })

    it('knows no account for a verified, spent, unknown or other phrase deposit', async () => {
      const { controller } = await prepareSynced()

      // Verified
      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 1n })).toBeUndefined()
      // Spent in full
      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 4n })).toBeUndefined()
      // Of seed-b
      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 2n })).toBeUndefined()
      expect(controller.getRagequitDepositorAddr({ chainId: '1', label: 99n })).toBeUndefined()
      expect(controller.getRagequitDepositorAddr({ chainId: '10', label: 3n })).toBeUndefined()
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

      await expect(buildRagequitAfterSync(controller, 3n)).resolves.toEqual({
        accountAddr: DEPOSITOR,
        calls: [{ to: ETHEREUM_ETH_POOL, value: 0n, data: encodeRagequit(30n, 3n) }]
      })
      await expect(buildRagequitAfterSync(controller, 6n)).resolves.toEqual({
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

    it('waits for the running sync before proving, as the SDK syncs the same plugin', async () => {
      const { controller, protocol } = await prepareSynced()
      const syncing = controller.syncChain('1')
      // Taken back elsewhere, which only the running sync learns
      notesBySeed['seed-a'] = notesBySeed['seed-a']!.filter(({ label }) => label !== 6n)

      const building3 = buildRagequit(controller, 3n)
      const building6 = buildRagequit(controller, 6n)
      await waitUntil(() => runningSyncs.length > 0)
      await flush()
      expect(protocol.ragequitLabels).toEqual([])

      // Refused once the sync it waited for is done, so caught before that
      const refusing6 = expect(building6).rejects.toThrow(
        'This deposit can no longer be taken back. It may have been verified or taken back already.'
      )
      await releaseSync('seed-a')
      await syncing
      await refusing6
      // The read once it is proved
      await releaseSync('seed-a')
      await expect(building3).resolves.toMatchObject({ accountAddr: DEPOSITOR })
      expect(protocol.ragequitLabels).toEqual([[3n]])
    })

    it('reads the account once the reclaim lands, so the deposit leaves the pending balance', async () => {
      const { controller } = await prepareSynced()
      const { calls } = await buildRagequitAfterSync(controller, 3n)
      controller.onAccountOpBroadcast({ chainId: 1n, calls })

      notesBySeed['seed-a'] = notesBySeed['seed-a']!.map((note) =>
        note.label === 3n ? { ...note, amount: 0n } : note
      )
      await finalizeAndRead(controller, calls, 'seed-a')

      await expect(controller.getRagequitDeposits('1', ZERO_ADDRESS)).resolves.toEqual([
        { label: 6n, amount: 60n, depositorAddr: OTHER_DEPOSITOR }
      ])
    })

    it('shows the reclaimed deposit as leaving the pending balance, and leaves the approved one alone, until it lands', async () => {
      const { controller } = await prepareSynced()
      const { calls } = await buildRagequitAfterSync(controller, 3n)
      expect(getBalance(controller)).toMatchObject({
        totalAmount: 100n,
        approvedAmount: 10n,
        pendingAmount: 90n
      })

      controller.onAccountOpBroadcast({ chainId: 1n, calls })

      expect(getBalance(controller)).toMatchObject({
        totalAmount: 100n,
        simulationAmount: -30n,
        approvedAmountPostSimulation: 10n
      })

      notesBySeed['seed-a'] = notesBySeed['seed-a']!.map((note) =>
        note.label === 3n ? { ...note, amount: 0n } : note
      )
      await finalizeAndRead(controller, calls, 'seed-a')

      expect(getBalance(controller)).toMatchObject({ totalAmount: 70n, simulationAmount: 0n })
    })

    it('stops showing a reclaim whose transaction failed', async () => {
      const { controller } = await prepareSynced()
      const { calls } = await buildRagequitAfterSync(controller, 3n)
      controller.onAccountOpBroadcast({ chainId: 1n, calls })
      expect(getBalance(controller)).toMatchObject({ simulationAmount: -30n })

      await finalize(controller, calls, AccountOpStatus.Failure)

      expect(getBalance(controller)).toMatchObject({ totalAmount: 100n, simulationAmount: 0n })
    })

    it('does not read the account when the reclaim failed', async () => {
      const { controller } = await prepareSynced()
      const { calls } = await buildRagequitAfterSync(controller, 3n)
      controller.onAccountOpBroadcast({ chainId: 1n, calls })

      await finalize(controller, calls, AccountOpStatus.Failure)

      expect(runningSyncs).toHaveLength(0)
    })

    it('hands nothing over once the wallet was locked while waiting for a sync', async () => {
      const { controller, keystore, protocol } = await prepareSynced()
      const syncing = controller.syncChain('1')

      const building = buildRagequit(controller, 3n)
      await waitUntil(() => runningSyncs.length > 0)
      keystore.isUnlocked = false
      keystore.fireUpdate()
      await releaseSync('seed-a')
      await syncing

      await expect(building).rejects.toThrow('Please unlock your wallet to use Privacy Pools.')
      expect(protocol.ragequitLabels).toEqual([])
    })

    it('refuses a deposit verified while it was proved, as it can now be sent privately', async () => {
      const { controller, protocol } = await prepareSynced()
      // Seen by the SDK's sync before proving, not by the controller's last one
      notesBySeed['seed-a'] = notesBySeed['seed-a']!.map((note) =>
        note.label === 3n ? { ...note, approved: true } : note
      )

      await expect(buildRagequitAfterSync(controller, 3n)).rejects.toThrow(
        'This deposit was just verified, so it can now be sent privately. Use Send to move it.'
      )
      expect(protocol.ragequitLabels).toEqual([[3n]])
      // The read refreshed what the account shows as well
      await expect(controller.getRagequitDeposits('1', ZERO_ADDRESS)).resolves.toEqual([
        expect.objectContaining({ label: 6n })
      ])
    })

    it('reads the deposit again with a sync of its own, not one that read the notes while proving', async () => {
      const { controller, protocol } = await prepareSynced()
      // A screen shows the history, so a sync reads it after the notes
      await controller.filterHistory('dashboard')
      ragequitGate = createDeferred()
      const building = buildRagequit(controller, 3n)
      await waitUntil(() => protocol.ragequitLabels.length === 1)

      // Started while proving, and reading the history when the proof is done
      historyGate = createDeferred()
      const syncing = controller.syncChain('1')
      await releaseSync('seed-a')
      await waitUntil(() => protocol.historyCount === 2)
      ragequitGate.resolve()
      await flush()
      historyGate.resolve()
      await syncing

      // The read once it is proved
      await releaseSync('seed-a')
      await expect(building).resolves.toMatchObject({ accountAddr: DEPOSITOR })
      expect(protocol.syncCount).toBe(3)
    })

    it('refuses a deposit taken back elsewhere once it was proved', async () => {
      const { controller } = await prepareSynced()
      // Proved from what the SDK's sync read, then taken back before the deposit is read again
      ragequitTxns = [{ to: ETHEREUM_ETH_POOL, value: 0n, data: encodeRagequit(30n, 3n) }]
      notesBySeed['seed-a'] = notesBySeed['seed-a']!.map((note) =>
        note.label === 3n ? { ...note, amount: 0n } : note
      )

      await expect(buildRagequitAfterSync(controller, 3n)).rejects.toThrow(
        'This deposit can no longer be taken back. It may have been verified or taken back already.'
      )
    })

    it('refuses the deposit when it cannot be read again once proved', async () => {
      const { controller } = await prepareSynced()

      const building = buildRagequit(controller, 3n)
      const running = await takeRunningSync('seed-a', 1n)
      running.gate.reject(new Error('the node is down'))

      await expect(building).rejects.toThrow(
        'Could not prepare taking back this deposit. Please try again.'
      )
    })

    it('hands nothing over once the wallet was locked while the deposit was read again', async () => {
      const { controller, keystore } = await prepareSynced()

      const building = buildRagequit(controller, 3n)
      const running = await takeRunningSync('seed-a', 1n)
      keystore.isUnlocked = false
      keystore.fireUpdate()
      running.gate.resolve()

      await expect(building).rejects.toThrow('Please unlock your wallet to use Privacy Pools.')
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

      await buildRagequitAfterSync(controller, 3n)

      expect(prove).toHaveBeenLastCalledWith('commitment', { value: 1n }, { signal: undefined })
    })
  })

  describe("a pool's numbers", () => {
    const USDC_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
    // The ETH pool's first three deposits. It is the first pool, so it has the first scope
    const [LABEL_1, , LABEL_3] = getPrivacyPoolsPoolLabels(FIRST_POOL_SCOPE, 1n, 3n) as [
      bigint,
      bigint,
      bigint
    ]
    /** The ETH pool's first `count` deposits of 100, 30 and 400, and one in the USDC pool. */
    const toEthPoolState = (count: number) =>
      toStoredPoolState({
        deposits: [
          ...[100n, 30n, 400n].slice(0, count).map((value) => ({ pool: ETHEREUM_ETH_POOL, value })),
          { pool: USDC_POOL, value: 7n }
        ],
        withdrawals: [{ pool: ETHEREUM_ETH_POOL, value: 40n }],
        // Verified: the first and third ETH deposits, and one of another pool
        aspLeaves: [LABEL_1, LABEL_3, 99n]
      })

    beforeEach(() => {
      storedPoolState = toEthPoolState(3)
    })

    const syncAs = async (
      { controller, selectedAccount }: Awaited<ReturnType<typeof prepareTest>>,
      seedId: string
    ) => {
      selectedAccount.select(seedId)
      const syncing = controller.syncChain('1')
      await releaseSync(seedId)
      await syncing
    }

    const prepareSynced = async () => {
      const prepared = await prepareTest()
      const call = jest.fn()
      const getBalance = jest.fn()
      Object.assign(prepared.providers.providers['1'], { call, getBalance })
      await syncAs(prepared, 'seed-a')

      return { ...prepared, call, getBalance }
    }

    it('computes them with a sync, from the synced history alone, asking the network nothing', async () => {
      const { controller, providers, call, getBalance } = await prepareSynced()

      expect(controller.poolStats['1']).toEqual({
        byToken: expect.objectContaining({
          [ZERO_ADDRESS]: {
            totalAmount: 490n,
            approvedDepositsCount: 2,
            depositsCount24h: 3,
            withdrawalsCount24h: 1
          },
          // By the token address in lowercase
          [USDC]: {
            totalAmount: 7n,
            approvedDepositsCount: 0,
            depositsCount24h: 1,
            withdrawalsCount24h: 0
          }
        }),
        error: null
      })
      expect(call).not.toHaveBeenCalled()
      expect(getBalance).not.toHaveBeenCalled()
      expect(providers.providers['1'].send).not.toHaveBeenCalled()
    })

    it("counts the deposits made since, whichever account's sync read them", async () => {
      storedPoolState = toEthPoolState(2)
      const prepared = await prepareSynced()
      expect(prepared.controller.poolStats['1']?.byToken[ZERO_ADDRESS]).toMatchObject({
        approvedDepositsCount: 1
      })

      storedPoolState = toEthPoolState(3)
      await syncAs(prepared, 'seed-b')

      expect(prepared.controller.poolStats['1']?.byToken[ZERO_ADDRESS]).toMatchObject({
        approvedDepositsCount: 2
      })
    })

    it('keeps them with no selected account, as they are the same for all', async () => {
      const { controller, selectedAccount } = await prepareSynced()
      selectedAccount.select(null)

      expect(controller.poolStats['1']?.byToken[ZERO_ADDRESS]).toMatchObject({
        totalAmount: 490n
      })
    })

    it('does not read the history already on this device on load, only with the next sync', async () => {
      const { storage } = await prepareSynced()

      const prepared = await prepareTest({ storage })
      await flush()
      expect(prepared.controller.poolStats).toEqual({})

      await syncAs(prepared, 'seed-a')
      expect(prepared.controller.poolStats['1']?.byToken[ZERO_ADDRESS]).toMatchObject({
        totalAmount: 490n
      })
    })

    it('has none before the first sync, which is not an error', async () => {
      const { controller } = await prepareTest()
      await flush()

      expect(controller.poolStats).toEqual({})
      expect(controller.emittedErrors).toEqual([])
    })

    it('says so when the stored history is not what it reads, without a toast', async () => {
      storedPoolState = 'not a stored state'
      const { controller } = await prepareSynced()

      expect(controller.poolStats['1']).toEqual({
        byToken: {},
        error: 'Could not load the numbers of this pool.'
      })
      expect(controller.emittedErrors.at(-1)?.level).toBe('silent')
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

  describe('privacy checks', () => {
    const USDC_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
    const ETH_TRANSFER = {
      chainId: '1',
      tokenAddress: ZERO_ADDRESS,
      depositNumber: 1,
      amount: 10n,
      recipient: WITHDRAWAL_RECIPIENT
    }
    const USDC_TRANSFER = { ...ETH_TRANSFER, tokenAddress: USDC, amount: 7n }

    const getLeakIds = (controller: PrivacyPoolsController) =>
      controller.withdrawalPrivacy?.privacy?.leaks.map(({ id }) => id)

    beforeEach(() => {
      storedPoolState = toStoredPoolState({
        deposits: [
          { pool: ETHEREUM_ETH_POOL, value: 10n, blockNumber: 999n },
          // seed-a's own
          { pool: ETHEREUM_ETH_POOL, value: 10n, blockNumber: 1000n },
          { pool: ETHEREUM_ETH_POOL, value: 10n, blockNumber: 1001n },
          // Too small to hide seed-a's note
          { pool: ETHEREUM_ETH_POOL, value: 9n, blockNumber: 1002n },
          { pool: ETHEREUM_ETH_POOL, value: 50n, blockNumber: 1003n },
          { pool: USDC_POOL, value: 7n, blockNumber: 1000n }
        ],
        isEveryDepositApproved: true,
        // A day after the deposits, so none of them is fresh
        lastSyncedBlock: 1000n + getPrivacyPoolsChainConfig(1n)!.blocksPerDay
      })
      notesBySeed['seed-a'] = [
        { label: 1n, amount: 10n, approved: true, blockNumber: 1000n },
        { label: 2n, amount: 7n, approved: true, assetAddress: BigInt(USDC), blockNumber: 1000n }
      ]
    })

    /** seed-a, synced. */
    const prepareSynced = async () => {
      const prepared = await prepareTest()
      prepared.selectedAccount.select('seed-a')
      const syncing = prepared.controller.syncChain('1')
      await releaseSync('seed-a')
      await syncing

      return prepared
    }

    it('drops the answer on lock', async () => {
      const { controller, keystore } = await prepareSynced()
      controller.checkWithdrawalPrivacy(ETH_TRANSFER)
      expect(controller.withdrawalPrivacy).not.toBeNull()

      keystore.isUnlocked = false
      keystore.fireUpdate()

      expect(controller.withdrawalPrivacy).toBeNull()
    })

    it("does not count the user's own deposits sent in full as others' that hide a send", async () => {
      storedPoolState = toStoredPoolState({
        deposits: [
          { pool: ETHEREUM_ETH_POOL, value: 10n, blockNumber: 998n },
          { pool: ETHEREUM_ETH_POOL, value: 37n, blockNumber: 999n },
          { pool: ETHEREUM_ETH_POOL, value: 37n, blockNumber: 1000n }
        ],
        isEveryDepositApproved: true,
        lastSyncedBlock: 1000n + getPrivacyPoolsChainConfig(1n)!.blocksPerDay
      })
      // Both 37s are seed-a's, and the first one was already sent in full
      notesBySeed['seed-a'] = [
        {
          label: 3n,
          amount: 0n,
          value: 37n,
          withdraw: 1,
          approved: true,
          blockNumber: 999n,
          deposit: 0
        },
        { label: 4n, amount: 37n, approved: true, blockNumber: 1000n, deposit: 1 }
      ]
      const { controller } = await prepareSynced()

      controller.checkWithdrawalPrivacy({ ...ETH_TRANSFER, depositNumber: 2, amount: 37n })

      expect(getLeakIds(controller)).toEqual(['unique-amount'])
      expect(controller.withdrawalPrivacy?.privacy).toMatchObject({
        rating: 'traceable',
        cover: { bigEnough: 0, sameAmount: 0 }
      })
    })

    it('rates a send unchecked when the pool could not be read', async () => {
      const { restore } = suppressConsole()
      storedPoolState = 'not a stored state'
      const { controller } = await prepareSynced()

      controller.checkWithdrawalPrivacy(USDC_TRANSFER)

      expect(controller.poolStats['1']?.error).not.toBeNull()
      expect(controller.withdrawalPrivacy?.privacy).toMatchObject({
        rating: 'unchecked',
        leaks: []
      })
      restore()
    })

    it('rates the deposit as the SDK has it after proving, not as the last sync did', async () => {
      notesBySeed['seed-a'] = [
        { label: 1n, amount: 2n * WITHDRAWAL_AMOUNT, approved: true, blockNumber: 1000n }
      ]
      const { controller } = await prepareSynced()
      // Seen only by the sync the SDK runs before proving: the deposit was made by the recipient
      notesBySeed['seed-a'] = [
        {
          label: 1n,
          amount: 2n * WITHDRAWAL_AMOUNT,
          approved: true,
          blockNumber: 1000n,
          depositor: WITHDRAWAL_RECIPIENT
        }
      ]
      preparedWithdrawal = buildPreparedWithdrawal()

      await controller.prepareWithdrawal({ ...ETH_TRANSFER, amount: WITHDRAWAL_AMOUNT })

      expect(controller.operation?.phase).toBe('ready')
      expect(controller.operation?.privacy?.rating).toBe('weak')
      expect(controller.operation?.privacy?.leaks.map(({ id }) => id)).toContain(
        'send-to-depositor'
      )
    })

    it('reads the pool for a deposit form when no sync has read it, without syncing', async () => {
      const storage = new StorageController(produceMemoryStore())
      await storage.set('privacyPoolsState', {
        [getPrivacyPoolsStoreKey(getPrivacyPoolsChainConfig(1n)!)]: storedPoolState!
      })
      const { controller } = await prepareTest({ storage })
      const deposit = { chainId: '1', tokenAddress: ZERO_ADDRESS, amount: 10n, maxAmount: 100n }
      expect(controller.getDepositPrivacy(deposit).rating).toBe('unchecked')

      await controller.loadDepositAssetConfig('1', ZERO_ADDRESS, 'transfer-session')
      await waitUntil(() => !!controller.poolStats['1'])

      expect(controller.getDepositPrivacy(deposit)).toMatchObject({
        rating: 'standard',
        sameAmount: 3
      })
      expect(controller.getDepositPrivacy({ ...deposit, amount: 11n })).toMatchObject({
        rating: 'standard',
        sameAmount: 0
      })
      expect(runningSyncs).toHaveLength(0)
    })
  })
})
