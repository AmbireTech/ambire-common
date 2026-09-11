import { ZeroAddress } from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getEstimation } from '../../libs/estimate/estimate'
import { FeePaymentOption, FullEstimation } from '../../libs/estimate/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { ESTIMATION_FAILURES, EstimationController } from './estimation'
import { EstimationFailureKind, EstimationStatus } from './types'

jest.mock('../../libs/estimate/estimate', () => ({
  ...(jest.requireActual('../../libs/estimate/estimate') as object),
  getEstimation: jest.fn()
}))

const getEstimationMock = getEstimation as jest.MockedFunction<typeof getEstimation>

const ACCOUNT_ADDR = '0x1111111111111111111111111111111111111111'
const CHAIN_ID = 1n

const ACCOUNT_BALANCE = 10n ** 18n

const account: Account = {
  addr: ACCOUNT_ADDR,
  associatedKeys: [ACCOUNT_ADDR],
  initialPrivileges: [],
  creation: null,
  preferences: { label: 'Account', pfp: ACCOUNT_ADDR }
}

/**
 * Ethereum with the relayer, the bundler and 7702 turned off, so the account
 * stays a plain EOA and `estimate` has only the provider path to take.
 */
const network: Network = {
  ...predefinedNetworks.find((net) => net.chainId === CHAIN_ID)!,
  has7702: false,
  hasRelayer: false,
  erc4337: { enabled: false, hasPaymaster: false, hasBundlerSupport: false }
}

const accountState: AccountOnchainState = {
  accountAddr: ACCOUNT_ADDR,
  isDeployed: true,
  eoaNonce: 0n,
  nonce: 0n,
  erc4337Nonce: 0n,
  associatedKeys: [ACCOUNT_ADDR],
  importedAccountKeys: [],
  balance: ACCOUNT_BALANCE,
  isEOA: true,
  isErc4337Enabled: false,
  isErc4337Nonce: false,
  isV2: false,
  currentBlock: 21000000n,
  isSmarterEoa: false,
  delegatedContract: null,
  delegatedContractName: null,
  threshold: 1,
  updatedAt: Date.now()
}

const accountOp: AccountOp = {
  id: 'account-op-1',
  accountAddr: ACCOUNT_ADDR,
  chainId: CHAIN_ID,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: 0n,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

const nativeToken: TokenResult = {
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  address: ZeroAddress,
  chainId: CHAIN_ID,
  amount: ACCOUNT_BALANCE,
  priceIn: [],
  marketDataIn: [],
  flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: true, isFeeToken: true }
}

const nativeFeeOption: FeePaymentOption = {
  availableAmount: ACCOUNT_BALANCE,
  paidBy: ACCOUNT_ADDR,
  gasUsed: 21000n,
  addedNative: 0n,
  token: nativeToken
}

const successfulEstimation: FullEstimation = {
  provider: { gasUsed: 21000n, feePaymentOptions: [nativeFeeOption] },
  ambire: new Error('not a smart account'),
  bundler: null,
  flags: {}
}

/**
 * Builds a controller whose dependencies all behave, so each test can break
 * exactly one of them and nothing else.
 */
const getController = (overrides?: {
  accounts?: Partial<IAccountsController>
  networks?: Partial<INetworksController>
  portfolio?: Partial<IPortfolioController>
}) =>
  new EstimationController(
    { keys: [] } as unknown as IKeystoreController,
    {
      accounts: [account],
      accountStates: { [ACCOUNT_ADDR]: { [CHAIN_ID.toString()]: accountState } },
      getOrFetchAccountOnChainState: async () => accountState,
      updateAccountState: async () => undefined,
      ...overrides?.accounts
    } as unknown as IAccountsController,
    {
      networks: [network],
      ...overrides?.networks
    } as unknown as INetworksController,
    {} as RPCProvider,
    {
      // No fee tokens, so `estimate` always takes the portfolio top-up branch
      getAccountPortfolioState: () => ({}),
      updateSelectedAccount: async () => undefined,
      ...overrides?.portfolio
    } as unknown as IPortfolioController,
    { cleanUp: () => {} } as unknown as BundlerSwitcher,
    { broadcastedButNotConfirmed: {} } as unknown as IActivityController,
    { isFeatureEnabled: () => false } as unknown as IFeatureFlagsController
  )

/** A controller that has one successful estimation behind it. */
const getEstimatedController = async () => {
  const controller = getController()

  await controller.estimate(accountOp)
  expect(controller.status).toBe(EstimationStatus.Success)

  return controller
}

describe('EstimationController', () => {
  beforeEach(() => {
    getEstimationMock.mockReset()
    getEstimationMock.mockResolvedValue(successfulEstimation)
  })

  describe('isInitialized always resolves', () => {
    test('flips to true on a successful estimation', async () => {
      const controller = getController()

      expect(controller.isInitialized()).toBe(false)

      await controller.estimate(accountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Success)
      expect(controller.error).toBeNull()
      expect(controller.availableFeeOptions).toHaveLength(1)
    })

    test('flips to true when the estimation itself throws', async () => {
      const { restore } = suppressConsole()
      getEstimationMock.mockRejectedValue(new Error('all RPCs are down'))
      const controller = getController()

      await controller.estimate(accountOp)

      restore()
      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.unexpected.message)
      expect(controller.estimation).toBeNull()
      expect(controller.availableFeeOptions).toHaveLength(0)
    })

    test('flips to true when the account is no longer in the wallet', async () => {
      const controller = getController({ accounts: { accounts: [] } })

      await controller.estimate(accountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.missingAccount.message)
      // The estimation must not have been attempted with a missing account
      expect(getEstimationMock).not.toHaveBeenCalled()
    })

    test('flips to true when the network has been turned off', async () => {
      const controller = getController({ networks: { networks: [] } })

      await controller.estimate(accountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.missingNetwork.message)
      expect(getEstimationMock).not.toHaveBeenCalled()
    })

    test('flips to true when the account state is missing', async () => {
      const controller = getController({
        accounts: { getOrFetchAccountOnChainState: async () => undefined }
      })

      await controller.estimate(accountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.missingAccountState.message)
      expect(getEstimationMock).not.toHaveBeenCalled()
    })

    test('flips to true when reading the account state throws', async () => {
      const { restore } = suppressConsole()
      const controller = getController({
        accounts: {
          getOrFetchAccountOnChainState: async () => {
            throw new Error('initial load failed')
          }
        }
      })

      await controller.estimate(accountOp)

      restore()
      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.unexpected.message)
    })

    test('flips to true when picking the fee options throws on an otherwise successful estimation', async () => {
      const { restore } = suppressConsole()
      // An EOA with no native fee option makes getAvailableFeeOptions throw,
      // which happens after the estimation itself has already succeeded
      getEstimationMock.mockResolvedValue({
        ...successfulEstimation,
        provider: { gasUsed: 21000n, feePaymentOptions: [] }
      })
      const controller = getController()

      await controller.estimate(accountOp)

      restore()
      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.unexpected.message)
      expect(controller.availableFeeOptions).toHaveLength(0)
      // The half computed result must not be left behind as something to fall
      // back on - there never was a working estimation here
      expect(controller.estimation).toBeNull()
    })
  })

  describe('failures are classified by what asking again could do', () => {
    test('a missing account cannot be fixed by asking again', async () => {
      const controller = getController({ accounts: { accounts: [] } })

      await controller.estimate(accountOp)

      expect(controller.failureKind).toBe(EstimationFailureKind.Permanent)
      expect(controller.hasPermanentFailure()).toBe(true)
      expect(controller.isRetryingFailure()).toBe(false)
    })

    test('a network that is turned off cannot be fixed by asking again', async () => {
      const controller = getController({ networks: { networks: [] } })

      await controller.estimate(accountOp)

      expect(controller.hasPermanentFailure()).toBe(true)
      expect(controller.isRetryingFailure()).toBe(false)
    })

    test('an account state that could not be loaded is worth asking again', async () => {
      const controller = getController({
        accounts: { getOrFetchAccountOnChainState: async () => undefined }
      })

      await controller.estimate(accountOp)

      expect(controller.failureKind).toBe(EstimationFailureKind.Retriable)
      expect(controller.isRetryingFailure()).toBe(true)
      expect(controller.hasPermanentFailure()).toBe(false)
    })

    test('an unexpected failure is worth asking again', async () => {
      const { restore } = suppressConsole()
      const controller = getController({
        accounts: {
          getOrFetchAccountOnChainState: async () => {
            throw new Error('Cannot read properties of undefined')
          }
        }
      })

      await controller.estimate(accountOp)

      restore()
      expect(controller.isRetryingFailure()).toBe(true)
      expect(controller.hasPermanentFailure()).toBe(false)
    })

    test('an answer the user has to act on is neither', async () => {
      getEstimationMock.mockResolvedValue({
        ...successfulEstimation,
        criticalError: new Error('You do not have enough funds to cover the fee.')
      })
      const controller = getController()

      await controller.estimate(accountOp)

      // Asking again is still allowed to happen, it just is not a retry of a
      // failed attempt - the user may top up in the meantime
      expect(controller.failureKind).toBeNull()
      expect(controller.isRetryingFailure()).toBe(false)
      expect(controller.hasPermanentFailure()).toBe(false)
    })

    test('a successful estimation clears the previous classification', async () => {
      const { restore } = suppressConsole()
      let shouldThrow = true
      const controller = getController({
        accounts: {
          getOrFetchAccountOnChainState: async () => {
            if (shouldThrow) throw new Error('transient failure')
            return accountState
          }
        }
      })

      await controller.estimate(accountOp)
      expect(controller.isRetryingFailure()).toBe(true)

      shouldThrow = false
      await controller.estimate(accountOp)

      restore()
      expect(controller.failureKind).toBeNull()
      expect(controller.status).toBe(EstimationStatus.Success)
    })

    test('stays a retry while the next attempt is still running', async () => {
      const { restore } = suppressConsole()
      let shouldThrow = true
      const controller = getController({
        accounts: {
          getOrFetchAccountOnChainState: async () => {
            if (shouldThrow) throw new Error('transient failure')
            return accountState
          }
        }
      })

      await controller.estimate(accountOp)
      expect(controller.isRetryingFailure()).toBe(true)

      shouldThrow = false
      let stateWhileRunning: { status: EstimationStatus; isRetryingFailure: boolean } | null = null
      getEstimationMock.mockImplementationOnce(async () => {
        stateWhileRunning = {
          status: controller.status,
          isRetryingFailure: controller.isRetryingFailure()
        }

        return successfulEstimation
      })

      await controller.estimate(accountOp)

      restore()
      // Otherwise the sign screen would swap its "taking longer than usual"
      // warning for an error screen on every attempt and back again
      expect(stateWhileRunning).toEqual({
        status: EstimationStatus.Loading,
        isRetryingFailure: true
      })
      expect(controller.isRetryingFailure()).toBe(false)
    })
  })

  describe('a failure worth asking again about keeps a usable estimation', () => {
    test('the fee options survive it and the user is warned they may be stale', async () => {
      const { restore } = suppressConsole()
      const controller = await getEstimatedController()
      const estimation = controller.estimation

      getEstimationMock.mockRejectedValue(new Error('the RPC went down'))
      await controller.estimate(accountOp)

      restore()
      // Broadcasting with the previous estimation is better than being unable
      // to broadcast at all
      expect(controller.status).toBe(EstimationStatus.Success)
      expect(controller.estimation).toBe(estimation)
      expect(controller.availableFeeOptions).toHaveLength(1)
      expect(controller.error).toBeNull()
      expect(controller.errors).toHaveLength(0)

      const warning = controller.calculateWarnings(account).find((w) => w.id === 'estimation-retry')
      expect(warning).toBeDefined()
      expect(warning?.text).toContain('outdated')
    })

    test('a permanent failure takes it away', async () => {
      const enabledNetworks = [network]
      const controller = getController({ networks: { networks: enabledNetworks } })

      await controller.estimate(accountOp)
      expect(controller.status).toBe(EstimationStatus.Success)

      // The network is turned off while the request is still open
      enabledNetworks.length = 0
      await controller.estimate(accountOp)

      expect(controller.estimation).toBeNull()
      expect(controller.availableFeeOptions).toHaveLength(0)
      expect(controller.status).toBe(EstimationStatus.Error)
      expect(controller.errors[0]?.title).toBe(ESTIMATION_FAILURES.missingNetwork.message)
    })

    test('there is no warning when there is nothing to fall back on', async () => {
      const { restore } = suppressConsole()
      const controller = getController({
        accounts: { getOrFetchAccountOnChainState: async () => undefined }
      })

      await controller.estimate(accountOp)

      restore()
      expect(controller.calculateWarnings(account)).toHaveLength(0)
    })
  })

  describe('what the user is told', () => {
    test('a failure being retried is not reported as an error', async () => {
      const { restore } = suppressConsole()
      const controller = getController({
        accounts: { getOrFetchAccountOnChainState: async () => undefined }
      })

      await controller.estimate(accountOp)

      restore()
      // The sign screen keeps its fee section and says the estimation is taking
      // longer than usual instead of showing a dead end
      expect(controller.errors).toHaveLength(0)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.missingAccountState.message)
    })

    test('a permanent failure is reported as an error', async () => {
      const controller = getController({ networks: { networks: [] } })

      await controller.estimate(accountOp)

      expect(controller.errors).toHaveLength(1)
      expect(controller.errors[0]?.title).toBe(ESTIMATION_FAILURES.missingNetwork.message)
    })

    test('an answer the user has to act on is reported as an error', async () => {
      getEstimationMock.mockResolvedValue({
        ...successfulEstimation,
        criticalError: new Error('You do not have enough funds to cover the fee.')
      })
      const controller = getController()

      await controller.estimate(accountOp)

      expect(controller.errors[0]?.title).toBe('You do not have enough funds to cover the fee.')
    })

    test('an unexpected failure keeps the technical detail out of the message', async () => {
      const { restore } = suppressConsole()
      const realError = new Error("Cannot read properties of undefined (reading 'has7702')")
      const emittedErrors: string[] = []
      const controller = getController({
        accounts: {
          getOrFetchAccountOnChainState: async () => {
            throw realError
          }
        }
      })
      controller.onError((error) => emittedErrors.push(error.error.message))

      await controller.estimate(accountOp)

      restore()
      // The stack goes to the error tracking service, the user gets plain words
      expect(emittedErrors).toContain(realError.message)
      expect(controller.error?.message).toBe(ESTIMATION_FAILURES.unexpected.message)
    })

    test('nothing is reported before the first attempt has finished', () => {
      const controller = getController()

      expect(controller.isInitialized()).toBe(false)
      expect(controller.errors).toHaveLength(0)
    })
  })

  describe('concurrent estimations', () => {
    test('a superseded estimation leaves the loading state to the newer one', async () => {
      const { restore } = suppressConsole()
      const controller = getController()
      const newerAccountOp = { ...accountOp, id: 'account-op-2' }

      // The superseded estimation resolves last, so it would otherwise be the
      // one deciding the final state
      let resolveSuperseded: (value: FullEstimation) => void = () => {}
      getEstimationMock.mockImplementationOnce(
        () =>
          new Promise<FullEstimation>((resolve) => {
            resolveSuperseded = resolve
          })
      )

      const supersededEstimate = controller.estimate(accountOp)
      await controller.estimate(newerAccountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Success)

      resolveSuperseded(successfulEstimation)
      await supersededEstimate

      restore()
      // The superseded run must not have downgraded the newer result
      expect(controller.isInitialized()).toBe(true)
      // @ts-expect-error - we want to check the internal state
      expect(controller.lastAccountOpId).toBe(newerAccountOp.id)
    })

    test('the newer estimation resolves the loading state even when it fails', async () => {
      const { restore } = suppressConsole()
      const controller = getController()
      const newerAccountOp = { ...accountOp, id: 'account-op-2' }

      let resolveSuperseded: (value: FullEstimation) => void = () => {}
      getEstimationMock.mockImplementationOnce(
        () =>
          new Promise<FullEstimation>((resolve) => {
            resolveSuperseded = resolve
          })
      )
      getEstimationMock.mockRejectedValueOnce(new Error('all RPCs are down'))

      const supersededEstimate = controller.estimate(accountOp)
      await controller.estimate(newerAccountOp)

      expect(controller.isInitialized()).toBe(true)
      expect(controller.status).toBe(EstimationStatus.Error)

      resolveSuperseded(successfulEstimation)
      await supersededEstimate

      restore()
      expect(controller.isInitialized()).toBe(true)
    })
  })
})
