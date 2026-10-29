/* eslint no-console: "off" */

import {
  getAddress,
  hexlify,
  Interface,
  JsonRpcProvider,
  keccak256,
  makeError,
  MaxUint256,
  Network as EthersNetwork,
  parseEther,
  toBeHex,
  verifyMessage,
  Wallet
} from 'ethers'
import fetch from 'node-fetch'

import { afterAll, afterEach, describe, expect, jest, test } from '@jest/globals'
import { recoverTypedSignature, SignTypedDataVersion } from '@metamask/eth-sig-util'

import { relayerUrl, trezorSlot7v24337Deployed, velcroUrl } from '../../../test/config'
import { produceMemoryStore, waitForAccountsCtrlFirstLoad } from '../../../test/helpers'
import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { makeSelectorsApi, waitUntil } from '../../../test/helpers/contractInfo'
import {
  blacklistedDapp,
  customDapp,
  failedDapp,
  getDappRequestData,
  getDappVerificationTestDapps,
  loadingDapp,
  makeDapp,
  suspiciousHostingDapp,
  verifiedDapp
} from '../../../test/helpers/dapps'
import { mockUiManager } from '../../../test/helpers/ui'
import { mockBundlerRequestsBeforeEach } from '../../../test/mocks/bundler'
import { noErc7730DescriptorsRelayer } from '../../../test/mocks/erc7730Relayer'
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import { Session } from '../../classes/session'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { FeatureFlags } from '../../consts/featureFlags'
import { ESTIMATE_UPDATE_INTERVAL, GAS_PRICE_UPDATE_INTERVAL } from '../../consts/intervals'
import { networks } from '../../consts/networks'
import {
  EARLIER_PENDING_TRANSACTION_ERROR_CODE,
  WARNINGS
} from '../../consts/signAccountOp/errorHandling'
import { Account } from '../../interfaces/account'
import { Dapp, DAPP_VERIFICATION_BANNER_IDS, IDappsController } from '../../interfaces/dapp'
import { DecodedCall } from '../../interfaces/decodeCall'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { ExternalSignerController, ExternalSignerControllers } from '../../interfaces/keystore'
import { Platform } from '../../interfaces/platform'
import { IProvidersController } from '../../interfaces/provider'
import { TraceCallDiscoveryStatus } from '../../interfaces/signAccountOp'
import { Storage } from '../../interfaces/storage'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp, accountOpSignableHash } from '../../libs/accountOp/accountOp'
import { getReplacementAccountOp } from '../../libs/accountOp/replacement'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import * as broadcastLib from '../../libs/broadcast/broadcast'
import { CALLDATA_SELECTOR_HEX_LENGTH } from '../../libs/decodeCall'
import { InnerCallFailureError } from '../../libs/errorDecoder/customErrors'
import * as estimationLib from '../../libs/estimate/estimate'
import { FullEstimationSummary } from '../../libs/estimate/interfaces'
import { getMinReplacementFees } from '../../libs/gasPrice/speedUp'
import {
  ERC7730_CALLDATA_INDEX_RELAYER_PATH,
  ERC7730_DESCRIPTOR_WAIT_MS
} from '../../libs/humanizer/erc7730/consts'
import { HumanizerWarning } from '../../libs/humanizer/interfaces'
import { hasErc7730Humanization, UNLIMITED_APPROVAL_WARNING_CODE } from '../../libs/humanizer/utils'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { AbstractPaymaster } from '../../libs/paymaster/abstractPaymaster'
import { TokenResult } from '../../libs/portfolio'
import { AccountState } from '../../libs/portfolio/interfaces'
import { PORTFOLIO_STATE } from '../../libs/portfolio/testData'
import { BindedRelayerCall, relayerCall, RelayerError } from '../../libs/relayerCall/relayerCall'
import * as safeLib from '../../libs/safe/safe'
import {
  adaptTypedMessageForMetaMaskSigUtil,
  getTypedData
} from '../../libs/signMessage/signMessage'
import { PERMIT2_ADDRESS_LOWERCASED } from '../../libs/simulation/detectPermit2Interaction'
import * as accessListCallLib from '../../libs/tracer/accessListCall'
import * as debugTraceCallLib from '../../libs/tracer/debugTraceCall'
import * as ethSimulateV1Lib from '../../libs/tracer/ethSimulatev1'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import { paymasterFactory } from '../../services/paymaster'
import { getRpcProvider } from '../../services/provider'
import { getSubmittedAccountOpNonces } from '../../utils/nonce'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
import {
  ContractInfoController,
  FUNCTION_SELECTORS_STORAGE_KEY,
  SELECTOR_LOADING_DEADLINE_MS
} from '../contractInfo/contractInfo'
import { DappsController } from '../dapps/dapps'
import { Erc7730Controller } from '../erc7730/erc7730'
import { EstimationController } from '../estimation/estimation'
import { EstimationFailureKind, EstimationStatus } from '../estimation/types'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { GasPriceController } from '../gasPrice/gasPrice'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SafeController } from '../safe/safe'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { SurveyController } from '../survey/survey'
import { UiController } from '../ui/ui'
import { clearDiscoverTxnTokensCache } from './discoverTxnTokens'
import { getFeeSpeedIdentifier, SignAccountOpType } from './helper'
import { FeeSpeed, MAX_REESTIMATES, SignAccountOpController, SigningStatus } from './signAccountOp'
import { SignAccountOpPreferenceController } from './signAccountOpPreference'
import { SignAccountOpTesterController } from './signAccountOpTester'
import { TxnReplacement } from './txnReplacement'

paymasterFactory.init(relayerUrl, fetch, () => {})

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const createEOAAccountOp = (account: Account) => {
  const to = '0x0000000000000000000000000000000000000000'

  const data = '0x'

  const nativeToCheck: Account[] = [
    {
      addr: account.addr,
      associatedKeys: [account.addr],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: account.addr
      }
    }
  ]
  const feeTokens = [
    {
      address: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      symbol: 'ETH',
      name: 'Ether',
      chainId: 1n,
      decimals: 18,
      priceIn: [],
      marketDataIn: [],
      flags: {
        onGasTank: false,
        rewardsType: null,
        canTopUpGasTank: true,
        isFeeToken: true
      }
    }
  ]

  const op = {
    id: generateUuid(),
    accountAddr: account.addr,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    chainId: 1n,
    nonce: null, // does not matter when estimating
    calls: [{ to, value: BigInt(1), data }],
    signature: null,
    meta: {}
  }

  return { op, nativeToCheck, feeTokens }
}

const createAccountOp = (
  account: Account,
  chainId: bigint = 1n
): {
  op: AccountOp
  nativeToCheck: Account[]
  feeTokens: TokenResult[]
} => {
  const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

  const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
  // 64 chars expire hex
  // we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
  const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

  // USDT -> USDC swap
  // Fee tokens: USDT, USDC
  const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

  const nativeToCheck: Account[] = [
    {
      addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
      associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
      }
    }
  ]
  const feeTokens = [
    {
      address: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      symbol: 'ETH',
      name: 'Ether',
      chainId: 1n,
      decimals: 18,
      priceIn: [],
      marketDataIn: [],
      flags: {
        onGasTank: false,
        rewardsType: null,
        canTopUpGasTank: true,
        isFeeToken: true
      }
    }
  ]

  const op: AccountOp = {
    id: generateUuid(),
    accountAddr: account.addr,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    chainId,
    nonce: 0n, // does not matter when estimating
    calls: [{ to, value: BigInt(0), data }],
    signature: null
  }

  return { op, nativeToCheck, feeTokens }
}

const usdcFeeToken: TokenResult = {
  amount: 54409383n,
  chainId: 137n,
  decimals: Number(6),
  marketDataIn: [],
  priceIn: [{ baseCurrency: 'usd', price: 1.0 }],
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const trezorEoa: Account = {
  addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
  associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
  initialPrivileges: [],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae'
  }
}

const otherEoa: Account = {
  addr: '0x71c3D24a627f0416db45107353d8d0A5ae0402ae',
  associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
  initialPrivileges: [],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x71c3D24a627f0416db45107353d8d0A5ae0402ae'
  }
}

const nativeFeeTokenPolygon: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'POL',
  name: 'Polygon Ecosystem Token',
  amount: 1000n,
  chainId: 137n,
  decimals: Number(18),
  marketDataIn: [],
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const eoaSigner = {
  privKey: '0x1941fd49fae923cae5ba789ac8ed2662066861960c7aa339443e76d309a80f6f',
  keyPublicAddress: '0x16c81367c30c71d6B712355255A07FCe8fd3b5bB',
  pass: 'testpass'
}

const v1Account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E', eoaSigner.keyPublicAddress],
  initialPrivileges: [],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
  }
}

// add the eoaSigner as an associatedKey
trezorSlot7v24337Deployed.associatedKeys.push(eoaSigner.keyPublicAddress)

const eoaAccount: Account = {
  addr: eoaSigner.keyPublicAddress,
  associatedKeys: [eoaSigner.keyPublicAddress],
  initialPrivileges: [],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: eoaSigner.keyPublicAddress
  }
}

const smartAccount: Account = {
  addr: '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6',
  associatedKeys: ['0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F', eoaSigner.keyPublicAddress],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027fa70e7c3e588683d0493e3cad10209993d632b6631bc4637b53a4174bad869718553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [
    [
      '0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F',
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]
  ],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6'
  }
}

/**
 * Not a real Safe, so its address must have no contract on any network: reading a Safe's owners
 * from another contract (like the Ambire account deployed at `smartAccount.addr` on some
 * networks) reverts and fails the account state fetch. Without a contract it reads as an
 * undeployed Safe everywhere.
 */
const safeAccountAddr = '0x5aFE000000000000000000000000000000000001'
const safeAccount: Account = {
  ...smartAccount,
  addr: safeAccountAddr,
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: safeAccountAddr
  },
  safeCreation: {
    factoryAddr: safeAccountAddr,
    singleton: safeAccountAddr,
    saltNonce: '0x00',
    setupData: '0x'
  }
}

const nativeFeeToken: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ether',
  amount: 1000n,
  chainId: 1n,
  decimals: Number(18),
  marketDataIn: [],
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const buildPortfolioState = ({
  amountBeforeSimulation,
  amountPostSimulation,
  isLoading
}: {
  amountBeforeSimulation: bigint
  amountPostSimulation: bigint
  isLoading: boolean
}): AccountState => {
  const networkState = PORTFOLIO_STATE['1']
  const token = networkState?.result?.tokens[0]

  if (!networkState?.result || !token) throw new Error('Invalid portfolio test fixture')

  return {
    '1': {
      ...networkState,
      isLoading,
      result: {
        ...networkState.result,
        total: { usd: Number(amountBeforeSimulation) },
        tokens: [
          {
            ...token,
            amount: amountBeforeSimulation,
            amountPostSimulation,
            decimals: 0,
            priceIn: [{ baseCurrency: 'usd', price: 1 }]
          }
        ]
      }
    }
  }
}

const gasTankToken: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'ETH',
  amount: 323871237812612123123n,
  chainId: 1n,
  decimals: Number(18),
  marketDataIn: [],
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: true,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const { uiManager } = mockUiManager()
const uiCtrl = new UiController({ uiManager })

// None of the tests here assert on real bundler results
mockBundlerRequestsBeforeEach()

// Every controller built by init keeps estimating and fetching gas prices on intervals.
// Left running, they pile up through the file and a test that fast-forwards fake timers
// runs all of them at once
const controllersToDestroy: SignAccountOpTesterController[] = []
afterEach(() => {
  controllersToDestroy.splice(0).forEach((controller) => controller.destroy())
})

const init = async (
  account: Account,
  accountOp: {
    op: AccountOp
    nativeToCheck: Account[]
    feeTokens: TokenResult[]
  },
  signer: any,
  estimationOrMock: FullEstimationSummary,
  gasPricesOrMock: GasSpeeds,
  updateWholePortfolio?: boolean,
  options?: {
    dapps?: Dapp[]
    sessions?: Session[]
    callRelayer?: BindedRelayerCall
    type?: SignAccountOpType
    initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
    onUpdateAfterTraceCallSuccess?: () => Promise<void>
    externalSignerControllers?: ExternalSignerControllers
    onBroadcastSuccess?: (params: any) => Promise<void>
    onPartialBroadcast?: (sentAccountOp: any) => Promise<void>
    featureFlags?: Partial<FeatureFlags>
    contractInfoFetch?: Fetch
    // Lets several controllers share one, like the requests of a real wallet do
    contractInfo?: ContractInfoController
    platform?: Platform
    /**
     * Pause the controller the moment it is built, before its estimate and gas price intervals
     * get to run. For tests that drive those intervals themselves.
     */
    pauseOnInit?: boolean
    /** Builds the TxnReplacement passed to the controller, for tests of speeding up a transaction */
    createReplacement?: (activity: ActivityController) => TxnReplacement
  }
) => {
  // Its own, as the listeners of the controllers built here would pile up on a shared one
  const ui = new UiController({ uiManager })
  const storage: Storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  await storageCtrl.set('accounts', [account])
  await storageCtrl.set('selectedAccount', account.addr)
  if (options?.initialSetStorage) await options.initialSetStorage(storageCtrl)
  const signAccountOpPreference = new SignAccountOpPreferenceController({ storage: storageCtrl })
  await signAccountOpPreference.initialLoadPromise
  if (options?.dapps) {
    await storageCtrl.set('dappsV2', options.dapps)
    await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
  }
  const keystore = new KeystoreController('default', storageCtrl, { internal: KeystoreSigner }, ui)
  await keystore.addSecret('passphrase', signer.pass, '', false)
  await keystore.unlockWithSecret('passphrase', signer.pass)

  await keystore.addKeys([
    {
      addr: signer.keyPublicAddress,
      type: 'internal',
      label: 'Key 1',
      privateKey: signer.privKey,
      dedicatedToOneSA: true,
      meta: {
        createdAt: new Date().getTime()
      }
    }
  ])

  let providersCtrl: IProvidersController
  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    useTempProvider: (props, cb) => {
      return providersCtrl.useTempProvider(props, cb)
    },
    onAddOrUpdateNetworks: () => {},
    onReady: async () => {
      await providersCtrl.init({ networks: networksCtrl.allNetworks })
    }
  })
  providersCtrl = new ProvidersController({
    storage: storageCtrl,
    getNetworks: () => networksCtrl.allNetworks,
    sendUiMessage: () => ui.message.sendUiMessage
  })
  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystore,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )
  const autoLoginCtrl = new AutoLoginController(
    storageCtrl,
    keystore,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    {},
    new InviteController({ relayerUrl, fetch, storage: storageCtrl })
  )
  const surveyCtrl = new SurveyController({
    fetch,
    relayerUrl,
    storage: storageCtrl,
    ui,
    dismissBanner: () => {}
  })
  const bannerCtrl = new BannerController(
    storageCtrl,
    () => ({ status: 'no-selected-account' }),
    surveyCtrl,
    'test'
  )
  const selectedAccountCtrl = new SelectedAccountController({
    storage: storageCtrl,
    accounts: accountsCtrl,
    autoLogin: autoLoginCtrl,
    banner: bannerCtrl,
    ui: ui
  })
  const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)
  await accountsCtrl.initialLoadPromise
  await waitForAccountsCtrlFirstLoad(accountsCtrl)
  await networksCtrl.initialLoadPromise
  await providersCtrl.initialLoadPromise

  // Only the tests that pass a selectors API fetch selectors, so the rest never wait on the real one
  const featureFlagsCtrl = new FeatureFlagsController(
    { apiForFunctionSelectors: !!options?.contractInfoFetch, ...options?.featureFlags },
    storageCtrl
  )
  const portfolio = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    keystore,
    'https://staging-relayer.ambire.com',
    velcroUrl,
    bannerCtrl,
    featureFlagsCtrl,
    ui
  )
  const continuouslyUpdatePhishingSpy = options?.dapps
    ? jest
        .spyOn(PhishingController.prototype, 'continuouslyUpdatePhishing')
        .mockImplementation(async () => {
          await wait(1)
        })
    : undefined
  const phishing = new PhishingController({
    fetch,
    storage: storageCtrl,
    addressBook: addressBookCtrl,
    ui,
    featureFlags: featureFlagsCtrl
  })
  if (options?.dapps) {
    await phishing.init()
    await phishing.updatePhishingInterval.promise
    phishing.updatePhishingInterval.stop()
    continuouslyUpdatePhishingSpy?.mockRestore()
  }
  const { op } = accountOp
  const network = networksCtrl.networks.find((x) => x.chainId === op.chainId)!
  await portfolio.updateSelectedAccount(account.addr, updateWholePortfolio ? undefined : [network])
  const provider = getRpcProvider(network.rpcUrls, network.chainId)

  if (portfolio.getAccountPortfolioState(account.addr)[op.chainId.toString()]!.result) {
    portfolio!.getAccountPortfolioState(account.addr)[op.chainId.toString()]!.result!.tokens = [
      {
        amount: 1n,
        chainId: op.chainId,
        decimals: Number(18),
        symbol: 'ETH',
        name: 'Ether',
        address: '0x0000000000000000000000000000000000000000',
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        },
        marketDataIn: [],
        priceIn: [{ baseCurrency: 'usd', price: 1000.0 }] //  For the sake of simplicity we mocked 1 ETH = 1000 USD
      },
      {
        amount: 54409383n,
        chainId: op.chainId,
        decimals: Number(6),
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        },
        marketDataIn: [],
        priceIn: [{ baseCurrency: 'usd', price: 1.0 }]
      }
    ]
  }

  const bundlerSwitcher = new BundlerSwitcher(network, () => {
    return false
  })
  const baseAccount = getBaseAccount(
    account,
    accountsCtrl.accountStates[account.addr]![network.chainId.toString()]!,
    network,
    featureFlagsCtrl.isFeatureEnabled('erc4337'),
    featureFlagsCtrl.isFeatureEnabled('eip7702')
  )

  const unreachableRelayer = relayerCall.bind({ url: '', fetch })
  // An empty ERC-7730 registry gives the same default view as a failed lookup, without the
  // failure. Every other relayer call stays unreachable.
  const emptyErc7730Relayer: BindedRelayerCall = async (path, ...args) =>
    path === ERC7730_CALLDATA_INDEX_RELAYER_PATH
      ? { success: true, data: {}, errorState: [] }
      : unreachableRelayer(path, ...args)
  const callRelayer = options?.callRelayer || emptyErc7730Relayer
  const safe = new SafeController({
    networks: networksCtrl,
    providers: providersCtrl,
    storage: storageCtrl,
    accounts: accountsCtrl,
    keystore
  })
  const activity = new ActivityController(
    storageCtrl,
    fetch,
    callRelayer,
    accountsCtrl,
    selectedAccountCtrl,
    providersCtrl,
    networksCtrl,
    portfolio,
    safe,
    featureFlagsCtrl,
    () => Promise.resolve()
  )
  const estimationController = new EstimationController(
    keystore,
    accountsCtrl,
    networksCtrl,
    provider,
    portfolio,
    bundlerSwitcher,
    activity,
    featureFlagsCtrl
  )
  estimationController.estimation = estimationOrMock
  estimationController.hasEstimated = true
  estimationController.status = EstimationStatus.Success
  estimationController.availableFeeOptions = estimationOrMock.ambireEstimation
    ? estimationOrMock.ambireEstimation.feePaymentOptions
    : estimationOrMock.providerEstimation!.feePaymentOptions
  const gasPriceController = new GasPriceController(
    network,
    provider,
    baseAccount,
    () => ({
      estimation: estimationController,
      readyToSign: true,
      stopRefetching: false
    }),
    featureFlagsCtrl
  )
  gasPriceController.gasPrices = gasPricesOrMock
  const dappsControllerMock = {
    onUpdate: () => () => {},
    getDappVerificationBanner: () => null
  }
  let dapps: IDappsController = dappsControllerMock as any
  if (options?.dapps) {
    const fetchAndUpdateSpy = jest
      .spyOn(DappsController.prototype, 'fetchAndUpdateDapps')
      .mockImplementation(async () => {
        await wait(1)
      })
    const realDappsController = new DappsController({
      appVersion: '1.0.0',
      fetch,
      storage: storageCtrl,
      networks: networksCtrl,
      phishing,
      ui,
      selectedAccount: selectedAccountCtrl,
      featureFlags: featureFlagsCtrl
    })
    await realDappsController.init()

    // Register any dApp sessions so the real #getFrameContextStatus can read the top frame
    // reported for them (the iframe-in-suspicious-tab scenario).
    options.sessions?.forEach((session) => {
      realDappsController.dappSessions[session.sessionId] = session
    })

    fetchAndUpdateSpy.mockRestore()
    dapps = realDappsController
  }
  // A real controller over the test's storage, not a stub - the ERC-7730 tests assert on
  // descriptor caching, which is exactly what this controller owns.
  const erc7730 = new Erc7730Controller({
    storage: storageCtrl,
    // The default relayer isn't bound, so every descriptor lookup would fail and log an error
    callRelayer: options?.callRelayer || noErc7730DescriptorsRelayer,
    featureFlags: featureFlagsCtrl,
    ui: ui
  })
  const contractInfo =
    options?.contractInfo ||
    new ContractInfoController({
      fetch: options?.contractInfoFetch || fetch,
      storage: storageCtrl,
      featureFlags: featureFlagsCtrl,
      ui: ui
    })
  await contractInfo.initialLoadPromise
  const controller = new SignAccountOpTesterController({
    type: options?.type,
    callRelayer: options?.callRelayer as BindedRelayerCall,
    erc7730,
    contractInfo,
    accounts: accountsCtrl,
    networks: networksCtrl,
    keystore,
    portfolio,
    featureFlags: featureFlagsCtrl,
    platform: options?.platform ?? 'browser-webkit',
    signAccountOpPreference,
    externalSignerControllers: options?.externalSignerControllers || {},
    account,
    network,
    activity,
    dapps,
    provider,
    phishing,
    fromRequestId: 1,
    accountOp: op,
    shouldSimulate: false,
    onUpdateAfterTraceCallSuccess: options?.onUpdateAfterTraceCallSuccess,
    onBroadcastSuccess: options?.onBroadcastSuccess || (async () => {}),
    onPartialBroadcast: options?.onPartialBroadcast,
    replacement: options?.createReplacement?.(activity),
    estimateController: estimationController,
    gasPriceController
  })
  controllersToDestroy.push(controller)
  controller.update({
    hasNewEstimation: true,
    gasPrices: gasPricesOrMock
  })

  // Must happen before the first await, otherwise the intervals scheduled by the constructor
  // have already started their immediate run.
  if (options?.pauseOnInit) controller.pause()

  return { controller, storageCtrl, signAccountOpPreference, accountsCtrl, portfolio, contractInfo }
}

const initDappVerificationBannerTest = async (
  dapp: Dapp,
  {
    isPermit2 = false,
    calls,
    callRelayer,
    dappSessionId,
    sessions,
    contractInfoFetch,
    contractInfo,
    initialSetStorage,
    type
  }: {
    isPermit2?: boolean
    calls?: AccountOp['calls']
    callRelayer?: BindedRelayerCall
    dappSessionId?: string
    sessions?: Session[]
    contractInfoFetch?: Fetch
    contractInfo?: ContractInfoController
    initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
    type?: SignAccountOpType
  } = {}
) => {
  const accountOp = createEOAAccountOp(eoaAccount)
  ;(accountOp.op.calls as any) = calls || [
    {
      to: isPermit2 ? PERMIT2_ADDRESS_LOWERCASED : '0x0000000000000000000000000000000000000000',
      value: BigInt(1),
      data: '0x',
      dapp: getDappRequestData(dapp)
    }
  ]
  if (dappSessionId) {
    ;(accountOp.op as any).dappSessionId = dappSessionId
  }

  const feePaymentOptions = [
    {
      paidBy: eoaAccount.addr,
      availableAmount: 1000000000000000000n,
      gasUsed: 0n,
      addedNative: 5000n,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        amount: parseEther('1'),
        symbol: 'ETH',
        name: 'Ether',
        chainId: 1n,
        decimals: 18,
        priceIn: [],
        marketDataIn: [],
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        }
      }
    }
  ]

  return init(
    eoaAccount,
    accountOp,
    eoaSigner,
    {
      providerEstimation: {
        gasUsed: 10000n,
        feePaymentOptions
      },
      ambireEstimation: {
        deploymentGas: 0n,
        gasUsed: 10000n,
        feePaymentOptions,
        ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
        flags: {}
      },
      flags: {},
      updatedAt: Date.now()
    },
    {
      slow: {
        maxFeePerGas: toBeHex(200n) as Hex,
        maxPriorityFeePerGas: toBeHex(100n) as Hex
      },
      medium: {
        maxFeePerGas: toBeHex(400n) as Hex,
        maxPriorityFeePerGas: toBeHex(200n) as Hex
      },
      fast: {
        maxFeePerGas: toBeHex(600n) as Hex,
        maxPriorityFeePerGas: toBeHex(300n) as Hex
      },
      ape: {
        maxFeePerGas: toBeHex(800n) as Hex,
        maxPriorityFeePerGas: toBeHex(400n) as Hex
      }
    },
    false,
    {
      dapps: getDappVerificationTestDapps(),
      callRelayer,
      sessions,
      contractInfoFetch,
      contractInfo,
      initialSetStorage,
      type
    }
  )
}

describe('SignAccountOp Controller ', () => {
  const defaultFeeSelectionGasPrices = {
    slow: {
      maxFeePerGas: toBeHex(200n) as Hex,
      maxPriorityFeePerGas: toBeHex(100n) as Hex
    },
    medium: {
      maxFeePerGas: toBeHex(400n) as Hex,
      maxPriorityFeePerGas: toBeHex(200n) as Hex
    },
    fast: {
      maxFeePerGas: toBeHex(600n) as Hex,
      maxPriorityFeePerGas: toBeHex(300n) as Hex
    },
    ape: {
      maxFeePerGas: toBeHex(800n) as Hex,
      maxPriorityFeePerGas: toBeHex(400n) as Hex
    }
  }

  const getDefaultFeeSelectionOptions = (nativeAvailableAmount = 1000000000000000000n) => [
    {
      paidBy: smartAccount.addr,
      availableAmount: nativeAvailableAmount,
      gasUsed: 25000n,
      addedNative: 0n,
      token: nativeFeeToken
    },
    {
      paidBy: smartAccount.addr,
      availableAmount: 1000000000000000000n,
      gasUsed: 25000n,
      addedNative: 0n,
      token: gasTankToken
    },
    {
      paidBy: smartAccount.addr,
      availableAmount: 1000000000000000000n,
      gasUsed: 25000n,
      addedNative: 0n,
      token: {
        ...usdcFeeToken,
        chainId: 1n
      }
    }
  ]

  const initDefaultFeeSelection = async (
    feePaymentOptions = getDefaultFeeSelectionOptions(),
    options?: Parameters<typeof init>[6]
  ) => {
    const { controller, storageCtrl, accountsCtrl, portfolio } = await init(
      smartAccount,
      createAccountOp(smartAccount, 1n),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 25000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 25000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      defaultFeeSelectionGasPrices,
      false,
      options
    )

    await wait(1)

    return { controller, storageCtrl, accountsCtrl, portfolio }
  }

  const initSafeNonce = async (
    signed: string[] = [],
    {
      isSpeedUp = false,
      isCancel = false,
      signature,
      txnId,
      estimatedAccountNonce = 3
    }: {
      isSpeedUp?: boolean
      isCancel?: boolean
      signature?: string
      txnId?: string
      estimatedAccountNonce?: number
    } = {}
  ) => {
    const feePaymentOptions = getDefaultFeeSelectionOptions().map((option) => ({
      ...option,
      paidBy: safeAccount.addr
    }))
    const accountOp = createAccountOp(safeAccount, 1n)
    accountOp.op.nonce = 3n
    accountOp.op.signed = signed
    if (isSpeedUp) {
      accountOp.op.meta = {
        ...accountOp.op.meta,
        speedUp: { enabled: true, ...(isCancel && { isCancel }) }
      }
    }
    if (signature) accountOp.op.signature = signature
    if (txnId) accountOp.op.txnId = txnId

    return init(
      safeAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 25000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 25000n,
          feePaymentOptions,
          ambireAccountNonce: estimatedAccountNonce,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      defaultFeeSelectionGasPrices,
      false,
      {
        createReplacement: isSpeedUp
          ? (activity) => new TxnReplacement({ accountOp: accountOp.op, activity })
          : undefined
      }
    )
  }

  describe('refetchAccountState', () => {
    test('refreshes the account state and clears the loading state', async () => {
      const { controller, accountsCtrl, portfolio } = await initDefaultFeeSelection()
      // A refresh simulates the transaction again, which the network rejects for this account
      jest.spyOn(portfolio, 'simulateAccountOp').mockResolvedValue(undefined)
      const updateAccountStateSpy = jest
        .spyOn(accountsCtrl, 'updateAccountState')
        .mockResolvedValue(undefined)

      await expect(controller.refetchAccountState()).resolves.toBeUndefined()

      expect(updateAccountStateSpy).toHaveBeenCalledWith(
        controller.accountOp.accountAddr,
        'pending',
        [controller.accountOp.chainId],
        true
      )
      expect(controller.isRefetchingAccountState).toBe(false)
    })

    test('ignores concurrent refresh attempts', async () => {
      const { controller, accountsCtrl, portfolio } = await initDefaultFeeSelection()
      jest.spyOn(portfolio, 'simulateAccountOp').mockResolvedValue(undefined)
      const pendingRefresh = createDeferred<void>()
      const updateAccountStateSpy = jest
        .spyOn(accountsCtrl, 'updateAccountState')
        .mockImplementation(async () => {
          await pendingRefresh.promise
        })

      const firstRefresh = controller.refetchAccountState()
      await controller.refetchAccountState()

      expect(updateAccountStateSpy).toHaveBeenCalledTimes(1)
      expect(controller.isRefetchingAccountState).toBe(true)

      pendingRefresh.resolve()
      await firstRefresh

      expect(controller.isRefetchingAccountState).toBe(false)
    })

    test('emits fetch errors without rejecting and allows retrying', async () => {
      const { restore } = suppressConsole()
      const { controller, accountsCtrl } = await initDefaultFeeSelection()
      const fetchError = new Error('RPC timeout')
      const updateAccountStateSpy = jest
        .spyOn(accountsCtrl, 'updateAccountState')
        .mockRejectedValueOnce(fetchError)
        .mockResolvedValueOnce(undefined)
      const onError = jest.fn()
      controller.onError(onError)

      await expect(controller.refetchAccountState()).resolves.toBeUndefined()

      expect(onError).toHaveBeenCalledWith({
        level: 'silent',
        message: 'Unable to refresh your account information. Please try again.',
        error: fetchError
      })
      expect(controller.isRefetchingAccountState).toBe(false)

      await expect(controller.refetchAccountState()).resolves.toBeUndefined()

      expect(updateAccountStateSpy).toHaveBeenCalledTimes(2)
      expect(controller.isRefetchingAccountState).toBe(false)
      restore()
    })
  })

  test('sets a custom Safe nonce and refreshes its EIP-712 data', async () => {
    const { restore } = suppressConsole()
    const { controller, accountsCtrl } = await initSafeNonce()
    const initialSafeEip712Data = controller.safeEip712Data
    const accountState =
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!

    controller.setSafeNonce(accountState.nonce + 1n)
    expect(controller.canBroadcast).toBe(false)

    controller.setSafeNonce(accountState.nonce)
    expect(controller.canBroadcast).toBe(true)

    controller.setSafeNonce(42n)

    expect(controller.accountOp.nonce).toBe(42n)
    expect(controller.safeEip712Data).not.toEqual(initialSafeEip712Data)

    controller.update({ hasNewEstimation: true })
    expect(controller.accountOp.nonce).toBe(42n)
    restore()
  })

  test('does not allow broadcasting an imported Safe transaction with a future nonce', async () => {
    const { restore } = suppressConsole()
    const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress])
    const accountState =
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!

    controller.update({ accountOpData: { nonce: null } })
    expect(controller.canBroadcast).toBe(true)

    controller.update({ accountOpData: { nonce: accountState.nonce } })
    expect(controller.canBroadcast).toBe(true)

    controller.update({ accountOpData: { nonce: accountState.nonce + 1n } })

    expect(controller.errors).toContainEqual({
      title:
        'Earlier transactions need to go through first. Send them, or wait for the ones already sent to be confirmed.',
      action: 'refetch-account-state'
    })
    expect(controller.canBroadcast).toBe(false)
    restore()
  })

  test('explains that a signed Safe transaction with an already used nonce can no longer go through', async () => {
    const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress])
    const accountState =
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!

    accountState.nonce = 5n

    controller.update({ accountOpData: { nonce: 4n } })

    expect(controller.errors).toContainEqual({
      title:
        'Another transaction from this account was already confirmed in its place, so this one can no longer go through. You can reject it.'
    })
    expect(controller.canBroadcast).toBe(false)
  })

  test('checks the nonce of a signed Safe transaction even when it is 0', async () => {
    const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress])
    const accountState =
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!
    accountState.nonce = 1n

    controller.update({ accountOpData: { nonce: 0n } })

    expect(controller.canBroadcast).toBe(false)
  })

  test('does not block a Safe speed up for keeping the nonce of the transaction it replaces', async () => {
    const { restore } = suppressConsole()
    const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress], {
      isSpeedUp: true
    })
    const accountState =
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!

    controller.update({ accountOpData: { nonce: accountState.nonce + 1n } })

    expect(controller.errors).not.toContainEqual(
      expect.objectContaining({
        title:
          'Earlier transactions need to go through first. Send them, or wait for the ones already sent to be confirmed.'
      })
    )
    restore()
  })

  describe('Safe nonce right after a confirmation', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('allows a signed Safe transaction whose nonce the chain does not count yet', async () => {
      const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress])
      const accountState =
        accountsCtrl.accountStates[controller.accountOp.accountAddr]![
          controller.accountOp.chainId.toString()
        ]!
      // Activity knows that a transaction with the chain nonce was just confirmed
      const getNextNonce = jest
        .spyOn(ActivityController.prototype, 'getNextNonce')
        .mockReturnValue(accountState.nonce + 1n)
      const futureNonceError = expect.objectContaining({
        title:
          'Earlier transactions need to go through first. Send them, or wait for the ones already sent to be confirmed.'
      })

      controller.update({ accountOpData: { nonce: accountState.nonce + 1n } })

      expect(controller.errors).not.toContainEqual(futureNonceError)
      expect(controller.canBroadcast).toBe(true)
      expect(getNextNonce).toHaveBeenCalledWith(
        controller.accountOp.accountAddr,
        controller.accountOp.chainId,
        'account',
        accountState.nonce
      )

      controller.update({ accountOpData: { nonce: accountState.nonce + 2n } })

      expect(controller.errors).toContainEqual(futureNonceError)
      expect(controller.canBroadcast).toBe(false)
    })
  })

  describe('Safe cancel signatures from the Safe API', () => {
    const safeTxnHash = `0x${'5a'.repeat(32)}`
    const ownerA = new Wallet(`0x${'a1'.repeat(32)}`)
    const ownerB = new Wallet(`0x${'b2'.repeat(32)}`)
    const sign = (owner: Wallet) => owner.signingKey.sign(safeTxnHash).serialized
    const joinSigs = (...sigs: string[]) => `0x${sigs.map((sig) => sig.slice(2)).join('')}`
    const ownersOf = (controller: SignAccountOpController) =>
      (controller.accountOp.signed ?? []).map((addr) => addr.toLowerCase()).sort()

    // A new cancel whose Safe transaction hash is known, as after its first signature
    const initNewSafeCancel = () =>
      initSafeNonce([], { isSpeedUp: true, isCancel: true, txnId: safeTxnHash })

    test('takes the signature of an owner who has not signed yet', async () => {
      const { controller } = await initNewSafeCancel()

      controller.update({ accountOpData: { signature: sign(ownerA) } })

      expect(ownersOf(controller)).toEqual([ownerA.address.toLowerCase()])
    })

    test('adds an owner even when the Safe API returns as many signatures as collected', async () => {
      const { controller } = await initNewSafeCancel()
      controller.update({ accountOpData: { signature: sign(ownerA) } })

      // The Safe API never got owner A's signature, only owner B's: same length, other owner
      controller.update({ accountOpData: { signature: sign(ownerB) } })

      expect(ownersOf(controller)).toEqual(
        [ownerA.address, ownerB.address].map((addr) => addr.toLowerCase()).sort()
      )
      expect(controller.accountOp.signature!.length).toBe(2 + 130 * 2)
    })

    test('never counts an owner twice', async () => {
      const { controller } = await initNewSafeCancel()
      controller.update({ accountOpData: { signature: sign(ownerA) } })

      controller.update({ accountOpData: { signature: joinSigs(sign(ownerA), sign(ownerB)) } })
      controller.update({ accountOpData: { signature: joinSigs(sign(ownerB), sign(ownerA)) } })

      expect(ownersOf(controller)).toHaveLength(2)
      expect(controller.accountOp.signature!.length).toBe(2 + 130 * 2)
    })

    test('keeps the collected signatures when the Safe API has none of them', async () => {
      const { controller } = await initNewSafeCancel()
      controller.update({ accountOpData: { signature: joinSigs(sign(ownerA), sign(ownerB)) } })
      const collectedSignature = controller.accountOp.signature

      controller.update({ accountOpData: { signature: sign(ownerB) } })

      expect(controller.accountOp.signature).toBe(collectedSignature)
    })
  })

  describe('Safe speed up', () => {
    // Two owners' ECDSA signatures, as the executed Safe transaction carried them
    const ownersSignature = `0x${'11'.repeat(64)}1b${'22'.repeat(64)}1c`
    // The txnId of an executed transaction is its onchain hash, not the Safe transaction hash
    const executedTxnHash = `0x${'ab'.repeat(32)}`
    const setAccountStateNonce = (
      accountsCtrl: AccountsController,
      controller: SignAccountOpController,
      nonce: bigint
    ) => {
      accountsCtrl.accountStates[controller.accountOp.accountAddr]![
        controller.accountOp.chainId.toString()
      ]!.nonce = nonce
    }

    test('is ready to broadcast with the signatures of the transaction it replaces', async () => {
      const { controller } = await initSafeNonce([], {
        isSpeedUp: true,
        signature: ownersSignature,
        txnId: executedTxnHash
      })

      expect(controller.canBroadcast).toBe(true)
      expect(controller.status?.type).not.toBe(SigningStatus.Queued)
    })

    test('does not read owners from signatures checked against the onchain hash', async () => {
      const owners = [eoaSigner.keyPublicAddress]
      const { controller } = await initSafeNonce(owners, {
        isSpeedUp: true,
        signature: ownersSignature,
        txnId: executedTxnHash
      })

      expect(controller.accountOp.signed).toEqual(owners)
    })

    test('can broadcast even when the account state has moved past its nonce', async () => {
      const { controller, accountsCtrl } = await initSafeNonce([], {
        isSpeedUp: true,
        signature: ownersSignature,
        txnId: executedTxnHash
      })

      setAccountStateNonce(accountsCtrl, controller, 4n)

      expect(controller.canBroadcast).toBe(true)
    })

    test('a signed Safe transaction that is not a speed up still waits for its nonce', async () => {
      const { controller, accountsCtrl } = await initSafeNonce([eoaSigner.keyPublicAddress])

      setAccountStateNonce(accountsCtrl, controller, 4n)

      expect(controller.canBroadcast).toBe(false)
    })

    test('speeding up a pending Safe cancel reuses its signatures, ready to broadcast', async () => {
      const { controller, accountsCtrl } = await initSafeNonce([], {
        isSpeedUp: true,
        isCancel: true,
        signature: ownersSignature,
        txnId: executedTxnHash
      })

      setAccountStateNonce(accountsCtrl, controller, 4n)

      expect(controller.canBroadcast).toBe(true)
      expect(controller.status?.type).not.toBe(SigningStatus.Queued)
    })

    test('a Safe cancel is a new Safe transaction, so it is not ready without signatures', async () => {
      const { controller, accountsCtrl } = await initSafeNonce([], {
        isSpeedUp: true,
        isCancel: true
      })

      setAccountStateNonce(accountsCtrl, controller, 4n)

      expect(controller.canBroadcast).toBe(false)
    })
  })

  test('does not change the nonce of a non-Safe or already-signed transaction', async () => {
    const { restore } = suppressConsole()
    const { controller: nonSafeController } = await initDefaultFeeSelection()
    const { controller: signedSafeController } = await initSafeNonce([eoaSigner.keyPublicAddress])

    nonSafeController.setSafeNonce(42n)
    signedSafeController.setSafeNonce(42n)

    expect(nonSafeController.accountOp.nonce).toBe(0n)
    expect(signedSafeController.accountOp.nonce).toBe(3n)
    restore()
  })

  test('rejects Safe nonces outside the uint256 range', async () => {
    const { restore } = suppressConsole()
    const { controller } = await initSafeNonce()

    controller.setSafeNonce(-1n)
    expect(controller.accountOp.nonce).toBe(3n)

    controller.setSafeNonce(1n << 256n)
    expect(controller.accountOp.nonce).toBe(3n)
    restore()
  })

  test('lets the estimation update the Safe nonce unless the user picked one', async () => {
    const { controller } = await initSafeNonce([], { estimatedAccountNonce: 7 })

    controller.update({ hasNewEstimation: true })
    expect(controller.accountOp.nonce).toBe(7n)

    controller.setSafeNonce(42n)
    controller.update({ hasNewEstimation: true })
    expect(controller.accountOp.nonce).toBe(42n)
  })

  test('does not change a Safe nonce while signing is in progress', async () => {
    const { restore } = suppressConsole()
    const { controller } = await initSafeNonce()
    controller.updateStatus(SigningStatus.InProgress)

    controller.setSafeNonce(42n)

    expect(controller.accountOp.nonce).toBe(3n)
    restore()
  })

  test('defaults fee payment to the network-native token before gas tank or ERC-20', async () => {
    const { controller } = await initDefaultFeeSelection()

    expect(controller.selectedOption?.token.address).toBe(nativeFeeToken.address)
    expect(controller.selectedOption?.token.flags.onGasTank).toBe(false)
  })

  test('uses gas tank as a saved default across chains', async () => {
    const { controller } = await initDefaultFeeSelection(undefined, {
      initialSetStorage: async (storageCtrl) => {
        await storageCtrl.set('signAccountOpFeeTokenPreference', {
          '1': 'gasTank'
        })
      }
    })

    expect(controller.selectedOption?.token.flags.onGasTank).toBe(true)
  })

  test('uses the saved fee speed as the default for a new signing request', async () => {
    const { controller } = await initDefaultFeeSelection(undefined, {
      initialSetStorage: async (storageCtrl) => {
        await storageCtrl.set('signAccountOpFeeSpeedPreference', { '1': FeeSpeed.Ape })
      }
    })

    expect(controller.selectedFeeSpeed).toBe(FeeSpeed.Ape)
  })

  test('ignores a saved fee speed belonging to another chain', async () => {
    const { controller } = await initDefaultFeeSelection(undefined, {
      initialSetStorage: async (storageCtrl) => {
        await storageCtrl.set('signAccountOpFeeSpeedPreference', { '137': FeeSpeed.Slow })
      }
    })

    // falls back to the default speed
    expect(controller.selectedFeeSpeed).toBe(FeeSpeed.Medium)
  })

  test('persists a user selected fee speed right away, for the current chain only', async () => {
    const { controller, storageCtrl } = await initDefaultFeeSelection()

    controller.update({ speed: FeeSpeed.Slow, shouldPersistSpeed: true })
    await wait(1)

    expect(controller.selectedFeeSpeed).toBe(FeeSpeed.Slow)
    expect(await storageCtrl.get('signAccountOpFeeSpeedPreference')).toEqual({
      '1': FeeSpeed.Slow
    })
  })

  test('does not persist a fee speed that was not selected by the user', async () => {
    const { controller, storageCtrl } = await initDefaultFeeSelection()

    controller.update({ speed: FeeSpeed.Slow })
    await wait(1)

    expect(controller.selectedFeeSpeed).toBe(FeeSpeed.Slow)
    expect(await storageCtrl.get('signAccountOpFeeSpeedPreference')).toBeUndefined()
  })

  test('saving a fee speed keeps the ones saved for the other chains', async () => {
    const { controller, storageCtrl } = await initDefaultFeeSelection(undefined, {
      initialSetStorage: async (storage) => {
        await storage.set('signAccountOpFeeSpeedPreference', { '137': FeeSpeed.Ape })
      }
    })

    controller.update({ speed: FeeSpeed.Medium, shouldPersistSpeed: true })
    await wait(1)

    expect(await storageCtrl.get('signAccountOpFeeSpeedPreference')).toEqual({
      '1': FeeSpeed.Medium,
      '137': FeeSpeed.Ape
    })
  })

  test('uses a saved ERC-20 default only for the matching chain', async () => {
    const { controller, storageCtrl } = await initDefaultFeeSelection(undefined, {
      initialSetStorage: async (storage) => {
        await storage.set('signAccountOpFeeTokenPreference', {
          '1': usdcFeeToken.address,
          '137': nativeFeeTokenPolygon.address
        })
      }
    })

    expect(controller.selectedOption?.token.address).toBe(usdcFeeToken.address)
    expect(controller.selectedOption?.token.symbol).toBe(usdcFeeToken.symbol)

    controller.update({ pendingFeeTokenPreference: gasTankToken })

    const storedPreference = await storageCtrl.get('signAccountOpFeeTokenPreference')
    expect(storedPreference).toEqual({
      '1': usdcFeeToken.address,
      '137': nativeFeeTokenPolygon.address
    })
    expect(controller.pendingFeeTokenPreference).toEqual({
      '1': 'gasTank',
      '137': nativeFeeTokenPolygon.address
    })
  })

  test('Estimation race conditions are prevented', async () => {
    const { restore } = suppressConsole()
    const chainId = 137n
    const feePaymentOptions = [
      {
        paidBy: smartAccount.addr,
        availableAmount: 500000000n,
        gasUsed: 25000n,
        addedNative: 0n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'POL',
          name: 'Polygon Ecosystem Token',
          chainId: 137n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      },
      {
        paidBy: smartAccount.addr,
        availableAmount: 500000000n,
        gasUsed: 50000n,
        addedNative: 0n,
        token: {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          amount: 1n,
          symbol: 'usdt',
          name: 'USD Token',
          chainId: 137n,
          decimals: 6,
          marketDataIn: [],
          priceIn: [
            {
              baseCurrency: 'usd',
              price: 1
            }
          ],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      },
      {
        paidBy: smartAccount.addr,
        availableAmount: 500000000n,
        gasUsed: 25000n,
        addedNative: 0n,
        token: {
          address: usdcFeeToken.address,
          amount: 1n,
          symbol: 'usdc',
          name: 'USD Coin',
          marketDataIn: [],
          chainId: 137n,
          decimals: 6,
          priceIn: [
            {
              baseCurrency: 'usd',
              price: 1
            }
          ],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const accountOp = createAccountOp(smartAccount, chainId)
    const { controller } = await init(
      smartAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 50000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 50000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(2000000000n) as Hex,
          maxPriorityFeePerGas: toBeHex(1000000000n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(4000000000n) as Hex,
          maxPriorityFeePerGas: toBeHex(2000000000n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(10000000000n) as Hex,
          maxPriorityFeePerGas: toBeHex(5000000000n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(14000000000n) as Hex,
          maxPriorityFeePerGas: toBeHex(7000000000n) as Hex
        }
      }
    )

    controller.update({
      feeToken: usdcFeeToken,
      paidBy: smartAccount.addr,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      hasNewEstimation: true
    })

    // Wait for the first estimation to finish so we don't slow it instead
    // The first estimation is the one scheduled automatically on controller init
    await new Promise((resolve) => {
      const unsub = controller.estimation.onUpdate(() => {
        if (controller.estimation.status !== EstimationStatus.Loading) {
          resolve(true)
          unsub()
        }
      })
    })

    // Slow down the first estimation artificially
    jest.spyOn(estimationLib, 'getEstimation').mockImplementationOnce(async (...allParams) => {
      await wait(8000)

      // call the original implementation
      return estimationLib.getEstimation(...allParams)
    })

    controller.update({
      accountOpData: {
        calls: [
          {
            to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
            value: 10n,
            data: '0x'
          }
        ]
      }
    })

    // Wait 1 tick so the first estimation starts
    // This is required because we are using RecurringTimeout under
    // the hood for reestimation.
    await wait(0)

    const firstOpId = controller.accountOp.id

    // This estimation should finish after the other one, but as it's for the latest accountOp,
    // it should be applied and the other should be scrapped
    controller.update({
      accountOpData: {
        calls: [
          {
            to: '0x96Aa53ece4214b9e42036452C399719d346D9a1A', // different address
            value: 10n,
            data: '0x'
          }
        ]
      }
    })

    // Wait 1 tick so the second estimation starts
    // This is required because we are using RecurringTimeout under
    // the hood for reestimation.
    await wait(0)

    const latestAccountOpId = controller.accountOp.id

    await Promise.all([
      new Promise((resolve) => {
        const unsub = controller.estimation.onUpdate(() => {
          if (controller.estimation.status !== EstimationStatus.Loading) {
            // @ts-expect-error - we want to check the internal state
            expect(controller.estimation.lastAccountOpId).toBe(latestAccountOpId)
            resolve(true)
            unsub()
          }
        })
      }),
      new Promise((resolve) => {
        const unsub = controller.estimation.onError((error) => {
          expect(error.error.message).toBe(
            `Estimation race condition prevented. Op id: ${firstOpId}. Expected: ${latestAccountOpId}`
          )
          resolve(true)
          unsub()
        })
      })
    ])

    expect.assertions(2)
    restore()
  })
  test('Signing [EOA]: EOA account paying with a native token', async () => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n, // 1 ETH
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: parseEther('1'),
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    controller.update({
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr,
      speed: FeeSpeed.Fast
    })

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    expect(controller.accountOp.gasFeePayment).toEqual({
      paidBy: eoaAccount.addr,
      broadcastOption: broadcastLib.BROADCAST_OPTIONS.bySelf,
      paidByKeyType: 'internal',
      isCustomGasLimit: false,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      feeTokenChainId: 1n,
      amount: 6005000n, // ((baseFee + priorityFee) * gasUsed) + addedNative
      simulatedGasLimit: 10000n,
      maxPriorityFeePerGas: 300n,
      gasPrice: 600n
    })

    expect(controller.accountOp.signature).toEqual('0x') // broadcasting and signRawTransaction is handled in main controller
    expect(controller.status).toEqual({ type: 'done' })
  })

  test('Signing [EOA]: should emit an error if the availableAmount is 0', async () => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 0n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 100000n,
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    let errorCount = 0
    const mockEmitError = jest.fn(() => errorCount++)
    ;(controller as any).emitError = mockEmitError

    controller.update({
      hasNewEstimation: true,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr,
      speed: FeeSpeed.Fast
    })

    await controller.sign()

    expect(errorCount).toBe(1)
  })

  test('Signing [EOA]: should emit an error if the availableAmount is lower than required', async () => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 100000n,
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    let errorCount = 0
    const mockEmitError = jest.fn(() => errorCount++)
    ;(controller as any).emitError = mockEmitError

    controller.update({
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr
    })

    await controller.sign()

    expect(errorCount).toBe(1)
  })
})

describe('Negative cases', () => {
  suppressConsoleBeforeEach()

  test('Signing [SA with EOA payment]: working case + 2 feePaymentOptions and 2 feeSpeeds', async () => {
    const network = networks.find((n) => n.chainId === 137n)!
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n, // 1 POL
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'POL',
          name: 'Polygon Ecosystem Token',
          chainId: 137n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      },
      {
        paidBy: trezorEoa.addr,
        availableAmount: 2000000000000000000n, // 1 POL
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'POL',
          name: 'Polygon Ecosystem Token',
          chainId: 137n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      },
      {
        paidBy: otherEoa.addr,
        availableAmount: 3000000000000000000n, // 1 POL
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'POL',
          name: 'Polygon Ecosystem Token',
          chainId: 137n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const { controller } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.chainId),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    controller.update({
      hasNewEstimation: true,
      feeToken: nativeFeeTokenPolygon,
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    expect(controller.estimation.availableFeeOptions.length).toBe(3)
    const firstIdentity = getFeeSpeedIdentifier(
      controller.estimation.availableFeeOptions[0]!,
      smartAccount.addr
    )
    const secondIdentity = getFeeSpeedIdentifier(
      controller.estimation.availableFeeOptions[1]!,
      smartAccount.addr
    )
    expect(firstIdentity).not.toBe(secondIdentity)
    expect(Object.keys(controller.feeSpeeds).length).toBe(3)
    expect(controller.feeSpeeds[firstIdentity]).not.toBe(undefined)
    expect(controller.feeSpeeds[firstIdentity]!.length).toBe(4)
    expect(controller.feeSpeeds[secondIdentity]).not.toBe(undefined)
    expect(controller.feeSpeeds[secondIdentity]!.length).toBe(4)

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    expect(controller.accountOp.gasFeePayment!.paidBy).toEqual(eoaSigner.keyPublicAddress)
    expect(controller.accountOp.gasFeePayment!.broadcastOption).toEqual(
      broadcastLib.BROADCAST_OPTIONS.byOtherEOA
    )
    expect(controller.accountOp.gasFeePayment!.isGasTank).toEqual(false)
    expect(controller.accountOp.gasFeePayment!.inToken).toEqual(
      '0x0000000000000000000000000000000000000000'
    )
    expect(controller.accountOp.gasFeePayment!.feeTokenChainId).toEqual(137n)
    // the default speed is medium
    expect(controller.accountOp.gasFeePayment!.maxPriorityFeePerGas).toEqual(200n)
    expect(controller.accountOp.gasFeePayment!.gasPrice).toEqual(400n)

    const typedData = getTypedData(
      network.chainId,
      controller.accountOp.accountAddr,
      hexlify(accountOpSignableHash(controller.accountOp, network.chainId))
    )
    const unwrappedSig = controller.accountOp.signature.slice(0, -2)
    const signerAddr = getAddress(
      recoverTypedSignature({
        data: adaptTypedMessageForMetaMaskSigUtil(typedData),
        signature: unwrappedSig,
        version: SignTypedDataVersion.V4
      })
    )

    // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
    expect(eoaSigner.keyPublicAddress).toEqual(signerAddr)

    // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
    expect(controller.accountOp?.signature.slice(-2)).toEqual('01')

    // If signing is successful, we expect controller's status to be done
    expect(controller.status).toEqual({ type: 'done' })
    // The fee payer signs the broadcast right after, so the key stays set until then
    // and the device prompt doesn't close and reopen in between
    expect(controller.activeSigningKeyType).toBe(controller.accountOp.signingKeyType)
    expect(controller.activeSigningKeyType).not.toBeNull()
  })
})

describe('Negative cases', () => {
  suppressConsoleBeforeEach()

  test('Signing [SA with EOA payment]: not enough funds to cover the fee', async () => {
    const network = networks.find((n) => n.chainId === 137n)!
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 100n, // not enough
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'POL',
          name: 'Polygon Ecosystem Token',
          chainId: 137n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]
    const { controller } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.chainId),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    controller.update({
      hasNewEstimation: true,
      feeToken: nativeFeeTokenPolygon,
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    const errors = controller.errors
    expect(errors.length).toBe(1)
    expect(errors[0]!.title.indexOf('Insufficient funds to cover the fee') !== -1).toBe(true)
    expect(controller.status?.type).toBe(SigningStatus.UnableToSign)
    await controller.sign()

    expect(controller.signedAccountOp?.signature).toBeFalsy()
  })

  test('Signing [one-click transfer]: transferred token cannot reserve the fee', async () => {
    // An EOA, as a smart account that isn't switched over to ERC-4337 yet can no longer pay
    // the fee by itself, and one that is would need a bundler estimation
    const network = networks.find((n) => n.chainId === 137n)!
    const token = {
      ...nativeFeeTokenPolygon,
      amount: 100n
    }
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 0n,
        gasUsed: 0n,
        addedNative: 5000n,
        token
      }
    ]
    const accountOp = createAccountOp(eoaAccount, network.chainId)
    accountOp.op.calls = [
      {
        to: FEE_COLLECTOR,
        value: token.amount,
        data: '0x'
      }
    ]
    accountOp.op.meta = {
      allowTransferFeeTokenSelfReserve: true
    }
    accountOp.feeTokens = [token]

    const { controller } = await init(
      eoaAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      },
      undefined,
      {
        type: 'one-click-transfer'
      }
    )

    controller.update({
      hasNewEstimation: true,
      feeToken: token,
      paidBy: eoaAccount.addr,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    expect(controller.errors[0]?.title).toContain('Insufficient funds to cover the fee')
    expect(controller.status?.type).toBe(SigningStatus.UnableToSign)
  })
})

describe('throwBroadcastAccountOp', () => {
  suppressConsoleBeforeEach()

  it('Should prefer message to error', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )
    try {
      await controller.throwBroadcastAccountOp({
        message: 'message',
        error: new Error('error')
      })
    } catch (e: any) {
      expect(e.message).toBe('message')
    }
  })
  it('pimlico_getUserOperationGasPrice', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )
    try {
      await controller.throwBroadcastAccountOp({
        error: new Error(
          "pimlico_getUserOperationGasPrice some information we don't care about 0x2314214"
        )
      })
    } catch (e: any) {
      expect(e.message).toBe('Transaction fees changed. Please try again')
    }
  })
  it('Error that should be humanized by getHumanReadableBroadcastError', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )
    const error = new InnerCallFailureError(
      '   transfer amount exceeds balance   ',
      [],
      networks.find((n) => n.chainId === 8453n)!
    )

    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      expect(e.message).toBe(
        'The transaction cannot be broadcast because the transfer amount exceeds your account balance. Please check your balance or adjust the transfer amount.'
      )
    }
  })
  it('Unknown error that should be humanized by getHumanReadableBroadcastError', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )
    const error = new Error("I'm a teapot")

    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      expect(e.message).toBe(
        "We encountered an unexpected issue: I'm a teapot\nPlease try again or contact Ambire support for assistance."
      )
    }
  })
  it('replacement fee too low', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )
    const error = new Error('replacement fee too low')

    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      expect(e.message).toBe(
        'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.'
      )
    }
  })
  it('Relayer broadcast swap expired', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: {
          maxFeePerGas: toBeHex(200n) as Hex,
          maxPriorityFeePerGas: toBeHex(100n) as Hex
        },
        medium: {
          maxFeePerGas: toBeHex(400n) as Hex,
          maxPriorityFeePerGas: toBeHex(200n) as Hex
        },
        fast: {
          maxFeePerGas: toBeHex(600n) as Hex,
          maxPriorityFeePerGas: toBeHex(300n) as Hex
        },
        ape: {
          maxFeePerGas: toBeHex(800n) as Hex,
          maxPriorityFeePerGas: toBeHex(400n) as Hex
        }
      }
    )

    const error = new RelayerError(
      '"Transaction too old" (action="estimateGas", data="0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135472616e73616374696f6e20746f6f206f6c6400000000000000000000000000", reason="Transaction too old", transaction={ "data": "0x6171d1c9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000032000000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc450000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002445ae401dc00000000000000000000000000000000000000000000000000000000673b3e25000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000c35000000000000000000000000000000000000000000000000001af5cbb4b149c38000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001af5cbb4b149c380000000000000000000000007544127fce3dd39a15b719abb93ca765d91ead6d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e6802303480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000074f0dfef4cd1f200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000767617354616e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006574d4154494300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042b1f9d3975aecfa6e646bef006f2ab88a131775543cb0321360633cef30dcce5b1c78936706c50fdb17469b8d8e546f22d68ab5c7a7d1e73649cd3ca8d9d3a1f81c01000000000000000000000000000000000000000000000000000000000000", "to": "0x7544127fCe3dd39A15b719abB93Ca765D91EAD6d" }, invocation=null, revert={ "args": [ "Transaction too old" ], "name": "Error", "signature": "Error(string)" }, code=CALL_EXCEPTION, version=6.7.1)',
      {},
      {}
    )
    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      expect(e.message).toBe(
        'The transaction cannot be broadcast because the swap has expired. Return to the app and reinitiate the swap if you wish to proceed.'
      )
    }
  })
  it('fee changed (underpriced) auto-update shows a soft confirmation instead of an error toast', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
        medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
        fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
        ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
      }
    )

    expect(controller.gasFeeChangedConfirmationRequired).toBe(false)

    const feeOption = {
      availableAmount: 1000000000000000000n,
      paidBy: eoaAccount.addr,
      gasUsed: 10000n,
      addedNative: 0n,
      token: createEOAAccountOp(eoaAccount).feeTokens[0]!
    }
    const previousFee = {
      type: FeeSpeed.Fast,
      amount: 100000000000000n,
      simulatedGasLimit: 10000n,
      amountFormatted: '0.0001',
      amountUsd: '0.1',
      gasPrice: 600n,
      disabled: false,
      maxPriorityFeePerGas: 300n
    }
    const identifier = getFeeSpeedIdentifier(feeOption, eoaAccount.addr)

    controller.selectedOption = feeOption
    controller.selectedFeeSpeed = FeeSpeed.Fast
    controller.feeSpeeds = { [identifier]: [previousFee] }

    const error = new Error(
      'Transaction fee underpriced. Min expected: 0.03700292154970737. Please select a higher fee and try again'
    )

    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      // The user is asked to re-confirm the updated fee, not redo the whole flow
      expect(e.message).toBe('Transaction fees changed. Please try again')
    }

    expect(controller.gasFeeChangedConfirmationRequired).toBe(true)
    expect(controller.previousFee).toEqual(previousFee)

    // The error is tracked silently (no scary red toast for the user)
    const lastError = controller.emittedErrors[controller.emittedErrors.length - 1]
    expect(lastError?.level).toBe('silent')

    // Dismissing the confirmation (Cancel) clears the flag
    controller.dismissGasFeeChangedConfirmation()
    expect(controller.gasFeeChangedConfirmationRequired).toBe(false)
    expect(controller.previousFee).toBe(null)
  })
  it('fee changed with custom gas prices keeps the original error and no soft confirmation', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
        medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
        fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
        ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
      }
    )

    // The user explicitly set advanced gas prices, so we don't override them
    controller.hasCustomGasPrices = true

    const originalMessage =
      'Transaction fee underpriced. Min expected: 0.03700292154970737. Please select a higher fee and try again'
    const error = new Error(originalMessage)

    try {
      await controller.throwBroadcastAccountOp({ error })
    } catch (e: any) {
      expect(e.message).toBe(originalMessage)
    }

    expect(controller.gasFeeChangedConfirmationRequired).toBe(false)

    const lastError = controller.emittedErrors[controller.emittedErrors.length - 1]
    expect(lastError?.level).toBe('major')
  })
  it('a bundler error that is not about the fee shows an error toast instead of the gas fee updated confirmation', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
        medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
        fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
        ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
      }
    )

    // ethers puts the request payload in the message, so it always contains the
    // user operation's maxFeePerGas and maxPriorityFeePerGas
    const userOpPayload = {
      method: 'eth_sendUserOperation',
      params: [{ sender: eoaAccount.addr, maxFeePerGas: '0x258', maxPriorityFeePerGas: '0x12c' }]
    }
    const error = makeError('could not coalesce error', 'UNKNOWN_ERROR', {
      error: { code: -32500, message: "AA21 didn't pay prefund" },
      payload: userOpPayload
    })

    expect(() => controller.throwBroadcastAccountOp({ error })).toThrow("AA21 didn't pay prefund")

    expect(controller.gasFeeChangedConfirmationRequired).toBe(false)
    expect(controller.previousFee).toBe(null)
    // The user is brought back to the initial signing step
    expect(controller.status?.type).toBe(SigningStatus.ReadyToSign)

    const lastError = controller.emittedErrors[controller.emittedErrors.length - 1]
    expect(lastError?.level).toBe('major')
  })
  it('a bundler error about the fee shows the gas fee updated confirmation', async () => {
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions: []
        },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions: [],
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
        medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
        fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
        ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
      }
    )

    // ethers puts the request payload in the message, so it always contains the
    // user operation's maxFeePerGas and maxPriorityFeePerGas
    const userOpPayload = {
      method: 'eth_sendUserOperation',
      params: [{ sender: eoaAccount.addr, maxFeePerGas: '0x258', maxPriorityFeePerGas: '0x12c' }]
    }
    const error = makeError('could not coalesce error', 'UNKNOWN_ERROR', {
      error: {
        code: -32602,
        message:
          'maxFeePerGas must be at least 1200 (current maxFeePerGas: 600) - use pimlico_getUserOperationGasPrice to get the current gas price'
      },
      payload: userOpPayload
    })

    expect(() => controller.throwBroadcastAccountOp({ error })).toThrow(
      'Transaction fees changed. Please try again'
    )

    expect(controller.gasFeeChangedConfirmationRequired).toBe(true)

    const lastError = controller.emittedErrors[controller.emittedErrors.length - 1]
    expect(lastError?.level).toBe('silent')
  })
})

test('Signing [V1 with EOA payment]: working case', async () => {
  const feePaymentOptions = [
    {
      paidBy: eoaAccount.addr,
      availableAmount: 1000000000000000000n, // 1 ETH
      gasUsed: 0n,
      addedNative: 5000n,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        amount: 1n,
        symbol: 'eth',
        name: 'Ether',
        chainId: 1n,
        decimals: 18,
        marketDataIn: [],
        priceIn: [],
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        }
      }
    }
  ]
  const { controller } = await init(
    v1Account,
    createAccountOp(v1Account),
    eoaSigner,
    {
      providerEstimation: {
        gasUsed: 10000n,
        feePaymentOptions
      },
      ambireEstimation: {
        deploymentGas: 0n,
        gasUsed: 10000n,
        feePaymentOptions,
        ambireAccountNonce: 0,
        flags: {}
      },
      flags: {},
      updatedAt: Date.now()
    },
    {
      slow: {
        maxFeePerGas: toBeHex(200n) as Hex,
        maxPriorityFeePerGas: toBeHex(100n) as Hex
      },
      medium: {
        maxFeePerGas: toBeHex(400n) as Hex,
        maxPriorityFeePerGas: toBeHex(200n) as Hex
      },
      fast: {
        maxFeePerGas: toBeHex(600n) as Hex,
        maxPriorityFeePerGas: toBeHex(300n) as Hex
      },
      ape: {
        maxFeePerGas: toBeHex(800n) as Hex,
        maxPriorityFeePerGas: toBeHex(400n) as Hex
      }
    }
  )

  controller.update({
    hasNewEstimation: true,
    feeToken: nativeFeeToken,
    paidBy: eoaSigner.keyPublicAddress,
    signingKeyAddr: eoaSigner.keyPublicAddress,
    signingKeyType: 'internal'
  })

  await controller.sign()

  if (!controller.accountOp?.signature) {
    console.log('Signing errors:', controller.errors)
    throw new Error('Signing failed!')
  }

  const message = accountOpSignableHash(controller.accountOp, 1n)
  const unwrappedSig = controller.accountOp.signature.slice(0, -2)
  const signerAddr = verifyMessage(message, unwrappedSig)

  // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
  expect(eoaSigner.keyPublicAddress).toEqual(signerAddr)

  // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
  expect(controller.accountOp?.signature.slice(-2)).toEqual('01')

  // If signing is successful, we expect controller's status to be done
  expect(controller.status).toEqual({ type: 'done' })
})

describe('ERC-7730 humanization', () => {
  test('shows loading, uses ERC-7730 data, caches it and fetches a shared batch descriptor once', async () => {
    const tokenAddress = '0x1111111111111111111111111111111111111111'
    const spender = '0x2222222222222222222222222222222222222222'
    const registryPath = 'registry/test/approve.json'
    const approveInterface = new Interface(['function approve(address _spender, uint256 _value)'])
    const calls = Array.from({ length: 10 }, (_, index) => ({
      to: tokenAddress,
      value: 0n,
      data: approveInterface.encodeFunctionData('approve', [spender, BigInt(index + 1)])
    }))
    const descriptorResponse = createDeferred<any>()
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${tokenAddress}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return descriptorResponse.promise
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const { controller } = await initDappVerificationBannerTest(customDapp, {
      calls,
      callRelayer
    })

    try {
      expect(controller.isHumanizing).toBe(true)
      expect(controller.humanization).toEqual([])

      descriptorResponse.resolve({
        success: true,
        display: {
          formats: {
            'approve(address _spender, uint256 _value)': {
              intent: 'Approve with ERC-7730',
              fields: [
                {
                  path: '#._spender',
                  label: 'Spender',
                  format: 'addressName',
                  visible: 'always'
                },
                {
                  path: '#._value',
                  label: 'Amount',
                  format: 'tokenAmount',
                  params: { tokenPath: '@.to' },
                  visible: 'always'
                }
              ]
            }
          }
        }
      })
      await wait(0)

      expect(controller.isHumanizing).toBe(false)
      expect(
        callRelayer.mock.calls.filter(([path]) => path === '/v2/erc7730/account-op')
      ).toHaveLength(1)
      expect(
        callRelayer.mock.calls.filter(([path]) => path === '/v2/erc7730/fetch-descriptor')
      ).toHaveLength(1)
      expect(controller.humanization).toHaveLength(10)
      controller.humanization.forEach((humanizedCall, index) => {
        expect(humanizedCall.fullVisualization?.[0]).toMatchObject({
          type: 'erc7730',
          intent: [expect.objectContaining({ content: 'Approve with ERC-7730' })],
          fields: [
            {
              type: 'single-value',
              label: 'Spender',
              value: { type: 'address', address: spender }
            },
            {
              type: 'single-value',
              label: 'Amount',
              value: { type: 'token', address: tokenAddress, value: BigInt(index + 1), chainId: 1n }
            }
          ]
        })
      })

      callRelayer.mockClear()
      const previousHumanization = controller.humanization
      controller.humanize()
      expect(controller.isHumanizing).toBe(true)
      expect(controller.humanization).toBe(previousHumanization)
      await wait(0)

      expect(callRelayer).not.toHaveBeenCalled()
      expect(controller.humanization[0]?.fullVisualization?.[0]).toMatchObject({
        type: 'erc7730',
        intent: [expect.objectContaining({ content: 'Approve with ERC-7730' })]
      })
    } finally {
      controller.destroy()
    }
  })

  test('falls back to the old humanizer when no ERC-7730 descriptor is available', async () => {
    const callRelayer = jest.fn(async (path: string, method?: string) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {},
          errorState: []
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const { controller } = await initDappVerificationBannerTest(customDapp, {
      calls: [{ value: 1n, data: '0x' }],
      callRelayer
    })

    try {
      await wait(0)

      expect(controller.isHumanizing).toBe(false)
      expect(controller.humanization).toHaveLength(1)
      expect(controller.humanization[0]).toMatchObject({
        value: 1n,
        data: '0x'
      })
      expect(callRelayer).not.toHaveBeenCalled()
      expect(controller.humanization[0]?.fullVisualization).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'erc7730' })])
      )
    } finally {
      controller.destroy()
    }
  })
})

describe('significant balance decrease banners', () => {
  test.each(['one-click-transfer', 'one-click-swap-and-bridge'] as const)(
    'is not shown in the %s flow, where the user entered the amount themselves',
    async (type) => {
      const { controller, portfolio } = await initDappVerificationBannerTest(verifiedDapp, {
        type
      })
      const portfolioState = portfolio.getAccountPortfolioState(eoaAccount.addr)

      try {
        controller.setDiscoveryStatus(TraceCallDiscoveryStatus.Done)
        portfolioState['1'] = buildPortfolioState({
          amountBeforeSimulation: 5000n,
          amountPostSimulation: 3000n,
          isLoading: false
        })['1']

        expect(
          controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
        ).toBeUndefined()
      } finally {
        controller.destroy()
      }
    }
  )

  test('is shown for the same balance decrease outside of the one-click flows', async () => {
    const { controller, portfolio } = await initDappVerificationBannerTest(verifiedDapp, {
      type: 'default'
    })
    const portfolioState = portfolio.getAccountPortfolioState(eoaAccount.addr)

    try {
      controller.setDiscoveryStatus(TraceCallDiscoveryStatus.Done)
      portfolioState['1'] = buildPortfolioState({
        amountBeforeSimulation: 5000n,
        amountPostSimulation: 3000n,
        isLoading: false
      })['1']

      expect(
        controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
      ).toBeDefined()
    } finally {
      controller.destroy()
    }
  })

  test('keeps the previous banner while refreshing and recalculates when the result changes', async () => {
    const { controller, portfolio } = await initDappVerificationBannerTest(verifiedDapp)
    const portfolioState = portfolio.getAccountPortfolioState(eoaAccount.addr)

    controller.setDiscoveryStatus(TraceCallDiscoveryStatus.Done)
    portfolioState['1'] = { isReady: false, isLoading: true, errors: [] }
    expect(
      controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toBeUndefined()

    portfolioState['1'] = buildPortfolioState({
      amountBeforeSimulation: 5000n,
      amountPostSimulation: 3000n,
      isLoading: false
    })['1']
    const significantBalanceDecreaseBanner = controller.banners.find(
      ({ id }) => id === WARNINGS.significantBalanceDecrease.id
    )
    expect(significantBalanceDecreaseBanner).toEqual({
      id: WARNINGS.significantBalanceDecrease.id,
      type: 'warning',
      title: 'Significant balance decrease detected',
      text: 'Our checks indicate this transaction may significantly reduce your account balance.',
      secondaryText:
        'May be inaccurate when moving funds to another network or providing liquidity.'
    })

    portfolioState['1']!.isLoading = true
    expect(
      controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toEqual(significantBalanceDecreaseBanner)

    portfolioState['1'] = buildPortfolioState({
      amountBeforeSimulation: 5000n,
      amountPostSimulation: 5000n,
      isLoading: false
    })['1']
    expect(
      controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toBeUndefined()
    expect(
      controller.warnings.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toBeUndefined()
  })

  test('waits for token discovery to finish while the portfolio is refreshing', async () => {
    const { controller, portfolio } = await initDappVerificationBannerTest(verifiedDapp)
    const portfolioState = portfolio.getAccountPortfolioState(eoaAccount.addr)
    portfolioState['1'] = buildPortfolioState({
      amountBeforeSimulation: 5000n,
      amountPostSimulation: 3000n,
      isLoading: true
    })['1']

    controller.setDiscoveryStatus(TraceCallDiscoveryStatus.InProgress)
    expect(
      controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toBeUndefined()

    controller.setDiscoveryStatus(TraceCallDiscoveryStatus.Failed)
    expect(
      controller.banners.find(({ id }) => id === WARNINGS.significantBalanceDecrease.id)
    ).toEqual({
      id: WARNINGS.significantBalanceDecrease.id,
      type: 'warning',
      title: 'Significant balance decrease detected',
      text: 'Our checks indicate this transaction may significantly reduce your account balance.',
      secondaryText:
        'May be inaccurate when moving funds to another network or providing liquidity.'
    })
  })
})

describe('dapp verification banners', () => {
  test('should return loading banners', async () => {
    const { controller } = await initDappVerificationBannerTest(loadingDapp)

    expect(controller.banners).toEqual([
      {
        id: DAPP_VERIFICATION_BANNER_IDS.LOADING,
        type: 'warning',
        title: 'Safety check in progress',
        text: "We're still verifying the app. Please wait, or make sure you trust it before signing requests: Loading Dapp"
      }
    ])
  })

  test('should return failed verification banners', async () => {
    const { controller } = await initDappVerificationBannerTest(failedDapp)

    expect(controller.banners).toEqual([
      {
        id: DAPP_VERIFICATION_BANNER_IDS.FAILED_TO_GET_OR_UNKNOWN,
        type: 'warning',
        title: "App couldn't be verified",
        text: "We couldn't verify the app. Make sure you trust it before signing requests: Failed Dapp"
      }
    ])
  })

  test('should return blacklisted banners', async () => {
    const { controller } = await initDappVerificationBannerTest(blacklistedDapp)

    expect(controller.banners).toEqual([
      {
        id: DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED,
        type: 'error',
        title: 'Potentially harmful app',
        text: "This app didn't pass our safety check. Proceed at your own risk: Blacklisted Dapp"
      }
    ])
  })

  test('should hide not-in-catalog banners for non-Permit2 interactions', async () => {
    const { controller } = await initDappVerificationBannerTest(customDapp)

    expect(controller.banners).toEqual([])
  })

  test('should show not-in-catalog banners for Permit2 interactions', async () => {
    const { controller } = await initDappVerificationBannerTest(customDapp, { isPermit2: true })

    expect(controller.banners).toEqual([
      {
        id: DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG,
        type: 'warning',
        title: "App not in Ambire's catalog",
        text: 'App is not on the default Ambire App Catalog. Make sure you trust it before signing requests: Custom Dapp'
      }
    ])
  })

  // Scenario: dApp's own domain is in SUSPICIOUS_HOSTING_DOMAINS (e.g. my-dapp.vercel.app)
  // intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING warning banner
  test('should return SUSPICIOUS_HOSTING warning banner for dapps on suspicious hosting platforms', async () => {
    const { controller } = await initDappVerificationBannerTest(suspiciousHostingDapp)

    expect(controller.banners).toEqual([
      {
        id: DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING,
        type: 'warning',
        title: 'Suspicious app hosting',
        text: 'This app is hosted on a shared platform commonly used for phishing. Be careful - do not sign unless you are certain you trust it.',
        // The dApp is on its own vercel.app subdomain, so the user may mark it as trusted.
        trustableDappUrls: [suspiciousHostingDapp.url]
      }
    ])
  })

  // Scenario: VERIFIED dApp loaded as iframe inside a sites.google.com tab
  // intrinsic=VERIFIED, context=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING warning banner
  // Uses the real DappsController: the session carries the top frame the browser reported for it,
  // so the real #getFrameContextStatus derives the SUSPICIOUS_HOSTING context.
  test('should return SUSPICIOUS_HOSTING banner from frame context when dApp is an iframe in a suspicious hosting tab', async () => {
    const verifiedDappSession = new Session({
      tabId: 300,
      windowId: 1,
      url: verifiedDapp.url,
      frameId: 2,
      topFrameUrl: 'https://sites.google.com/view/fake-dapp'
    })

    const { controller } = await initDappVerificationBannerTest(verifiedDapp, {
      dappSessionId: verifiedDappSession.sessionId,
      sessions: [verifiedDappSession]
    })

    expect(controller.banners[0]?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING)
    expect(controller.banners[0]?.type).toBe('warning')
  })
})

describe('traceCall asset discovery', () => {
  suppressConsoleBeforeEach(true)

  const traceCallGasPrices = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }

  let getShouldUseAccessListCallSpy: jest.SpiedFunction<
    typeof accessListCallLib.getShouldUseAccessListCall
  >
  let createAccessListCallSpy: jest.SpiedFunction<typeof accessListCallLib.createAccessListCall>
  let debugTraceCallSpy: jest.SpiedFunction<typeof debugTraceCallLib.debugTraceCall>
  let ethSimulateV1Spy: jest.SpiedFunction<typeof ethSimulateV1Lib.ethSimulateV1>
  let addTokensToBeLearnedSpy: jest.SpiedFunction<
    typeof PortfolioController.prototype.addTokensToBeLearned
  >
  let addErc721sToBeLearnedSpy: jest.SpiedFunction<
    typeof PortfolioController.prototype.addErc721sToBeLearned
  >

  beforeEach(() => {
    // Defaults: the access list branch resolves with no discovered assets and
    // nothing new learned. Individual tests override these to drive a path.
    jest.spyOn(debugTraceCallLib, 'getStateOverride').mockReturnValue(undefined as any)
    getShouldUseAccessListCallSpy = jest
      .spyOn(accessListCallLib, 'getShouldUseAccessListCall')
      .mockReturnValue(true)
    createAccessListCallSpy = jest
      .spyOn(accessListCallLib, 'createAccessListCall')
      .mockResolvedValue([])
    debugTraceCallSpy = jest
      .spyOn(debugTraceCallLib, 'debugTraceCall')
      .mockResolvedValue({ tokens: [], nfts: [] })
    ethSimulateV1Spy = jest
      .spyOn(ethSimulateV1Lib, 'ethSimulateV1')
      .mockResolvedValue({ tokens: [], nfts: [] })
    addTokensToBeLearnedSpy = jest
      .spyOn(PortfolioController.prototype, 'addTokensToBeLearned')
      .mockReturnValue(false)
    addErc721sToBeLearnedSpy = jest
      .spyOn(PortfolioController.prototype, 'addErc721sToBeLearned')
      .mockReturnValue(false)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  // Builds a controller and neutralizes the discovery run that the estimate
  // interval fires on init, so every test starts from a clean NotStarted state
  // with empty mock history.
  const initTraceCall = async (onUpdateAfterTraceCallSuccess?: () => Promise<void>) => {
    const feePaymentOptions = [
      {
        paidBy: smartAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 25000n,
        addedNative: 0n,
        token: nativeFeeToken
      }
    ]
    const { controller } = await init(
      smartAccount,
      createAccountOp(smartAccount, 1n),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 25000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 25000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      traceCallGasPrices,
      false,
      { onUpdateAfterTraceCallSuccess }
    )

    await wait(100)
    controller.traceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted
    clearDiscoverTxnTokensCache()
    jest.clearAllMocks()

    return controller
  }

  test('runs the full discovery lifecycle and learns the discovered assets', async () => {
    const onUpdateAfterTraceCallSuccess = jest.fn(async () => {})
    const controller = await initTraceCall(onUpdateAfterTraceCallSuccess)

    const discovered = ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48']
    const debugTraceCallDeferred = createDeferred<{
      tokens: string[]
      nfts: [string, bigint[]][]
    }>()
    debugTraceCallSpy.mockReturnValue(debugTraceCallDeferred.promise)
    addTokensToBeLearnedSpy.mockReturnValue(true)

    jest.useFakeTimers()

    // Discovery is kicked off and immediately flips to InProgress.
    const traceCallPromise = (controller as any).traceCall()
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.InProgress)

    // A second request while one is in progress is a no-op (reentrancy guard).
    await (controller as any).traceCall()
    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)

    // Resolving discovery learns the assets, fires the success callback and
    // settles on Done.
    debugTraceCallDeferred.resolve({ tokens: discovered, nfts: [] })
    await traceCallPromise

    expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith(discovered, 1n)
    expect(addErc721sToBeLearnedSpy).toHaveBeenCalledWith([], smartAccount.addr, 1n)
    expect(ethSimulateV1Spy).not.toHaveBeenCalled()
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
    expect(onUpdateAfterTraceCallSuccess).toHaveBeenCalledTimes(1)
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)
  })

  test('prefers log-capable discovery and identifies a Uniswap v4 position NFT', async () => {
    const controller = await initTraceCall()
    const positionManager = '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e'
    const mintedPositionId = 12345n
    const discoveredAddresses = [
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      positionManager
    ]

    debugTraceCallSpy.mockResolvedValueOnce({
      tokens: discoveredAddresses,
      nfts: [[positionManager, [mintedPositionId]]]
    })
    addErc721sToBeLearnedSpy.mockReturnValueOnce(true)

    await (controller as any).traceCall()

    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)
    expect(ethSimulateV1Spy).not.toHaveBeenCalled()
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
    expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith(discoveredAddresses, 1n)
    expect(addErc721sToBeLearnedSpy).toHaveBeenCalledWith(
      [[positionManager, [mintedPositionId]]],
      smartAccount.addr,
      1n
    )
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)
  })

  test('uses access-list candidates when log-capable discovery methods are unavailable', async () => {
    const controller = await initTraceCall()
    const positionManager = '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e'

    createAccessListCallSpy.mockResolvedValueOnce([positionManager])
    debugTraceCallSpy.mockRejectedValueOnce(new Error('trace failed'))
    ethSimulateV1Spy.mockRejectedValueOnce(new Error('simulate failed'))

    await (controller as any).traceCall()

    expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith([positionManager], 1n)
    expect(addErc721sToBeLearnedSpy).toHaveBeenCalledWith(
      [[positionManager, []]],
      smartAccount.addr,
      1n
    )
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)

    controller.traceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted
    jest.clearAllMocks()

    await (controller as any).traceCall()

    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
  })

  test('uses debug_traceCall first and skips later methods when it succeeds', async () => {
    const onUpdateAfterTraceCallSuccess = jest.fn(async () => {})
    const controller = await initTraceCall(onUpdateAfterTraceCallSuccess)

    const emitErrorSpy = jest.fn()
    ;(controller as any).emitError = emitErrorSpy

    debugTraceCallSpy.mockResolvedValueOnce({
      tokens: ['0xdAC17F958D2ee523a2206206994597C13D831ec7'],
      nfts: []
    })

    await (controller as any).traceCall()

    expect(emitErrorSpy).not.toHaveBeenCalled()
    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)
    expect(ethSimulateV1Spy).not.toHaveBeenCalled()
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
    expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith(
      ['0xdAC17F958D2ee523a2206206994597C13D831ec7'],
      1n
    )
    // Nothing new learned (both learn spies default to false) -> no callback.
    expect(onUpdateAfterTraceCallSuccess).not.toHaveBeenCalled()
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)
  })

  test('falls back to eth_simulateV1 when debug trace fails', async () => {
    const controller = await initTraceCall()

    const emitErrorSpy = jest.fn()
    ;(controller as any).emitError = emitErrorSpy

    debugTraceCallSpy.mockRejectedValueOnce(new Error('trace failed'))
    ethSimulateV1Spy.mockResolvedValueOnce({
      tokens: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
      nfts: [['0x3Bd57Bf93dE179d2e47e86319F144d7482503C7d', [25n]]]
    })

    await (controller as any).traceCall()

    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)
    expect(ethSimulateV1Spy).toHaveBeenCalledTimes(1)
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
    expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith(
      ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
      1n
    )
    expect(addErc721sToBeLearnedSpy).toHaveBeenCalledWith(
      [['0x3Bd57Bf93dE179d2e47e86319F144d7482503C7d', [25n]]],
      smartAccount.addr,
      1n
    )
    // The debug_traceCall failure is not emitted as an error because
    // eth_simulateV1 succeeds.
    expect(emitErrorSpy).not.toHaveBeenCalled()
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)
  })

  test('tries the last successful method first on the next discovery', async () => {
    const controller = await initTraceCall()

    await (controller as any).traceCall()

    controller.traceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted
    jest.clearAllMocks()

    await (controller as any).traceCall()

    expect(debugTraceCallSpy).toHaveBeenCalledTimes(1)
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
    expect(ethSimulateV1Spy).not.toHaveBeenCalled()
  })

  test('falls back to the other methods when the cached method fails', async () => {
    const controller = await initTraceCall()

    await (controller as any).traceCall()

    controller.traceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted
    jest.clearAllMocks()
    debugTraceCallSpy.mockRejectedValueOnce(new Error('trace failed'))

    await (controller as any).traceCall()

    expect(debugTraceCallSpy.mock.invocationCallOrder[0]).toBeLessThan(
      ethSimulateV1Spy.mock.invocationCallOrder[0]!
    )
    expect(ethSimulateV1Spy).toHaveBeenCalledTimes(1)
    expect(createAccessListCallSpy).not.toHaveBeenCalled()
  })

  test('sets Failed and emits a silent error when discovery throws', async () => {
    const onUpdateAfterTraceCallSuccess = jest.fn(async () => {})
    const controller = await initTraceCall(onUpdateAfterTraceCallSuccess)

    const emitErrorSpy = jest.fn()
    ;(controller as any).emitError = emitErrorSpy

    getShouldUseAccessListCallSpy.mockReturnValue(false)
    debugTraceCallSpy.mockRejectedValueOnce(new Error('trace failed'))
    ethSimulateV1Spy.mockRejectedValueOnce(new Error('simulate failed'))

    await (controller as any).traceCall()

    expect(ethSimulateV1Spy).toHaveBeenCalledTimes(1)
    expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Failed)
    expect(emitErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'silent', message: 'Error in signAccountOp.traceCall' })
    )
    expect(onUpdateAfterTraceCallSuccess).not.toHaveBeenCalled()
  })

  // A cool way to not write two test cases for both branches
  describe.each([
    { branch: 'access-list', useAccessList: true },
    { branch: 'debug', useAccessList: false }
  ])('discards stale runs', ({ useAccessList }) => {
    test('the stale run does not overwrite the latest results', async () => {
      const controller = await initTraceCall()

      getShouldUseAccessListCallSpy.mockReturnValue(useAccessList)
      if (useAccessList) {
        debugTraceCallSpy.mockRejectedValue(new Error('trace failed'))
        ethSimulateV1Spy.mockRejectedValue(new Error('simulate failed'))
      }

      const deferredA = createDeferred<any>()
      const deferredB = createDeferred<any>()
      const armNextCall = (deferred: { promise: Promise<any> }) =>
        useAccessList
          ? createAccessListCallSpy.mockReturnValueOnce(deferred.promise)
          : debugTraceCallSpy.mockReturnValueOnce(deferred.promise)
      const resultWith = (token: string) =>
        useAccessList ? [token] : { tokens: [token], nfts: [] }

      armNextCall(deferredA)
      const runA = (controller as any).traceCall()
      if (useAccessList) {
        await wait(0)
        expect(createAccessListCallSpy).toHaveBeenCalledTimes(1)
      }

      // Supersede the in-flight run A with a newer run B.
      controller.traceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted
      armNextCall(deferredB)
      const runB = (controller as any).traceCall()

      // B finishes first and commits its discovered token.
      const tokenB = '0xB0B86991c6218b36C1d19D4A2e9Eb0CE3606eB48'
      deferredB.resolve(resultWith(tokenB))
      await runB

      expect(addTokensToBeLearnedSpy).toHaveBeenCalledWith([tokenB], 1n)
      expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)

      addTokensToBeLearnedSpy.mockClear()

      // A resolves late but is detected as stale and must not learn or mutate state.
      const tokenA = '0xA0a86991C6218b36c1D19D4a2E9eB0cE3606eb48'
      deferredA.resolve(resultWith(tokenA))
      await runA

      expect(addTokensToBeLearnedSpy).not.toHaveBeenCalled()
      expect(controller.traceCallDiscoveryStatus).toBe(TraceCallDiscoveryStatus.Done)
    })
  })
})

describe('external signer PIN sessions', () => {
  suppressConsoleBeforeEach(true)

  const pinSessionGasPrices = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }

  const initPinSession = async () => {
    const nfc = {
      type: 'nfc',
      deviceModel: '',
      deviceId: '',
      beginPinSession: jest.fn(async () => {}),
      endPinSession: jest.fn(async () => {})
    } as unknown as ExternalSignerController & {
      beginPinSession: jest.Mock
      endPinSession: jest.Mock
    }
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: nativeFeeToken
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 10000n, feePaymentOptions },
        flags: {},
        updatedAt: Date.now()
      } as any,
      pinSessionGasPrices,
      false,
      { externalSignerControllers: { nfc } as any }
    )

    return { controller, nfc }
  }

  test('opens the PIN session before signing and closes it once the whole flow is over', async () => {
    const { controller, nfc } = await initPinSession()
    const callOrder: string[] = []

    nfc.beginPinSession.mockImplementation(async () => {
      callOrder.push('begin')
    })
    nfc.endPinSession.mockImplementation(async () => {
      callOrder.push('end')
    })

    await controller.signAndBroadcast().catch(() => {})

    // One session for the whole account op, no matter how many signatures it takes -
    // that is what lets a single PIN entry cover all of them.
    expect(callOrder).toEqual(['begin', 'end'])
  })

  test('opens a new PIN session for the next account op, so the PIN is asked for again', async () => {
    const { controller, nfc } = await initPinSession()

    await controller.signAndBroadcast().catch(() => {})
    await controller.signAndBroadcast().catch(() => {})

    expect(nfc.beginPinSession).toHaveBeenCalledTimes(2)
    expect(nfc.endPinSession).toHaveBeenCalledTimes(2)
  })
})

describe('unlimited approval warnings', () => {
  const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7'
  const spender = '0x46705dfff24256421a05d056c29e81bdc09723b8'
  const approveInterface = new Interface(['function approve(address _spender, uint256 _value)'])

  const approveCall = (amount: bigint, dapp?: Dapp) => ({
    to: usdt,
    value: 0n,
    data: approveInterface.encodeFunctionData('approve', [spender, amount]),
    ...(dapp ? { dapp: getDappRequestData(dapp) } : {})
  })

  const humanizeApproval = async (amount: bigint, dapp: Dapp, includeDappOnCall = true) => {
    const { controller } = await initDappVerificationBannerTest(dapp, {
      calls: [approveCall(amount, includeDappOnCall ? dapp : undefined)] as AccountOp['calls'],
      // the ERC-7730 registry has no descriptor here, so every approval falls back to the
      // built-in descriptor - the path a real approval takes as well
      callRelayer: noErc7730DescriptorsRelayer
    })
    await wait(0)

    return controller
  }

  const hasUnlimitedApprovalWarning = (controller: SignAccountOpTesterController) =>
    !!controller.humanization[0]?.warnings?.some(
      (warning: HumanizerWarning) => warning.code === UNLIMITED_APPROVAL_WARNING_CODE
    )

  test('warns on a maximum approval requested by an app outside the catalog', async () => {
    const controller = await humanizeApproval(MaxUint256, customDapp)

    expect(hasUnlimitedApprovalWarning(controller)).toBe(true)
  })

  test('stays quiet on a maximum approval requested by an app in the catalog', async () => {
    const controller = await humanizeApproval(MaxUint256, verifiedDapp)

    expect(hasUnlimitedApprovalWarning(controller)).toBe(false)
  })

  test('warns on a maximum approval when the call carries no app', async () => {
    const controller = await humanizeApproval(MaxUint256, verifiedDapp, false)

    expect(hasUnlimitedApprovalWarning(controller)).toBe(true)
  })

  test('stays quiet on a finite approval, whatever the app', async () => {
    const controller = await humanizeApproval(1000000n, customDapp)

    expect(hasUnlimitedApprovalWarning(controller)).toBe(false)
  })

  // reading the same humanization twice must give the same array, or the calls on screen would
  // lose their identity on every render while a new humanization is running
  test('returns the same humanization when nothing is suppressed', async () => {
    const controller = await humanizeApproval(MaxUint256, customDapp)

    expect(controller.humanization).toBe(controller.humanization)
  })

  // the catalog is fetched, so it can arrive after the calls were already humanized
  test('drops the warning once the app turns out to be in the catalog, without humanizing again', async () => {
    const catalogSpy = jest
      .spyOn(DappsController.prototype, 'isDappInDefaultCatalog')
      .mockReturnValue(false)

    try {
      const controller = await humanizeApproval(MaxUint256, customDapp)
      expect(hasUnlimitedApprovalWarning(controller)).toBe(true)

      const humanizationIdBefore = controller.humanizationId
      catalogSpy.mockReturnValue(true)

      expect(hasUnlimitedApprovalWarning(controller)).toBe(false)
      // the same humanization is still in place - only the reading of it changed
      expect(controller.humanizationId).toBe(humanizationIdBefore)
    } finally {
      catalogSpy.mockRestore()
    }
  })

  test('brings the warning back when the app leaves the catalog', async () => {
    const catalogSpy = jest
      .spyOn(DappsController.prototype, 'isDappInDefaultCatalog')
      .mockReturnValue(true)

    try {
      const controller = await humanizeApproval(MaxUint256, customDapp)
      expect(hasUnlimitedApprovalWarning(controller)).toBe(false)

      catalogSpy.mockReturnValue(false)

      expect(hasUnlimitedApprovalWarning(controller)).toBe(true)
    } finally {
      catalogSpy.mockRestore()
    }
  })
})

describe('broadcasting a batch one transaction at a time', () => {
  suppressConsoleBeforeEach(true)
  afterEach(() => jest.restoreAllMocks())

  const batchGasPrices = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }

  /** An EOA broadcasts every call as its own transaction, so three calls take three signatures. */
  const createThreeCallBatch = (account: Account) => {
    const batch = createEOAAccountOp(account)
    batch.op.calls = [1n, 2n, 3n].map((value) => ({
      to: '0x0000000000000000000000000000000000000000',
      value,
      data: '0x' as Hex
    }))
    // Set, so the nonce is not read off the network during the test
    ;(batch.op as any).eoaNonce = 7n

    return batch
  }

  const initBatch = async (overrides?: {
    callRelayer?: any
    type?: SignAccountOpType
    onPartialBroadcast?: (sentAccountOp: any) => Promise<void>
  }) => {
    const submittedAccountOps: any[] = []
    const sentAccountOps: any[] = []
    const broadcastStatusesOnSuccess: SignAccountOpTesterController['broadcastStatus'][] = []
    let broadcastingController: SignAccountOpTesterController | undefined
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: nativeFeeToken
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createThreeCallBatch(eoaAccount),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 10000n, feePaymentOptions },
        flags: {},
        updatedAt: Date.now()
      } as any,
      batchGasPrices,
      false,
      {
        // Without this the account broadcasts through an EIP-7702 delegation, which
        // sends the whole batch as one transaction and takes a single signature.
        featureFlags: { eip7702: false },
        callRelayer: overrides?.callRelayer || ((async () => ({})) as any),
        type: overrides?.type,
        onBroadcastSuccess: async ({ submittedAccountOp }: any) => {
          submittedAccountOps.push(submittedAccountOp)
          if (broadcastingController) {
            broadcastStatusesOnSuccess.push(broadcastingController.broadcastStatus)
          }
        },
        onPartialBroadcast:
          overrides?.onPartialBroadcast ||
          (async (sentAccountOp: any) => {
            sentAccountOps.push(sentAccountOp)
          })
      }
    )
    broadcastingController = controller

    return { controller, submittedAccountOps, sentAccountOps, broadcastStatusesOnSuccess }
  }

  /**
   * Stands in for the network: every call becomes a transaction that is signed and
   * sent, with `failFromIndex` naming the first signature that refuses.
   */
  const mockBroadcastChain = (failFromIndex: number | null) => {
    jest
      .spyOn(broadcastLib, 'buildRawTransaction')
      .mockImplementation(async () => ({ to: '0x', value: 0n }) as any)

    let signedCount = 0
    const signRawTransaction = jest
      .spyOn(KeystoreSigner.prototype, 'signRawTransaction')
      .mockImplementation(async () => {
        if (failFromIndex !== null && signedCount >= failFromIndex) {
          throw new Error('Card operation cancelled.')
        }
        signedCount += 1

        return `0xsigned${signedCount}`
      })

    const broadcastTransaction = jest
      .spyOn(broadcastLib, 'broadcastTransaction')
      .mockImplementation(async () => ({ hash: `0xhash${signedCount}` }) as any)

    return { signRawTransaction, broadcastTransaction }
  }

  const getPartialBroadcastError = (controller: any) =>
    controller.emittedErrors.find((e: any) => e.message.startsWith('Only '))

  test('records every call and reports no error when the whole batch goes out', async () => {
    const { controller, submittedAccountOps } = await initBatch()
    const { signRawTransaction, broadcastTransaction } = mockBroadcastChain(null)

    await controller.signAndBroadcast().catch(() => {})

    expect(signRawTransaction).toHaveBeenCalledTimes(3)
    expect(broadcastTransaction).toHaveBeenCalledTimes(3)
    expect(submittedAccountOps).toHaveLength(1)
    expect(submittedAccountOps[0].calls).toHaveLength(3)
    expect(submittedAccountOps[0].identifiedBy.type).toBe('MultipleTxns')
    expect(getPartialBroadcastError(controller)).toBeUndefined()
  })

  test('stays in the loading broadcast status until the broadcast success handler finishes', async () => {
    const { controller, submittedAccountOps, broadcastStatusesOnSuccess } = await initBatch()
    mockBroadcastChain(null)

    expect(controller.broadcastStatus).toBe('INITIAL')

    await controller.signAndBroadcast().catch(() => {})

    // Closing the request of a signed Safe txn keeps its dashboard simulation only while the
    // status is still loading. The success handler is where that request gets closed, so
    // flipping the status before the handler finishes would drop the simulation of every
    // broadcast Safe txn.
    expect(submittedAccountOps).toHaveLength(1)
    expect(broadcastStatusesOnSuccess).toEqual(['LOADING'])
    expect(controller.broadcastStatus).toBe('INITIAL')
  })

  test('does not reach the broadcast success handler and leaves the loading status when nothing was sent', async () => {
    const { controller, submittedAccountOps, broadcastStatusesOnSuccess } = await initBatch()
    mockBroadcastChain(0)

    await controller.signAndBroadcast().catch(() => {})

    expect(submittedAccountOps).toHaveLength(0)
    expect(broadcastStatusesOnSuccess).toEqual([])
    expect(controller.broadcastStatus).toBe('INITIAL')
  })

  test('keeps every call but reports only the hashes that went out', async () => {
    const { controller, submittedAccountOps } = await initBatch()
    const { broadcastTransaction } = mockBroadcastChain(1)

    await controller.signAndBroadcast().catch(() => {})

    // Only the first went out. Every call is still recorded, with fewer hashes than
    // calls - that gap is what tells apart the calls that never went out, so they can
    // be marked as such instead of quietly disappearing from the account op.
    expect(broadcastTransaction).toHaveBeenCalledTimes(1)
    expect(submittedAccountOps).toHaveLength(1)
    expect(submittedAccountOps[0].calls).toHaveLength(3)
    expect(submittedAccountOps[0].identifiedBy.type).toBe('MultipleTxns')
    expect(submittedAccountOps[0].identifiedBy.identifier.split('-')).toHaveLength(1)
  })

  test('tells the user how much of the batch was sent, and why the rest was not', async () => {
    const { controller } = await initBatch()
    mockBroadcastChain(1)

    await controller.signAndBroadcast().catch(() => {})

    // Reporting only the part that succeeded would leave the user believing all three
    // transactions were sent.
    const partialBroadcastError = getPartialBroadcastError(controller)

    expect(partialBroadcastError).toBeDefined()
    expect(partialBroadcastError.level).toBe('major')
    expect(partialBroadcastError.message).toContain('Only 1 of 3 transactions')
    expect(partialBroadcastError.message).toContain('The remaining 2 could not be sent')
    expect(partialBroadcastError.message).toContain('Card operation cancelled.')
  })

  test('words the message for a single remaining transaction', async () => {
    const { controller } = await initBatch()
    mockBroadcastChain(2)

    await controller.signAndBroadcast().catch(() => {})

    expect(getPartialBroadcastError(controller).message).toContain(
      'Only 2 of 3 transactions in this batch were sent. The remaining one could not be sent'
    )
  })

  test('sends the whole batch even when the gas tank bookkeeping throws', async () => {
    const { controller, submittedAccountOps } = await initBatch({
      callRelayer: () => {
        throw new Error('relayer is unavailable')
      }
    })
    const { signRawTransaction } = mockBroadcastChain(null)

    await controller.signAndBroadcast().catch(() => {})

    // Recording the transaction for the gas tank is bookkeeping the broadcast does
    // not depend on. Letting it stop the batch would strand the calls after it, and
    // the ones already sent cannot be taken back.
    expect(signRawTransaction).toHaveBeenCalledTimes(3)
    expect(submittedAccountOps).toHaveLength(1)
    expect(submittedAccountOps[0].calls).toHaveLength(3)
    expect(getPartialBroadcastError(controller)).toBeUndefined()
  })

  test('keeps the fee payer key active between the signatures and clears it after the batch', async () => {
    const { controller } = await initBatch()
    const { broadcastTransaction } = mockBroadcastChain(null)
    const activeKeyTypesBetweenSignatures: (string | null)[] = []
    broadcastTransaction.mockImplementation(async () => {
      activeKeyTypesBetweenSignatures.push(controller.activeSigningKeyType)

      return { hash: `0xhash${activeKeyTypesBetweenSignatures.length}` } as any
    })

    await controller.signAndBroadcast().catch(() => {})

    // Clearing it between the signatures would make the device prompt in the UI
    // close and reopen for every transaction in the batch
    const feePayerKeyType = controller.accountOp.gasFeePayment?.paidByKeyType
    expect(feePayerKeyType).toBeTruthy()
    expect(activeKeyTypesBetweenSignatures).toEqual([
      feePayerKeyType,
      feePayerKeyType,
      feePayerKeyType
    ])
    expect(controller.activeSigningKeyType).toBeNull()
  })

  test('clears the active signing key type when a signature in the batch is refused', async () => {
    const { controller } = await initBatch()
    mockBroadcastChain(1)

    await controller.signAndBroadcast().catch(() => {})

    // Otherwise the UI keeps asking to confirm on a device that waits for nothing
    expect(controller.activeSigningKeyType).toBeNull()
  })

  test('reports a plain failure, not a partial success, when nothing was sent', async () => {
    const { controller, submittedAccountOps } = await initBatch()
    mockBroadcastChain(0)

    await controller.signAndBroadcast().catch(() => {})

    // Nothing reached the network, so there is no account op worth recording and the
    // failure is the whole story.
    expect(submittedAccountOps).toHaveLength(0)
    expect(getPartialBroadcastError(controller)).toBeUndefined()
  })

  test('records a partly sent batch as broadcast, without reporting a partial broadcast', async () => {
    const { controller, submittedAccountOps, sentAccountOps } = await initBatch()
    mockBroadcastChain(1)

    await controller.signAndBroadcast().catch(() => {})

    // Outside the built-in swap the sent part is the result of the broadcast, so it
    // goes through the regular success handler
    expect(submittedAccountOps).toHaveLength(1)
    expect(sentAccountOps).toHaveLength(0)
  })

  describe('nonces', () => {
    test('the saved sent part of a batch holds only the nonces of its sent txns', async () => {
      const { controller, submittedAccountOps } = await initBatch()
      mockBroadcastChain(2)

      await controller.signAndBroadcast().catch(() => {})

      expect(submittedAccountOps).toHaveLength(1)
      // The error path resets this.accountOp.eoaNonce, which must not reach the saved op
      expect(submittedAccountOps[0].eoaNonce).toBe(7n)
      expect(getSubmittedAccountOpNonces(submittedAccountOps[0], eoaAccount)).toEqual([
        { kind: 'sender', addr: eoaAccount.addr, nonce: 7n },
        { kind: 'sender', addr: eoaAccount.addr, nonce: 8n }
      ])
    })

    test('skips the nonce of a pending txn that the RPC does not count yet', async () => {
      const { controller, submittedAccountOps } = await initBatch()
      ;(controller.accountOp as any).eoaNonce = undefined
      jest.spyOn(controller.provider, 'getTransactionCount').mockResolvedValue(7)
      // Another pending op holds nonce 7
      const getNextNonce = jest
        .spyOn(ActivityController.prototype, 'getNextNonce')
        .mockReturnValue(8n)
      mockBroadcastChain(null)
      const buildRawTransaction = jest.mocked(broadcastLib.buildRawTransaction)

      await controller.signAndBroadcast().catch(() => {})

      expect(getNextNonce).toHaveBeenCalledWith(eoaAccount.addr, 1n, 'sender', 7n)
      expect(buildRawTransaction.mock.calls.map((call) => call[5])).toEqual([8, 9, 10])
      expect(submittedAccountOps[0].eoaNonce).toBe(8n)
    })

    test('a node that already has the txn counts it as sent', async () => {
      const { controller, submittedAccountOps } = await initBatch()
      jest
        .spyOn(broadcastLib, 'buildRawTransaction')
        .mockImplementation(async () => ({ to: '0x', value: 0n }) as any)
      let signedCount = 0
      jest.spyOn(KeystoreSigner.prototype, 'signRawTransaction').mockImplementation(async () => {
        signedCount += 1
        return `0x0${signedCount}`
      })
      jest.spyOn(broadcastLib, 'broadcastTransaction').mockImplementation(async () => {
        if (signedCount === 2) {
          throw new Error(
            'could not coalesce error (error={ "code": -32000, "message": "already known" })'
          )
        }
        return { hash: `0xhash${signedCount}` } as any
      })

      await controller.signAndBroadcast().catch(() => {})

      expect(submittedAccountOps).toHaveLength(1)
      expect(submittedAccountOps[0].identifiedBy.identifier.split('-')).toEqual([
        '0xhash1',
        keccak256('0x02'),
        '0xhash3'
      ])
      expect(getPartialBroadcastError(controller)).toBeUndefined()
    })
  })

  describe('broadcast refusals', () => {
    const rpcProvider = new JsonRpcProvider('http://127.0.0.1:1', EthersNetwork.from(1), {
      staticNetwork: EthersNetwork.from(1)
    })
    afterAll(() => rpcProvider.destroy())

    // Built the way ethers builds them from a node answer to eth_sendRawTransaction
    const nodeError = (message: string) =>
      rpcProvider.getRpcError(
        { method: 'eth_sendRawTransaction', params: ['0x00'], id: 1, jsonrpc: '2.0' },
        { id: 1, error: { code: -32000, message } }
      )

    const initRawTxn = async () => {
      const { controller } = await initBatch()
      ;(controller.accountOp as any).gasFeePayment = {
        ...controller.accountOp.gasFeePayment,
        broadcastOption: broadcastLib.BROADCAST_OPTIONS.bySelf
      }
      return controller
    }

    test('a txn of another app that holds the nonce gets a plain message and no fee change', async () => {
      const controller = await initRawTxn()

      expect(() =>
        controller.throwBroadcastAccountOp({
          error: nodeError('replacement transaction underpriced')
        })
      ).toThrow(
        'Another transaction from this account is still waiting to be confirmed. Wait for it to finish, then try again.'
      )
      expect(controller.gasFeeChangedConfirmationRequired).toBe(false)
    })

    test('a nonce that is already used refreshes the account state', async () => {
      const controller = await initRawTxn()
      const updateAccountState = jest
        .spyOn(AccountsController.prototype, 'updateAccountState')
        .mockResolvedValue(undefined)

      expect(() =>
        controller.throwBroadcastAccountOp({ error: nodeError('nonce too low') })
      ).toThrow('Pending transaction detected. Please try again in a few seconds')
      expect(updateAccountState).toHaveBeenCalledWith(eoaAccount.addr, 'pending', [1n], true)
    })
  })

  describe('in the built-in swap', () => {
    const initSwapBatch = (onPartialBroadcast?: (sentAccountOp: any) => Promise<void>) =>
      initBatch({ type: 'one-click-swap-and-bridge', onPartialBroadcast })

    test('reports the sent part and fails, without recording it as a successful broadcast', async () => {
      const { controller, submittedAccountOps, sentAccountOps } = await initSwapBatch()
      mockBroadcastChain(1)

      await controller.signAndBroadcast().catch(() => {})

      // The swap can't be shown as sent, as the user has to retry the rest of it
      expect(submittedAccountOps).toHaveLength(0)
      expect(getPartialBroadcastError(controller)).toBeUndefined()
      expect(controller.emittedErrors.some((e: any) => e.level === 'major')).toBe(true)

      expect(sentAccountOps).toHaveLength(1)
      const [sentAccountOp] = sentAccountOps
      expect(sentAccountOp.status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
      expect(sentAccountOp.identifiedBy).toEqual({ type: 'MultipleTxns', identifier: '0xhash1' })
      expect(sentAccountOp.txnId).toBe('0xhash1')
      // The calls that were not sent are kept, so they can be marked as such
      expect(sentAccountOp.calls).toHaveLength(3)
      // The nonce of the first sent txn, as the activity uses it to detect replaced txns
      expect(sentAccountOp.eoaNonce).toBe(7n)
    })

    test('names every sent txn in the reported part', async () => {
      const { controller, sentAccountOps } = await initSwapBatch()
      mockBroadcastChain(2)

      await controller.signAndBroadcast().catch(() => {})

      expect(sentAccountOps).toHaveLength(1)
      expect(sentAccountOps[0].identifiedBy.identifier).toBe('0xhash1-0xhash2')
      expect(sentAccountOps[0].txnId).toBe('0xhash2')
    })

    test('forgets the nonce after a partial send, so a retry reads it from the network', async () => {
      const { controller } = await initSwapBatch()
      mockBroadcastChain(1)

      await controller.signAndBroadcast().catch(() => {})

      // Keeping the nonce would make a retry send the already sent txns again
      // or replace them while still pending
      expect(controller.accountOp.eoaNonce).toBeUndefined()
    })

    test('reports nothing when nothing was sent', async () => {
      const { controller, submittedAccountOps, sentAccountOps } = await initSwapBatch()
      mockBroadcastChain(0)

      await controller.signAndBroadcast().catch(() => {})

      expect(sentAccountOps).toHaveLength(0)
      expect(submittedAccountOps).toHaveLength(0)
    })

    test('reports nothing when the whole batch was sent', async () => {
      const { controller, submittedAccountOps, sentAccountOps } = await initSwapBatch()
      mockBroadcastChain(null)

      await controller.signAndBroadcast().catch(() => {})

      expect(sentAccountOps).toHaveLength(0)
      expect(submittedAccountOps).toHaveLength(1)
    })

    test('still shows why the batch stopped when reporting the sent part fails', async () => {
      const { controller } = await initSwapBatch(async () => {
        throw new Error('activity is unavailable')
      })
      mockBroadcastChain(1)

      await controller.signAndBroadcast().catch(() => {})

      const reportError = controller.emittedErrors.find((e: any) =>
        e.message.startsWith('Failed to report the sent part')
      )
      expect(reportError).toBeDefined()
      expect(reportError?.level).toBe('silent')
      expect(controller.emittedErrors.some((e: any) => e.level === 'major')).toBe(true)
      expect(controller.status?.type).toBe(SigningStatus.ReadyToSign)
    })
  })
})

describe('reestimation loop', () => {
  const loopGasPrices = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }

  const initLoop = async () => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 25000n,
        addedNative: 0n,
        token: nativeFeeToken
      }
    ]
    // Building the controller normally fires one estimate straight away, on the real clock. That
    // request is still waiting on the network when takeOverLoop switches to fake timers, so it
    // finishes somewhere in the middle of the loop below, where it counts as a reestimate even
    // though it never called the spy. The loop then reaches its limit one attempt short.
    // pauseOnInit keeps that first estimate from starting at all.
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 25000n, feePaymentOptions },
        flags: {},
        updatedAt: Date.now()
      },
      loopGasPrices,
      false,
      { pauseOnInit: true }
    )

    // The gas price loop is not under test and would otherwise hit the network
    jest.spyOn(controller.gasPrice, 'fetch').mockImplementation(async () => {})

    return controller
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  /**
   * Hands the estimate loop over to the fake clock. The interval scheduled while
   * the controller was built belongs to the real one, so without this no tick
   * ever fires and every assertion below would pass on an idle loop.
   */
  const takeOverLoop = (controller: SignAccountOpController) => {
    jest.useFakeTimers()
    controller.pause()
    controller.resume()
  }

  /** Advances far enough to cover the give-up limit, including its growing waits. */
  const runLoop = async (ticks: number) => {
    for (let i = 0; i < ticks; i += 1) {
      await jest.advanceTimersByTimeAsync(ESTIMATE_UPDATE_INTERVAL)
    }
  }

  const TICKS_PAST_GIVE_UP = 200

  /** Stands in for an attempt that ended with the given failure. */
  const mockFailingEstimate = (controller: SignAccountOpController, kind: EstimationFailureKind) =>
    jest.spyOn(controller.estimation, 'estimate').mockImplementation(async () => {
      controller.estimation.status = EstimationStatus.Error
      controller.estimation.failureKind = kind
      controller.estimation.hasEstimated = true
    })

  test('stops asking once the failure cannot be fixed by asking again', async () => {
    const { restore } = suppressConsole()
    const controller = await initLoop()
    const estimate = mockFailingEstimate(controller, EstimationFailureKind.Permanent)

    takeOverLoop(controller)
    await runLoop(TICKS_PAST_GIVE_UP)

    // The account is gone or the network is off - the answer will not change,
    // so there is no reason to keep the user's providers busy
    expect(estimate).toHaveBeenCalledTimes(1)
    restore()
  })

  test('keeps asking while the failure may resolve on its own', async () => {
    const { restore } = suppressConsole()
    const controller = await initLoop()
    const estimate = mockFailingEstimate(controller, EstimationFailureKind.Retriable)

    takeOverLoop(controller)
    await runLoop(TICKS_PAST_GIVE_UP)

    // A connection that came back would produce a different answer, so the loop
    // keeps going until it hits the give-up limit
    expect(estimate).toHaveBeenCalledTimes(MAX_REESTIMATES + 1)
    restore()
  })

  test('gives up on a request the user left open', async () => {
    const { restore } = suppressConsole()
    const controller = await initLoop()
    const estimate = jest
      .spyOn(controller.estimation, 'estimate')
      .mockImplementation(async () => {})

    takeOverLoop(controller)
    await runLoop(TICKS_PAST_GIVE_UP)
    const callsAfterGivingUp = estimate.mock.calls.length

    expect(callsAfterGivingUp).toBe(MAX_REESTIMATES + 1)

    await runLoop(TICKS_PAST_GIVE_UP)

    // Confirms it really stopped rather than merely slowed down
    expect(estimate.mock.calls.length).toBe(callsAfterGivingUp)
    restore()
  })

  test('retry resumes a loop that had stopped refetching', async () => {
    const controller = await initLoop()
    const estimate = jest
      .spyOn(controller.estimation, 'estimate')
      .mockImplementation(async () => {})

    // pause leaves refetching stopped, the same state the give-up limit leaves behind
    controller.pause()

    jest.useFakeTimers()
    await runLoop(2)
    expect(estimate).not.toHaveBeenCalled()

    await controller.retry('estimate')
    await runLoop(1)

    // Without clearing the stopped flag the interval shuts itself down again on its
    // first run, which is what made the retry button do nothing
    expect(estimate).toHaveBeenCalled()
  })
})

describe('SignAccountOp signing authentication', () => {
  const ALICE = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
  const BOB = '0x8f4B2F3e18a4E1Fc5c9d95e1eE5A9B37a55f6A67'
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

  const dappA = makeDapp({ id: 'dapp-a.com', name: 'Dapp A', url: 'https://dapp-a.com' })
  const dappB = makeDapp({ id: 'dapp-b.com', name: 'Dapp B', url: 'https://dapp-b.com' })

  const initSigningAuth = async (
    calls: AccountOp['calls'],
    options?: { dapps?: Dapp[]; sentTo?: string[]; platform?: Platform }
  ) => {
    const accountOp = createEOAAccountOp(eoaAccount)
    ;(accountOp.op.calls as any) = calls

    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: parseEther('1'),
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      }
    ]

    const { controller } = await init(
      eoaAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: { gasUsed: 10000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      },
      {
        slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
        medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
        fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
        ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
      },
      false,
      {
        dapps: options?.dapps,
        platform: options?.platform ?? 'mobile-ios',
        initialSetStorage: async (storageCtrl) => {
          if (!options?.sentTo?.length) return

          await storageCtrl.set('sentToHistory', {
            domains: {},
            recipients: {
              [eoaAccount.addr]: Object.fromEntries(
                options.sentTo.map((addr) => [getAddress(addr), Date.now()])
              )
            }
          })
        }
      }
    )

    // The recipients are resolved from the activity, which is read asynchronously
    await wait(1)

    return controller
  }

  const erc20 = new Interface([
    'function transfer(address to, uint256 amount)',
    'function approve(address spender, uint256 amount)'
  ])
  // Approving zero is a contract interaction that the network accepts from any account
  const approveData = erc20.encodeFunctionData('approve', [BOB, 0n]) as Hex

  test('a recipient the account has never sent to has to be confirmed', async () => {
    const controller = await initSigningAuth([{ to: ALICE, value: 1n, data: '0x' }])

    expect(controller.signingAuthRequirement).toEqual({
      firstTimeRecipients: [ALICE],
      unauthenticatedDapps: []
    })
  })

  test('a recipient the account has already sent to does not have to be confirmed', async () => {
    const controller = await initSigningAuth([{ to: ALICE, value: 1n, data: '0x' }], {
      sentTo: [ALICE]
    })

    expect(controller.signingAuthRequirement).toBe(null)
  })

  test('reads the recipient of a token transfer, not the token', async () => {
    const data = erc20.encodeFunctionData('transfer', [BOB, 1n]) as Hex
    const controller = await initSigningAuth([{ to: USDC, value: 0n, data }])

    expect(controller.signingAuthRequirement?.firstTimeRecipients).toEqual([BOB])
  })

  // Being added to the wallet does not mean the user meant to send there, and an attacker who
  // gets an address saved must not be able to have the confirmation skipped because of it
  test('an account added to the wallet is still a first time recipient', async () => {
    const controller = await initSigningAuth([{ to: eoaAccount.addr, value: 1n, data: '0x' }])

    expect(controller.signingAuthRequirement?.firstTimeRecipients).toEqual([eoaAccount.addr])
  })

  test('paying the fee collector is not a first contact', async () => {
    const controller = await initSigningAuth([{ to: FEE_COLLECTOR, value: 1n, data: '0x' }])

    expect(controller.signingAuthRequirement).toBe(null)
  })

  test('a contract interaction on its own needs no recipient confirmation', async () => {
    const controller = await initSigningAuth([{ to: USDC, value: 0n, data: approveData }])

    expect(controller.signingAuthRequirement).toBe(null)
  })

  test('a dapp that has not been authenticated for signing has to be confirmed', async () => {
    const controller = await initSigningAuth(
      [{ to: USDC, value: 0n, data: approveData, dapp: dappA }],
      { dapps: [dappA] }
    )

    expect(controller.signingAuthRequirement).toEqual({
      firstTimeRecipients: [],
      unauthenticatedDapps: [{ id: dappA.id, name: dappA.name }]
    })
  })

  test('an already authenticated dapp does not have to be confirmed again', async () => {
    const controller = await initSigningAuth(
      [{ to: USDC, value: 0n, data: approveData, dapp: dappA }],
      { dapps: [{ ...dappA, signingAuthenticated: true }] }
    )

    expect(controller.signingAuthRequirement).toBe(null)
  })

  test('a batch lists every unauthenticated dapp once', async () => {
    const controller = await initSigningAuth(
      [
        { to: USDC, value: 0n, data: approveData, dapp: dappA },
        { to: USDC, value: 0n, data: approveData, dapp: dappB },
        { to: USDC, value: 0n, data: approveData, dapp: dappA }
      ],
      { dapps: [dappA, dappB] }
    )

    expect(controller.signingAuthRequirement?.unauthenticatedDapps).toEqual([
      { id: dappA.id, name: dappA.name },
      { id: dappB.id, name: dappB.name }
    ])
  })

  test('a dapp the catalog does not know is skipped, as the confirmation cannot be remembered', async () => {
    const controller = await initSigningAuth(
      [{ to: USDC, value: 0n, data: approveData, dapp: dappA }],
      { dapps: [dappB] }
    )

    expect(controller.signingAuthRequirement).toBe(null)
  })

  test('a first time recipient and an unauthenticated dapp are reported together', async () => {
    const controller = await initSigningAuth([{ to: ALICE, value: 1n, data: '0x', dapp: dappA }], {
      dapps: [dappA]
    })

    expect(controller.signingAuthRequirement).toEqual({
      firstTimeRecipients: [ALICE],
      unauthenticatedDapps: [{ id: dappA.id, name: dappA.name }]
    })
  })

  test('is never required outside of mobile, and the recipients are not looked up', async () => {
    const hasAccountOpsSentToSpy = jest.spyOn(ActivityController.prototype, 'hasAccountOpsSentTo')
    const controller = await initSigningAuth([{ to: ALICE, value: 1n, data: '0x', dapp: dappA }], {
      dapps: [dappA],
      platform: 'browser-webkit'
    })

    expect(controller.signingAuthRequirement).toBe(null)
    expect(hasAccountOpsSentToSpy).not.toHaveBeenCalled()

    hasAccountOpsSentToSpy.mockRestore()
  })
})

describe('Call data decoding', () => {
  const VAULT_CONTRACT = '0x3333333333333333333333333333333333333333'
  const RECIPIENT = '0x742d35CC6634C0532925a3b844bc1E4C23a39E18'
  const TRANSFER_SIGNATURE = 'transfer(address,uint256)'
  const DEPOSIT_SIGNATURE = 'depositToVault(uint256,bytes)'
  const CLAIM_SIGNATURE = 'claimRewardsFor(address)'
  const STAKE_SIGNATURE = 'stakeInPool(uint256)'
  const HARVEST_SIGNATURE = 'harvestAll(uint256[])'
  const REBALANCE_SIGNATURE = 'rebalanceVault(uint256,uint256)'

  const encode = (signature: string, args: unknown[]) =>
    new Interface([`function ${signature}`]).encodeFunctionData(signature.split('(')[0]!, args)
  const selectorOf = (data: string) => data.slice(0, CALLDATA_SELECTOR_HEX_LENGTH)
  const prefixOf = (selector: string) => selector.slice(0, 6)

  const transferData = encode(TRANSFER_SIGNATURE, [RECIPIENT, 1000n])
  const toCall = (data: string) => ({ to: VAULT_CONTRACT, value: 0n, data })
  const depositCall = toCall(encode(DEPOSIT_SIGNATURE, [5n, transferData]))
  const claimCall = toCall(encode(CLAIM_SIGNATURE, [RECIPIENT]))
  const stakeCall = toCall(encode(STAKE_SIGNATURE, [7n]))
  const harvestCall = toCall(encode(HARVEST_SIGNATURE, [[1n, 2n]]))
  const rebalanceCall = toCall(encode(REBALANCE_SIGNATURE, [3n, 4n]))

  const API_SIGNATURES = Object.fromEntries(
    [
      [transferData, TRANSFER_SIGNATURE],
      [depositCall.data, DEPOSIT_SIGNATURE],
      [claimCall.data, CLAIM_SIGNATURE],
      [stakeCall.data, STAKE_SIGNATURE],
      [harvestCall.data, HARVEST_SIGNATURE],
      [rebalanceCall.data, REBALANCE_SIGNATURE]
    ].map(([data, signature]) => [selectorOf(data!), [signature!]])
  )

  const ERC7730_REGISTRY_PATH = 'registry/test/vault.json'

  // Holds the ERC-7730 lookup until the test lets it through, so the test decides when the
  // humanization lands. Without `erc7730Descriptor` no descriptors are found, so every call falls
  // back to the default view.
  const makeErc7730Relayer = (erc7730Descriptor?: { contract: string; display: unknown }) => {
    const descriptorLookup = createDeferred<void>()
    const callRelayer = jest.fn(async (path: string) => {
      if (path === '/v2/erc7730/account-op') {
        await descriptorLookup.promise
        const data = erc7730Descriptor
          ? { [`eip155:1:${erc7730Descriptor.contract}`]: ERC7730_REGISTRY_PATH }
          : {}
        return { success: true, data, errorState: [] }
      }
      if (erc7730Descriptor && path === '/v2/erc7730/fetch-descriptor') {
        return { success: true, display: erc7730Descriptor.display }
      }

      throw new Error(`Unexpected relayer call: ${path}`)
    })

    return {
      callRelayer: callRelayer as unknown as BindedRelayerCall,
      releaseHumanization: () => descriptorLookup.resolve()
    }
  }

  const initWithCalls = async (
    calls: AccountOp['calls'],
    options: {
      contractInfoFetch?: Fetch
      contractInfo?: ContractInfoController
      savedSignatures?: Record<string, string>
      erc7730Descriptor?: Parameters<typeof makeErc7730Relayer>[0]
    } = {}
  ) => {
    const relayer = makeErc7730Relayer(options.erc7730Descriptor)
    const { controller, contractInfo } = await initDappVerificationBannerTest(customDapp, {
      calls,
      callRelayer: relayer.callRelayer,
      contractInfoFetch: options.contractInfoFetch,
      contractInfo: options.contractInfo,
      initialSetStorage: options.savedSignatures
        ? async (storageCtrl) => {
            await storageCtrl.set(
              FUNCTION_SELECTORS_STORAGE_KEY,
              Object.fromEntries(
                Object.entries(options.savedSignatures!).map(([selector, signature]) => [
                  selector,
                  { status: 'success', data: [{ signature }], updatedAt: Date.now() }
                ])
              )
            )
          }
        : undefined
    })

    return { controller, contractInfo, releaseHumanization: relayer.releaseHumanization }
  }

  const waitForHumanization = (controller: SignAccountOpController) =>
    waitUntil(
      () => !controller.isHumanizing && controller.humanization.length > 0,
      'the calls are humanized'
    )

  const getNestedTransfer = (decodedCall: DecodedCall | undefined) =>
    decodedCall?.args[1]?.val as DecodedCall | string | undefined

  const FAKE_CLOCK_STEP_MS = 10
  const FAKE_CLOCK_LIMIT_MS = 30 * 1000
  const LATE_RESULT_SETTLE_MS = 1000

  afterEach(() => {
    jest.useRealTimers()
  })

  /**
   * Moves the fake clock forward in small steps until `condition` holds, letting pending promises
   * settle between steps. Throws with `description` when it doesn't hold in FAKE_CLOCK_LIMIT_MS.
   */
  const advanceUntil = async (condition: () => boolean, description: string) => {
    for (let elapsedMs = 0; !condition(); elapsedMs += FAKE_CLOCK_STEP_MS) {
      if (elapsedMs > FAKE_CLOCK_LIMIT_MS) throw new Error(`Timed out waiting until ${description}`)

      await jest.advanceTimersByTimeAsync(FAKE_CLOCK_STEP_MS)
    }
  }

  /**
   * Adds `lateCall` next to an already decoded deposit call, on the fake clock, with the selector
   * API held, and waits until the plain view is shown with `lateCall` loading. The selector
   * responses are still held when it returns.
   */
  const showWithHeldSelectors = async (lateCall: AccountOp['calls'][number]) => {
    const api = makeSelectorsApi(API_SIGNATURES, { holdResponses: true })
    const { controller, contractInfo, releaseHumanization } = await initWithCalls([depositCall], {
      contractInfoFetch: api.fetch,
      savedSignatures: {
        [selectorOf(depositCall.data)]: DEPOSIT_SIGNATURE,
        [selectorOf(transferData)]: TRANSFER_SIGNATURE
      }
    })
    releaseHumanization()
    await waitForHumanization(controller)
    expect(api.fetch).not.toHaveBeenCalled()

    jest.useFakeTimers()
    const startedAt = Date.now()
    controller.update({ accountOpData: { calls: [depositCall, lateCall] } })
    await advanceUntil(() => api.requests.length > 0, 'the selector of the new call is requested')
    await advanceUntil(
      () => !controller.isHumanizing && controller.humanization.length === 2,
      'the plain view is shown'
    )
    const fallbackHumanization = controller.humanization
    // No descriptor was found, and the held selectors don't hold the plain view back
    expect(Date.now() - startedAt).toBeLessThan(ERC7730_DESCRIPTOR_WAIT_MS)
    expect(fallbackHumanization[0]!.decodedCall?.signature).toBe(DEPOSIT_SIGNATURE)
    expect(fallbackHumanization[0]!.isDecodingCall).toBeUndefined()
    expect(fallbackHumanization[1]!.decodedCall).toBeUndefined()
    expect(fallbackHumanization[1]!.isDecodingCall).toBe(true)

    return { api, controller, contractInfo, fallbackHumanization, startedAt }
  }

  test('the first humanization it emits already has the calls decoded from saved selectors', async () => {
    const api = makeSelectorsApi(API_SIGNATURES)
    const { controller, releaseHumanization } = await initWithCalls([depositCall], {
      contractInfoFetch: api.fetch,
      savedSignatures: {
        [selectorOf(depositCall.data)]: DEPOSIT_SIGNATURE,
        [selectorOf(transferData)]: TRANSFER_SIGNATURE
      }
    })
    const emittedHumanizations: SignAccountOpController['humanization'][] = []
    controller.onUpdate(() => emittedHumanizations.push(controller.humanization))

    releaseHumanization()
    await waitForHumanization(controller)

    const firstEmittedCalls = emittedHumanizations.find((humanization) => humanization.length)
    expect(firstEmittedCalls![0]!.isFallback).toBe(true)
    expect(emittedHumanizations.flat().some((call) => call.isDecodingCall)).toBe(false)
    expect(firstEmittedCalls![0]!.decodedCall?.signature).toBe(DEPOSIT_SIGNATURE)
    expect((getNestedTransfer(firstEmittedCalls![0]!.decodedCall) as DecodedCall).signature).toBe(
      TRANSFER_SIGNATURE
    )
    expect(api.fetch).not.toHaveBeenCalled()

    controller.destroy()
  })

  test('shows the plain view without waiting for selectors it has not saved, with the call loading until all of them arrive', async () => {
    const api = makeSelectorsApi(API_SIGNATURES, { holdResponses: true })
    const { controller, releaseHumanization } = await initWithCalls([depositCall], {
      contractInfoFetch: api.fetch
    })
    const emittedHumanizations: SignAccountOpController['humanization'][] = []
    controller.onUpdate(() => emittedHumanizations.push(controller.humanization))
    releaseHumanization()

    await waitUntil(() => api.requests.length === 1, 'the top level selector is requested')
    expect(api.requests[0]!.prefixes).toEqual([prefixOf(selectorOf(depositCall.data))])
    await waitForHumanization(controller)
    expect(controller.humanization[0]!.isFallback).toBe(true)
    expect(controller.humanization[0]!.isDecodingCall).toBe(true)
    expect(controller.humanization[0]!.decodedCall).toBeUndefined()
    api.heldResponses[0]!.resolve()

    await waitUntil(() => api.requests.length === 2, 'the nested selector is requested')
    expect(api.requests[1]!.prefixes).toEqual([prefixOf(selectorOf(transferData))])
    // Still loading, since the nested call can't be decoded yet
    expect(controller.humanization[0]!.isDecodingCall).toBe(true)
    const emitsBeforeNestedSelector = emittedHumanizations.length
    api.heldResponses[1]!.resolve()

    await waitUntil(
      () => !controller.humanization[0]!.isDecodingCall,
      'the call stops loading once all of its selectors arrive'
    )
    expect(controller.humanization[0]!.decodedCall?.signature).toBe(DEPOSIT_SIGNATURE)
    expect(
      (getNestedTransfer(controller.humanization[0]!.decodedCall) as DecodedCall).signature
    ).toBe(TRANSFER_SIGNATURE)
    // Decoded and no longer loading in the same update
    expect(emittedHumanizations.length - emitsBeforeNestedSelector).toBe(1)

    await wait(200)
    expect(api.requests).toHaveLength(2)

    controller.destroy()
  })

  test('decodes a call again when its selector arrives after the plain view is shown, emitting the change once', async () => {
    const { api, controller, fallbackHumanization } = await showWithHeldSelectors(claimCall)
    const emittedHumanizations = new Set<SignAccountOpController['humanization']>()
    controller.onUpdate(() => emittedHumanizations.add(controller.humanization))

    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await advanceUntil(
      () => !!controller.humanization[1]!.decodedCall,
      'the late result is attached'
    )
    await jest.advanceTimersByTimeAsync(LATE_RESULT_SETTLE_MS)

    expect(controller.humanization[1]!.decodedCall!.signature).toBe(CLAIM_SIGNATURE)
    expect(controller.humanization[1]!.isDecodingCall).toBeUndefined()
    expect(controller.humanization).not.toBe(fallbackHumanization)
    // The call that was already decoded is kept as it is
    expect(controller.humanization[0]).toBe(fallbackHumanization[0])
    expect([...emittedHumanizations]).toEqual([controller.humanization])

    controller.destroy()
  })

  test('stops showing a call as loading after the loading deadline, and does not emit when its selector then turns out to be unknown', async () => {
    const { restore } = suppressConsole()
    const unknownCall = toCall(`0xdeadbeef${'00'.repeat(32)}`)
    const { api, controller, contractInfo, startedAt } = await showWithHeldSelectors(unknownCall)

    await advanceUntil(() => !controller.humanization[1]!.isDecodingCall, 'the call stops loading')
    const afterDeadlineHumanization = controller.humanization
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SELECTOR_LOADING_DEADLINE_MS)
    expect(api.heldResponses.length).toBeGreaterThan(0)
    expect(afterDeadlineHumanization[1]!.decodedCall).toBeUndefined()

    const emittedHumanizations = new Set<SignAccountOpController['humanization']>()
    controller.onUpdate(() => emittedHumanizations.add(controller.humanization))
    const decodeCallData = jest.spyOn(contractInfo, 'decodeCallData')

    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await advanceUntil(() => decodeCallData.mock.calls.length > 0, 'the calls are decoded again')
    await jest.advanceTimersByTimeAsync(LATE_RESULT_SETTLE_MS)

    expect(controller.humanization).toBe(afterDeadlineHumanization)
    expect([...emittedHumanizations].filter((h) => h !== afterDeadlineHumanization)).toEqual([])

    controller.destroy()
    restore()
  })

  test('decodes a call whose selector arrives after the loading deadline', async () => {
    const { restore } = suppressConsole()
    const { api, controller } = await showWithHeldSelectors(claimCall)

    await advanceUntil(() => !controller.humanization[1]!.isDecodingCall, 'the call stops loading')
    expect(controller.humanization[1]!.decodedCall).toBeUndefined()

    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await advanceUntil(
      () => !!controller.humanization[1]!.decodedCall,
      'the late result is attached'
    )

    expect(controller.humanization[1]!.decodedCall!.signature).toBe(CLAIM_SIGNATURE)
    expect(controller.humanization[1]!.isDecodingCall).toBeUndefined()

    controller.destroy()
    restore()
  })

  test('a newer humanization ignores the selectors an older one was still waiting for', async () => {
    const { restore } = suppressConsole()
    const api = makeSelectorsApi(API_SIGNATURES, { holdResponses: true })
    const { controller, contractInfo, releaseHumanization } = await initWithCalls([depositCall], {
      contractInfoFetch: api.fetch,
      savedSignatures: { [selectorOf(claimCall.data)]: CLAIM_SIGNATURE }
    })
    releaseHumanization()
    await waitUntil(() => api.requests.length === 1, 'the deposit selector is requested')
    await waitForHumanization(controller)
    expect(controller.humanization[0]!.isDecodingCall).toBe(true)

    controller.update({ accountOpData: { calls: [claimCall] } })
    await waitForHumanization(controller)
    const newerHumanization = controller.humanization
    expect(newerHumanization[0]!.decodedCall!.signature).toBe(CLAIM_SIGNATURE)
    expect(newerHumanization[0]!.isDecodingCall).toBeUndefined()

    const decodeCallData = jest.spyOn(contractInfo, 'decodeCallData')
    api.heldResponses[0]!.resolve()
    await waitUntil(() => api.requests.length === 2, 'the nested selector is requested')
    api.heldResponses[1]!.resolve()
    await waitUntil(
      () =>
        typeof getNestedTransfer(contractInfo.decodeCallData(depositCall.data) || undefined) ===
        'object',
      'the older calls can be fully decoded'
    )
    await wait(200)

    expect(decodeCallData).not.toHaveBeenCalledWith(claimCall.data)
    expect(controller.humanization).toBe(newerHumanization)

    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    controller.destroy()
    restore()
  })

  test('calls arriving in the same tick, across ticks and a second later are each fetched once and all decoded', async () => {
    const { restore } = suppressConsole()
    const api = makeSelectorsApi(API_SIGNATURES)
    const { controller, releaseHumanization } = await initWithCalls([depositCall], {
      contractInfoFetch: api.fetch
    })

    // Same tick as the first call
    controller.update({ accountOpData: { calls: [depositCall, claimCall] } })
    controller.update({ accountOpData: { calls: [depositCall, claimCall, stakeCall] } })
    releaseHumanization()

    await wait(1000)
    controller.update({
      accountOpData: { calls: [depositCall, claimCall, stakeCall, harvestCall] }
    })
    await wait(0)
    controller.update({
      accountOpData: { calls: [depositCall, claimCall, stakeCall, harvestCall, rebalanceCall] }
    })

    await waitUntil(
      () =>
        controller.humanization.length === 5 &&
        controller.humanization.every((call) => !!call.decodedCall) &&
        typeof getNestedTransfer(controller.humanization[0]!.decodedCall) === 'object',
      'all five calls and the nested call are decoded'
    )

    const requestedPrefixes = api.requests.flatMap(({ prefixes }) => prefixes)
    expect(requestedPrefixes).toHaveLength(new Set(requestedPrefixes).size)
    expect(requestedPrefixes.sort()).toEqual(Object.keys(API_SIGNATURES).map(prefixOf).sort())
    expect(api.requests[0]!.prefixes.sort()).toEqual(
      [depositCall, claimCall, stakeCall].map(({ data }) => prefixOf(selectorOf(data))).sort()
    )
    expect(api.requests).toHaveLength(3)
    expect(controller.humanization.map((call) => call.decodedCall!.signature)).toEqual([
      DEPOSIT_SIGNATURE,
      CLAIM_SIGNATURE,
      STAKE_SIGNATURE,
      HARVEST_SIGNATURE,
      REBALANCE_SIGNATURE
    ])

    controller.destroy()
    restore()
  })

  test('a request switched away from keeps decoding in the background, and shows it once switched back to', async () => {
    const { restore } = suppressConsole()
    const api = makeSelectorsApi(API_SIGNATURES, { holdResponses: true })
    const sharedStorage = new StorageController(produceMemoryStore())
    const sharedContractInfo = new ContractInfoController({
      fetch: api.fetch,
      storage: sharedStorage,
      featureFlags: new FeatureFlagsController({}, sharedStorage),
      ui: uiCtrl
    })

    const first = await initWithCalls([depositCall], { contractInfo: sharedContractInfo })
    first.releaseHumanization()
    await waitUntil(() => api.requests.length === 1, 'the first request asks for its selector')

    const second = await initWithCalls([depositCall, claimCall], {
      contractInfo: sharedContractInfo
    })
    // Switching to the second request, as RequestsController does
    first.controller.pause()
    second.releaseHumanization()
    await waitUntil(() => api.requests.length === 2, 'the second request asks for its selector')
    expect(api.requests[1]!.prefixes).toEqual([prefixOf(selectorOf(claimCall.data))])

    const firstEmits: SignAccountOpController['humanization'][] = []
    first.controller.onUpdate(() => firstEmits.push(first.controller.humanization))

    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await waitUntil(
      () =>
        api.requests.some(({ prefixes }) => prefixes.includes(prefixOf(selectorOf(transferData)))),
      'the nested selector is requested'
    )
    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await waitUntil(
      () =>
        !second.controller.isHumanizing &&
        second.controller.humanization.length === 2 &&
        second.controller.humanization.every((call) => !!call.decodedCall),
      'the second request is decoded'
    )
    await waitUntil(
      () => !first.controller.isHumanizing && !!first.controller.humanization[0]?.decodedCall,
      'the paused request is decoded'
    )
    expect(first.controller.isInRegistry()).toBe(false)

    firstEmits.length = 0
    first.controller.resume()
    expect(firstEmits.at(-1)![0]!.decodedCall!.signature).toBe(DEPOSIT_SIGNATURE)
    expect((getNestedTransfer(firstEmits.at(-1)![0]!.decodedCall) as DecodedCall).signature).toBe(
      TRANSFER_SIGNATURE
    )

    await wait(200)
    const nestedTransferRequests = api.requests.filter(({ prefixes }) =>
      prefixes.includes(prefixOf(selectorOf(transferData)))
    )
    expect(nestedTransferRequests).toHaveLength(1)
    const depositRequests = api.requests.filter(({ prefixes }) =>
      prefixes.includes(prefixOf(selectorOf(depositCall.data)))
    )
    expect(depositRequests).toHaveLength(1)

    first.controller.destroy()
    second.controller.destroy()
    restore()
  })

  test('shows a call with an ERC-7730 descriptor without waiting for its selectors, and decodes it once they arrive', async () => {
    const api = makeSelectorsApi(API_SIGNATURES, { holdResponses: true })
    const { controller, releaseHumanization } = await initWithCalls([stakeCall], {
      contractInfoFetch: api.fetch,
      erc7730Descriptor: {
        contract: VAULT_CONTRACT,
        display: {
          formats: {
            'stakeInPool(uint256 amount)': {
              intent: 'Stake in the pool',
              fields: [{ path: '#.amount', label: 'Amount', format: 'raw', visible: 'always' }]
            }
          }
        }
      }
    })
    releaseHumanization()

    await waitUntil(() => api.requests.length === 1, 'the selector is requested')
    await waitForHumanization(controller)
    const erc7730Humanization = controller.humanization
    expect(api.heldResponses).toHaveLength(1)
    expect(hasErc7730Humanization(erc7730Humanization)).toBe(true)
    expect(erc7730Humanization[0]!.decodedCall).toBeUndefined()

    api.heldResponses[0]!.resolve()
    await waitUntil(
      () => !!controller.humanization[0]!.decodedCall,
      'the call is decoded for its parsed data'
    )
    expect(controller.humanization[0]!.decodedCall!.signature).toBe(STAKE_SIGNATURE)
    expect(controller.humanization[0]!.fullVisualization).toBe(
      erc7730Humanization[0]!.fullVisualization
    )

    controller.destroy()
  })

  test('applies nothing from a humanization that was still in progress when it was destroyed', async () => {
    const { controller, releaseHumanization } = await initWithCalls([depositCall], {
      savedSignatures: {
        [selectorOf(depositCall.data)]: DEPOSIT_SIGNATURE,
        [selectorOf(transferData)]: TRANSFER_SIGNATURE
      }
    })
    const learnTokens = jest.spyOn(controller, 'learnTokens')
    expect(controller.isHumanizing).toBe(true)

    controller.destroy()
    releaseHumanization()
    await wait(200)

    expect(controller.humanization).toHaveLength(0)
    expect(learnTokens).not.toHaveBeenCalled()
  })

  test('leaves the humanization untouched when selectors arrive after it is destroyed', async () => {
    const { api, controller, contractInfo, fallbackHumanization } =
      await showWithHeldSelectors(claimCall)

    controller.destroy()
    api.heldResponses.forEach((heldResponse) => heldResponse.resolve())
    await advanceUntil(
      () => contractInfo.decodeCallData(claimCall.data)?.signature === CLAIM_SIGNATURE,
      'the late selector is saved'
    )
    // Past the loading deadline too, so that timer can't change anything either
    await jest.advanceTimersByTimeAsync(SELECTOR_LOADING_DEADLINE_MS)

    expect(controller.humanization).toBe(fallbackHumanization)
    expect(controller.humanization[1]!.decodedCall).toBeUndefined()
  })
})

describe('RPC gas prices with a bundler fallback', () => {
  suppressConsoleBeforeEach()

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const toGasSpeeds = (base: bigint): GasSpeeds => ({
    slow: { maxFeePerGas: toBeHex(base) as Hex, maxPriorityFeePerGas: toBeHex(base / 2n) as Hex },
    medium: {
      maxFeePerGas: toBeHex(base * 2n) as Hex,
      maxPriorityFeePerGas: toBeHex(base) as Hex
    },
    fast: {
      maxFeePerGas: toBeHex(base * 3n) as Hex,
      maxPriorityFeePerGas: toBeHex((base * 3n) / 2n) as Hex
    },
    ape: {
      maxFeePerGas: toBeHex(base * 4n) as Hex,
      maxPriorityFeePerGas: toBeHex(base * 2n) as Hex
    }
  })
  const rpcGasPrices = toGasSpeeds(1000n)
  const bundlerGasPrices = toGasSpeeds(5000n)
  const customGasPrices = toGasSpeeds(9000n)

  const getSpeed = (
    controller: SignAccountOpController,
    paidBy: string,
    speed: FeeSpeed,
    feeToken: TokenResult = nativeFeeToken
  ) => {
    const option = controller.estimation.availableFeeOptions.find(
      (o) => o.paidBy === paidBy && o.token.address === feeToken.address
    )!
    return controller.feeSpeeds[
      getFeeSpeedIdentifier(option, controller.accountOp.accountAddr)
    ]!.find(({ type }) => type === speed)!
  }

  /**
   * Builds a smart account signAccountOp with two native fee options: the account paying
   * by itself and an EOA paying for it (a broadcast outside the bundler). The estimation
   * comes with bundler gas prices, as a successful bundler estimation would.
   * A Safe pays by itself through the bundler, making it the default account here
   */
  const initSmartAccount = async (
    chainId: bigint,
    feeToken: TokenResult,
    account: Account = safeAccount
  ) => {
    // the gas prices are driven by the test, not fetched from the network
    const fetchSpy = jest.spyOn(GasPriceController.prototype, 'fetch').mockResolvedValue(undefined)
    const option = {
      availableAmount: 1000000000000000000n,
      gasUsed: 25000n,
      addedNative: 0n,
      token: feeToken
    }
    const feePaymentOptions = [
      { ...option, paidBy: account.addr },
      { ...option, paidBy: eoaAccount.addr }
    ]
    const paymaster = {
      isUsable: () => false,
      isSponsored: () => false,
      getEstimationData: () => null
    } as unknown as AbstractPaymaster

    const { controller } = await init(
      account,
      createAccountOp(account, chainId),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 25000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 25000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        bundlerEstimation: {
          callGasLimit: toBeHex(30000n),
          preVerificationGas: toBeHex(50000n),
          verificationGasLimit: toBeHex(100000n),
          paymasterVerificationGasLimit: toBeHex(0n),
          paymasterPostOpGasLimit: toBeHex(0n),
          gasPrice: bundlerGasPrices,
          paymaster,
          flags: {}
        },
        bundlerGasPrices,
        flags: {},
        updatedAt: Date.now()
      },
      bundlerGasPrices,
      false,
      // otherwise the estimate interval runs a real estimation right away and puts the
      // mocked one in a loading state, which skips the fee speeds calculation
      { pauseOnInit: true }
    )

    return { controller, fetchSpy }
  }

  test('uses the RPC gas prices for an EOA paying on Ethereum and the bundler ones for the Safe itself', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)

    // as the gas price controller would pass them
    controller.update({ rpcGasPrices })

    // broadcast by another EOA: the RPC gas prices, with no increase on top
    expect(getSpeed(controller, eoaAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(rpcGasPrices.fast.maxFeePerGas)
    )
    expect(getSpeed(controller, eoaAccount.addr, FeeSpeed.Fast).maxPriorityFeePerGas).toBe(
      BigInt(rpcGasPrices.fast.maxPriorityFeePerGas)
    )
    // broadcast by the bundler: the bundler gas prices
    expect(getSpeed(controller, safeAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(bundlerGasPrices.fast.maxFeePerGas)
    )
  })

  test('exposes the gas prices of the selected fee option', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)
    controller.update({ rpcGasPrices })

    controller.update({ feeToken: nativeFeeToken, paidBy: eoaAccount.addr })
    expect(controller.selectedOptionGasPrices).toEqual(rpcGasPrices)
    expect(controller.toJSON().selectedOptionGasPrices).toEqual(rpcGasPrices)

    controller.update({ feeToken: nativeFeeToken, paidBy: safeAccount.addr })
    expect(controller.selectedOptionGasPrices).toEqual(bundlerGasPrices)
  })

  test('falls back to the bundler gas prices until the RPC ones are fetched', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)

    expect(controller.rpcGasPrices).toBeUndefined()
    // slow is not increased, so it equals the bundler collection
    expect(getSpeed(controller, eoaAccount.addr, FeeSpeed.Slow).gasPrice).toBe(
      BigInt(bundlerGasPrices.slow.maxFeePerGas)
    )
  })

  test('a gas price controller update does not overwrite the bundler estimation gas prices', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)

    // the gas price controller mirrors the RPC gas prices in both of its fields
    controller.gasPrice.gasPrices = rpcGasPrices
    controller.gasPrice.rpcGasPrices = rpcGasPrices
    await controller.emitGasPriceUpdate()

    expect(controller.gasPrices).toEqual(bundlerGasPrices)
    expect(controller.rpcGasPrices).toEqual(rpcGasPrices)
    expect(getSpeed(controller, safeAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(bundlerGasPrices.fast.maxFeePerGas)
    )
    expect(getSpeed(controller, eoaAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(rpcGasPrices.fast.maxFeePerGas)
    )
  })

  test('marks the gas prices as coming from the bundler estimation on Ethereum', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)

    // the flag is truthful, and the strategy is what keeps the RPC fetch going
    // (see the gasPrice controller tests)

    expect(controller.gasPrice.areGasPricesUsedFromBundlerEstimation).toBe(true)
    expect(controller.baseAccount.getGasPriceFetchStrategy(controller.isErc4337Enabled)).toBe(
      'rpcWithBundlerFallback'
    )
  })

  test('custom gas prices override both collections', async () => {
    const { controller } = await initSmartAccount(1n, nativeFeeToken)
    controller.update({ rpcGasPrices })

    controller.update({ customGasPrices })

    expect(getSpeed(controller, eoaAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(customGasPrices.fast.maxFeePerGas)
    )
    expect(getSpeed(controller, safeAccount.addr, FeeSpeed.Fast).gasPrice).toBe(
      BigInt(customGasPrices.fast.maxFeePerGas)
    )
    controller.update({ feeToken: nativeFeeToken, paidBy: eoaAccount.addr })
    expect(controller.selectedOptionGasPrices).toEqual(customGasPrices)
  })

  test('ignores the RPC gas prices outside Ethereum', async () => {
    // the test environment has no Polygon state for the Safe, so use an Ambire smart
    // account, which prefers the bundler outside Ethereum just the same
    const { controller } = await initSmartAccount(137n, nativeFeeTokenPolygon, smartAccount)
    expect(controller.baseAccount.getGasPriceFetchStrategy(controller.isErc4337Enabled)).toBe(
      'bundlerWithRpcFallback'
    )

    controller.update({ rpcGasPrices })

    // slow is not increased, so it equals the bundler collection
    expect(
      getSpeed(controller, eoaAccount.addr, FeeSpeed.Slow, nativeFeeTokenPolygon).gasPrice
    ).toBe(BigInt(bundlerGasPrices.slow.maxFeePerGas))
    controller.update({ feeToken: nativeFeeTokenPolygon, paidBy: eoaAccount.addr })
    expect(controller.selectedOptionGasPrices).toEqual(bundlerGasPrices)
  })
})

describe('Safe fee payer after the payers get funded', () => {
  suppressConsoleBeforeEach()

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const gasPrices: GasSpeeds = {
    slow: { maxFeePerGas: toBeHex(1000n) as Hex, maxPriorityFeePerGas: toBeHex(500n) as Hex },
    medium: { maxFeePerGas: toBeHex(2000n) as Hex, maxPriorityFeePerGas: toBeHex(1000n) as Hex },
    fast: { maxFeePerGas: toBeHex(3000n) as Hex, maxPriorityFeePerGas: toBeHex(1500n) as Hex },
    ape: { maxFeePerGas: toBeHex(4000n) as Hex, maxPriorityFeePerGas: toBeHex(2000n) as Hex }
  }
  // Neither an owner of the Safe nor one that has paid for it
  const unlinkedPayer = '0x2222222222222222222222222222222222222222'
  const funded = 1000000000000000000n

  const feeOption = (paidBy: string, availableAmount: bigint) => ({
    paidBy,
    availableAmount,
    gasUsed: 25000n,
    addedNative: 0n,
    token: nativeFeeToken
  })

  /**
   * A Safe that can't pay the fee by itself, so the payer is picked from `payers`.
   * `lastFeePayer` has paid for the Safe before, which links it to the Safe
   */
  const initSafe = async (
    payers: { addr: string; availableAmount: bigint }[],
    lastFeePayer?: string
  ) => {
    jest.spyOn(GasPriceController.prototype, 'fetch').mockResolvedValue(undefined)
    jest
      .spyOn(ActivityController.prototype, 'getFeePayers')
      .mockReturnValue(lastFeePayer ? [lastFeePayer] : [])
    const feePaymentOptions = [
      feeOption(safeAccount.addr, 0n),
      ...payers.map(({ addr, availableAmount }) => feeOption(addr, availableAmount))
    ]
    const paymaster = {
      isUsable: () => false,
      isSponsored: () => false,
      getEstimationData: () => null
    } as unknown as AbstractPaymaster

    const { controller } = await init(
      safeAccount,
      createAccountOp(safeAccount),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 25000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 25000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        bundlerEstimation: {
          callGasLimit: toBeHex(30000n),
          preVerificationGas: toBeHex(50000n),
          verificationGasLimit: toBeHex(100000n),
          paymasterVerificationGasLimit: toBeHex(0n),
          paymasterPostOpGasLimit: toBeHex(0n),
          gasPrice: gasPrices,
          paymaster,
          flags: {}
        },
        bundlerGasPrices: gasPrices,
        flags: {},
        updatedAt: Date.now()
      },
      gasPrices,
      false,
      // otherwise a real estimation runs right away and replaces the mocked one
      { pauseOnInit: true }
    )

    return controller
  }

  /** A new estimation, as one would come after the payers' balances change */
  const estimateAgain = (
    controller: SignAccountOpController,
    payers: { addr: string; availableAmount: bigint }[]
  ) => {
    controller.estimation.availableFeeOptions = [
      feeOption(safeAccount.addr, 0n),
      ...payers.map(({ addr, availableAmount }) => feeOption(addr, availableAmount))
    ]
    controller.update({ hasNewEstimation: true })
  }

  test("picks a payer that already paid for the Safe once it's funded, instead of the Safe's own native", async () => {
    const controller = await initSafe(
      [{ addr: eoaAccount.addr, availableAmount: 0n }],
      eoaAccount.addr
    )
    // Nothing can pay, so the Safe's own native is selected, which the Safe can't pay with
    expect(controller.selectedOption?.paidBy).toBe(safeAccount.addr)

    estimateAgain(controller, [{ addr: eoaAccount.addr, availableAmount: funded }])

    expect(controller.selectedOption?.paidBy).toBe(eoaAccount.addr)
    expect(controller.selectedOption?.availableAmount).toBe(funded)
    expect(controller.accountOp.gasFeePayment?.paidBy).toBe(eoaAccount.addr)
    expect(controller.isSafeFeePayerChoiceRequired).toBe(false)
  })

  test("asks the user to choose when the funded payer would get linked to the Safe, instead of keeping the Safe's own native", async () => {
    const controller = await initSafe([{ addr: unlinkedPayer, availableAmount: 0n }])
    expect(controller.selectedOption?.paidBy).toBe(safeAccount.addr)

    estimateAgain(controller, [{ addr: unlinkedPayer, availableAmount: funded }])

    // Linking a new account to the Safe is the user's call, so it's never picked for them
    expect(controller.selectedOption).toBeUndefined()
    expect(controller.accountOp.gasFeePayment).toBeNull()
    expect(controller.isSafeFeePayerChoiceRequired).toBe(true)
  })

  test("keeps the Safe's own native while no other payer can pay", async () => {
    const controller = await initSafe(
      [{ addr: eoaAccount.addr, availableAmount: 0n }],
      eoaAccount.addr
    )

    estimateAgain(controller, [{ addr: eoaAccount.addr, availableAmount: 0n }])

    expect(controller.selectedOption?.paidBy).toBe(safeAccount.addr)
    expect(controller.accountOp.gasFeePayment?.paidBy).toBe(safeAccount.addr)
  })

  test('never replaces a payer the user picked while it can still pay', async () => {
    const controller = await initSafe(
      [
        { addr: eoaAccount.addr, availableAmount: funded },
        { addr: unlinkedPayer, availableAmount: funded }
      ],
      eoaAccount.addr
    )
    controller.update({ feeToken: nativeFeeToken, paidBy: unlinkedPayer })
    expect(controller.selectedOption?.paidBy).toBe(unlinkedPayer)

    estimateAgain(controller, [
      { addr: eoaAccount.addr, availableAmount: funded },
      { addr: unlinkedPayer, availableAmount: funded }
    ])

    expect(controller.selectedOption?.paidBy).toBe(unlinkedPayer)
    expect(controller.accountOp.gasFeePayment?.paidBy).toBe(unlinkedPayer)
  })

  test("keeps the payer when a custom gas price it can't afford is set, so the user can lower it", async () => {
    // Enough for the regular prices, but not for the custom ones below
    const lowAmount = 1000000000000n
    const controller = await initSafe(
      [
        { addr: eoaAccount.addr, availableAmount: lowAmount },
        { addr: unlinkedPayer, availableAmount: funded }
      ],
      eoaAccount.addr
    )
    expect(controller.selectedOption?.paidBy).toBe(eoaAccount.addr)

    const unaffordablePrice = toBeHex(10000000000n) as Hex
    const customGasPrices: GasSpeeds = {
      slow: { maxFeePerGas: unaffordablePrice, maxPriorityFeePerGas: unaffordablePrice },
      medium: { maxFeePerGas: unaffordablePrice, maxPriorityFeePerGas: unaffordablePrice },
      fast: { maxFeePerGas: unaffordablePrice, maxPriorityFeePerGas: unaffordablePrice },
      ape: { maxFeePerGas: unaffordablePrice, maxPriorityFeePerGas: unaffordablePrice }
    }
    controller.update({ customGasPrices })

    expect(controller.hasCustomGasPrices).toBe(true)
    expect(controller.selectedOption?.paidBy).toBe(eoaAccount.addr)
    expect(controller.accountOp.gasFeePayment?.paidBy).toBe(eoaAccount.addr)
    expect(controller.isSafeFeePayerChoiceRequired).toBe(false)

    // A new estimation keeps it too, while the custom prices are set
    estimateAgain(controller, [
      { addr: eoaAccount.addr, availableAmount: lowAmount },
      { addr: unlinkedPayer, availableAmount: funded }
    ])

    expect(controller.selectedOption?.paidBy).toBe(eoaAccount.addr)
    expect(controller.isSafeFeePayerChoiceRequired).toBe(false)
  })

  test('keeps the fee token the user wants as a default only when the fee is still paid with it', async () => {
    const linkedController = await initSafe(
      [{ addr: eoaAccount.addr, availableAmount: 0n }],
      eoaAccount.addr
    )
    linkedController.update({ pendingFeeTokenPreference: nativeFeeToken })

    estimateAgain(linkedController, [{ addr: eoaAccount.addr, availableAmount: funded }])

    // Another payer, but the same token
    expect(linkedController.pendingFeeTokenPreference).toEqual({ '1': nativeFeeToken.address })

    const unlinkedController = await initSafe([{ addr: unlinkedPayer, availableAmount: 0n }])
    unlinkedController.update({ pendingFeeTokenPreference: nativeFeeToken })

    estimateAgain(unlinkedController, [{ addr: unlinkedPayer, availableAmount: funded }])

    // Nothing is paid with it until the user picks a payer, so it isn't saved on signing
    expect(unlinkedController.pendingFeeTokenPreference).toBeNull()
  })
})

describe('speed up of a pending transaction', () => {
  const replacedIdentifiedBy = {
    type: 'Transaction' as const,
    identifier: `0x${'ab'.repeat(32)}`
  }
  const speedUpGasPrices: GasSpeeds = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }

  const initSpeedUp = async ({
    isSpeedUp = true,
    isCancel = false,
    replacedPaidBy
  }: {
    isSpeedUp?: boolean
    // Cancels the pending transaction instead of speeding it up
    isCancel?: boolean
    // Who paid for the pending transaction; unknown when not set
    replacedPaidBy?: string
  } = {}) => {
    const accountOp = createEOAAccountOp(eoaAccount)
    ;(accountOp.op.calls as any) = [
      { to: '0x0000000000000000000000000000000000000000', value: 1n, data: '0x' }
    ]
    if (replacedPaidBy) {
      ;(accountOp.op.gasFeePayment as any) = {
        paidBy: replacedPaidBy,
        inToken: '0x0000000000000000000000000000000000000000',
        feeTokenChainId: 1n,
        isGasTank: false,
        amount: 1000n,
        gasPrice: 100n,
        maxPriorityFeePerGas: 10n,
        simulatedGasLimit: 21000n,
        broadcastOption: 'bySelf',
        paidByKeyType: 'internal'
      }
    }
    if (isSpeedUp) {
      accountOp.op.meta = {
        ...accountOp.op.meta,
        speedUp: { enabled: true, replacedIdentifiedBy, ...(isCancel && { isCancel }) }
      }
    }
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: parseEther('1'),
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          marketDataIn: [],
          flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: true, isFeeToken: true }
        }
      }
    ]

    return init(
      eoaAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: { gasUsed: 10000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      } as any,
      speedUpGasPrices,
      false,
      {
        createReplacement: isSpeedUp
          ? (activity) => new TxnReplacement({ accountOp: accountOp.op, activity })
          : undefined
      }
    )
  }

  /** The callback the controller subscribed to activity updates with */
  const getActivityUpdateCallback = (onUpdateSpy: { mock: { calls: any[][] } }) =>
    onUpdateSpy.mock.calls.find(
      ([, id]) => typeof id === 'string' && id.startsWith('sign-account-op-speed-up')
    )?.[0] as (() => void) | undefined

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('signing key', () => {
    const otherKeyAddr = '0x714fD3Db837e72bD49B8edA02B8f4D53DfdDe5ce'

    test('a speed up keeps the signer of the pending transaction it reuses the signature of', async () => {
      jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
      const { controller } = await initSpeedUp()
      const originalSigner = controller.accountOp.signingKeyAddr
      expect(controller.canChangeSigningKey).toBe(false)

      controller.update({ signingKeyAddr: otherKeyAddr, signingKeyType: 'internal' })

      expect(controller.accountOp.signingKeyAddr).toBe(originalSigner)
      expect(controller.accountOp.signingKeyAddr).not.toBe(otherKeyAddr)
    })

    test('a cancel is signed again, so another key (e.g. another Safe owner) can sign it', async () => {
      jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
      const { controller } = await initSpeedUp({ isCancel: true })
      expect(controller.canChangeSigningKey).toBe(true)

      controller.update({ signingKeyAddr: otherKeyAddr, signingKeyType: 'internal' })

      expect(controller.accountOp.signingKeyAddr).toBe(otherKeyAddr)
      expect(controller.accountOp.signingKeyType).toBe('internal')
    })
  })

  test.each([
    AccountOpStatus.Success,
    AccountOpStatus.Failure,
    AccountOpStatus.UnknownButPastNonce
  ])(
    'stops when the original transaction gets the %s status while signing is pending',
    async (status) => {
      const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
      const findSpy = jest
        .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
        .mockReturnValue(undefined)
      const { controller } = await initSpeedUp()
      expect(controller.status?.type).not.toBe(SigningStatus.SpeedUpNotNeeded)

      findSpy.mockReturnValue({ status } as any)
      getActivityUpdateCallback(onUpdateSpy)?.()

      expect(findSpy).toHaveBeenCalledWith(replacedIdentifiedBy, eoaAccount.addr, 1n)
      expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
      expect(controller.readyToSign).toBe(false)
    }
  )

  test('does not ask how to pay for a speed up that is no longer needed', async () => {
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    // The original way of paying isn't available anymore, which would be an error while the
    // speed up is still needed. Other errors (e.g. of the estimation) are still shown
    const { controller } = await initSpeedUp({
      replacedPaidBy: '0x1111111111111111111111111111111111111111'
    })

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
    expect(controller.errors.some((e) => e.title.includes("can't be sped up"))).toBe(false)
  })

  test('stops right away when the original transaction was processed before opening', async () => {
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    const { controller } = await initSpeedUp()

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
  })

  test.each([AccountOpStatus.BroadcastedButNotConfirmed, AccountOpStatus.BroadcastButStuck])(
    'keeps going while the original transaction has the %s status',
    async (status) => {
      const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
      jest
        .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
        .mockReturnValue({ status } as any)
      const { controller } = await initSpeedUp()

      getActivityUpdateCallback(onUpdateSpy)?.()

      expect(controller.status?.type).not.toBe(SigningStatus.SpeedUpNotNeeded)
    }
  )

  test('blocks signing when the original way of paying is not available anymore', async () => {
    jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
    const { controller } = await initSpeedUp({
      replacedPaidBy: '0x1111111111111111111111111111111111111111'
    })

    expect(controller.errors).toHaveLength(1)
    expect(controller.errors[0]!.title).toContain("can't be sped up right now")
    expect(controller.status?.type).toBe(SigningStatus.UnableToSign)
    expect(controller.readyToSign).toBe(false)
  })

  test('allows signing when the original way of paying is available', async () => {
    jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
    const { controller } = await initSpeedUp({ replacedPaidBy: eoaAccount.addr })

    expect(controller.errors.some((e) => e.title.includes("can't be sped up"))).toBe(false)
    expect(controller.accountOp.gasFeePayment?.paidBy).toBe(eoaAccount.addr)
  })

  test('stops without an error toast when the original got processed while signing and the broadcast failed', async () => {
    const { restore } = suppressConsole()
    const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
    const findSpy = jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue(undefined)
    const { controller } = await initSpeedUp()
    const onError = jest.fn()
    controller.onError(onError)
    controller.updateStatus(SigningStatus.InProgress)

    findSpy.mockReturnValue({ status: AccountOpStatus.Success } as any)
    getActivityUpdateCallback(onUpdateSpy)?.()
    expect(controller.status?.type).toBe(SigningStatus.InProgress)

    // No further activity update comes: going back to ReadyToSign must check again
    expect(() => controller.throwBroadcastAccountOp({ message: 'nonce too low' })).toThrow()

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ level: 'silent' }))
    restore()
  })

  test('stops when the broadcast fails after the activity was no longer watched', async () => {
    const { restore } = suppressConsole()
    const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
    const findSpy = jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue(undefined)
    const { controller } = await initSpeedUp()
    // Signed and being broadcast, so the activity update ends the watching
    controller.updateStatus(SigningStatus.Done)

    findSpy.mockReturnValue({ status: AccountOpStatus.Success } as any)
    getActivityUpdateCallback(onUpdateSpy)?.()

    expect(() => controller.throwBroadcastAccountOp({ message: 'nonce too low' })).toThrow()

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
    restore()
  })

  test('shows the broadcast error when the original is still pending', async () => {
    const { restore } = suppressConsole()
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.BroadcastedButNotConfirmed } as any)
    const { controller } = await initSpeedUp()
    const onError = jest.fn()
    controller.onError(onError)
    controller.updateStatus(SigningStatus.InProgress)

    expect(() => controller.throwBroadcastAccountOp({ message: 'Broadcast failed' })).toThrow()

    expect(controller.status?.type).toBe(SigningStatus.ReadyToSign)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ level: 'major' }))
    restore()
  })

  test('a failed broadcast does not bring back a speed up that was stopped', async () => {
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    const { controller } = await initSpeedUp()
    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)

    controller.updateStatus(SigningStatus.ReadyToSign)

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
  })

  test('does not override the status once signing has started', async () => {
    const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
    const findSpy = jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue(undefined)
    const { controller } = await initSpeedUp()
    controller.updateStatus(SigningStatus.InProgress)

    findSpy.mockReturnValue({ status: AccountOpStatus.Success } as any)
    getActivityUpdateCallback(onUpdateSpy)?.()

    expect(controller.status?.type).toBe(SigningStatus.InProgress)
  })

  test('stays stopped after later updates', async () => {
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    const { controller } = await initSpeedUp()

    controller.updateStatus()
    controller.update({ hasNewEstimation: true })

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
  })

  test('stays stopped after a reset of the status', async () => {
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    const { controller } = await initSpeedUp()

    controller.resetStatus()

    expect(controller.status?.type).toBe(SigningStatus.SpeedUpNotNeeded)
  })

  test('does not restart refetching when resumed', async () => {
    const { restore } = suppressConsole()
    jest
      .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
      .mockReturnValue({ status: AccountOpStatus.Success } as any)
    const { controller } = await initSpeedUp()
    const startSpy = jest.spyOn(RecurringTimeout.prototype, 'start')
    const restartSpy = jest.spyOn(RecurringTimeout.prototype, 'restart')

    controller.resume()

    expect(startSpy).not.toHaveBeenCalled()
    expect(restartSpy).not.toHaveBeenCalled()
    restore()
  })

  test('does not watch the activity when no TxnReplacement is passed', async () => {
    const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
    const findSpy = jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy')
    await initSpeedUp({ isSpeedUp: false })

    expect(getActivityUpdateCallback(onUpdateSpy)).toBeUndefined()
    expect(findSpy).not.toHaveBeenCalled()
  })
})

describe('gas price refresh failures', () => {
  suppressConsoleBeforeEach(true)
  const refreshGasPrices = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  /** Runs the gas price refresh loop once and returns the error levels it asked for */
  const getRefreshErrorLevels = async (type: SignAccountOpType) => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n,
        gasUsed: 25000n,
        addedNative: 0n,
        token: nativeFeeToken
      }
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: { gasUsed: 25000n, feePaymentOptions },
        flags: {},
        updatedAt: Date.now()
      },
      refreshGasPrices,
      false,
      { type, pauseOnInit: true }
    )
    const fetch = jest.spyOn(controller.gasPrice, 'fetch').mockImplementation(async () => {})
    // The estimate loop is not under test and would otherwise hit the network
    jest.spyOn(controller.estimation, 'estimate').mockImplementation(async () => {})

    // Hand the loop over to the fake clock, as it was scheduled on the real one
    jest.useFakeTimers()
    controller.pause()
    controller.resume()
    fetch.mockClear()
    await jest.advanceTimersByTimeAsync(GAS_PRICE_UPDATE_INTERVAL)

    return fetch.mock.calls.map(([level]) => level)
  }

  test('keeps them silent on the swap screen, where users often just browse quotes', async () => {
    const levels = await getRefreshErrorLevels('one-click-swap-and-bridge')

    // Signing errors still show there, as they no longer get silenced along with these
    expect(levels).toContain('silent')
    expect(levels).not.toContain('major')
  })

  test('shows them everywhere else', async () => {
    const levels = await getRefreshErrorLevels('default')

    expect(levels).toContain('major')
  })
})

describe('speed up of a smart account transaction sent by another account', () => {
  // An Ambire signature: 65 bytes followed by the 1-byte signature type, so it can't be split
  // into 65-byte owner signatures like a Safe's
  const ambireSignature = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b01`
  const pendingTxnHash = `0x${'cd'.repeat(32)}`
  const gasPrices: GasSpeeds = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }
  const feePaymentOptions = [
    {
      paidBy: eoaSigner.keyPublicAddress,
      availableAmount: 1000000000000000000n,
      gasUsed: 0n,
      addedNative: 5000n,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        amount: parseEther('1'),
        symbol: 'ETH',
        name: 'Ether',
        chainId: 1n,
        decimals: 18,
        priceIn: [],
        marketDataIn: [],
        flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: true, isFeeToken: true }
      }
    }
  ]

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('opens with the signature of the pending transaction, which is not read as Safe owners', async () => {
    jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
    const accountOp = createAccountOp(smartAccount)
    accountOp.op.signature = ambireSignature
    accountOp.op.txnId = pendingTxnHash
    accountOp.op.signingKeyAddr = eoaSigner.keyPublicAddress
    accountOp.op.signingKeyType = 'internal'
    accountOp.op.meta = {
      speedUp: {
        enabled: true,
        replacedIdentifiedBy: { type: 'Transaction', identifier: pendingTxnHash }
      }
    }

    const { controller } = await init(
      smartAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: { gasUsed: 10000n, feePaymentOptions },
        ambireEstimation: {
          deploymentGas: 0n,
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: 0,
          flags: {}
        },
        flags: {},
        updatedAt: Date.now()
      } as any,
      gasPrices,
      false,
      { createReplacement: (activity) => new TxnReplacement({ accountOp: accountOp.op, activity }) }
    )

    expect(controller.isSpeedUpTransaction).toBe(true)
    expect(controller.accountOp.signature).toBe(ambireSignature)
    expect(controller.accountOp.signed).toBeUndefined()
    expect(controller.status?.type).not.toBe(SigningStatus.Queued)
  })
})

describe('an earlier pending transaction', () => {
  suppressConsoleBeforeEach(true)
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const chainId = 1n
  const nativeAddr = '0x0000000000000000000000000000000000000000'
  const gasPrices: GasSpeeds = {
    slow: { maxFeePerGas: toBeHex(200n) as Hex, maxPriorityFeePerGas: toBeHex(100n) as Hex },
    medium: { maxFeePerGas: toBeHex(400n) as Hex, maxPriorityFeePerGas: toBeHex(200n) as Hex },
    fast: { maxFeePerGas: toBeHex(600n) as Hex, maxPriorityFeePerGas: toBeHex(300n) as Hex },
    ape: { maxFeePerGas: toBeHex(800n) as Hex, maxPriorityFeePerGas: toBeHex(400n) as Hex }
  }
  // Above every speed, so a replacement must raise them all
  const pendingFees = { gasPrice: 1000n, maxPriorityFeePerGas: 500n }
  const nativeFeeOption = (paidBy: string) => ({
    paidBy,
    availableAmount: 1000000000000000000n,
    gasUsed: 0n,
    addedNative: 5000n,
    token: { ...nativeFeeToken, amount: parseEther('1') }
  })

  /** A sent op that is not confirmed yet, paid in native by `paidBy` from its own EOA nonce */
  const buildPendingAccountOp = ({
    id = 'pending-op',
    accountAddr = eoaAccount.addr,
    paidBy = eoaAccount.addr,
    broadcastOption = broadcastLib.BROADCAST_OPTIONS.bySelf,
    nonce = 0n,
    eoaNonce = 5n,
    ...overrides
  }: Partial<SubmittedAccountOp> & {
    paidBy?: string
    broadcastOption?: string
  } = {}): SubmittedAccountOp => ({
    id,
    accountAddr,
    chainId,
    signingKeyAddr: eoaSigner.keyPublicAddress,
    signingKeyType: 'internal',
    nonce,
    eoaNonce,
    calls: [{ to: nativeAddr, value: 1n, data: '0x' }],
    gasLimit: 21000,
    signature: '0x',
    gasFeePayment: {
      paidBy,
      paidByKeyType: 'internal',
      broadcastOption,
      isGasTank: false,
      inToken: nativeAddr,
      feeTokenChainId: chainId,
      amount: 21000n * pendingFees.gasPrice,
      simulatedGasLimit: 21000n,
      ...pendingFees
    },
    status: AccountOpStatus.BroadcastedButNotConfirmed,
    identifiedBy: { type: 'Transaction', identifier: `0x${'ab'.repeat(32)}` },
    timestamp: Date.now() - 1000,
    ...overrides
  })

  /**
   * Makes `pendingAccountOps` pending in Activity, which holds the nonces they took, and lets
   * the controller see them. Returns the spy of the pending ops, to confirm them later.
   */
  const holdBehind = (
    controller: SignAccountOpController,
    ...pendingAccountOps: SubmittedAccountOp[]
  ) => {
    const pendingAccountOpsSpy = jest
      .spyOn(ActivityController.prototype, 'broadcastedButNotConfirmed', 'get')
      .mockReturnValue(
        pendingAccountOps.reduce<{ [accountAddr: string]: SubmittedAccountOp[] }>(
          (byAccount, op) => ({
            ...byAccount,
            [op.accountAddr]: [...(byAccount[op.accountAddr] ?? []), op]
          }),
          {}
        )
      )
    controller.update({ hasNewEstimation: true })
    return pendingAccountOpsSpy
  }

  const hasEarlierPendingError = (controller: SignAccountOpController) =>
    controller.errors.some((error) => error.code === EARLIER_PENDING_TRANSACTION_ERROR_CODE)

  const initEoa = async ({
    isSpeedUp,
    onBroadcastSuccess,
    onPartialBroadcast,
    type,
    callsCount = 1,
    featureFlags = { eip7702: false }
  }: {
    isSpeedUp?: boolean
    onBroadcastSuccess?: (params: { submittedAccountOp: SubmittedAccountOp }) => Promise<void>
    onPartialBroadcast?: (sentAccountOp: SubmittedAccountOp) => Promise<void>
    type?: SignAccountOpType
    callsCount?: number
    featureFlags?: Partial<FeatureFlags>
  } = {}) => {
    const accountOp = createEOAAccountOp(eoaAccount)
    accountOp.op.calls = Array.from({ length: callsCount }, (_, i) => ({
      id: `call-${i}`,
      to: nativeAddr,
      value: 2n,
      data: '0x' as Hex
    }))
    if (isSpeedUp) {
      const pendingAccountOp = buildPendingAccountOp()
      Object.assign(accountOp.op, getReplacementAccountOp(pendingAccountOp, 'speedUp'))
    }
    const feePaymentOptions = [nativeFeeOption(eoaAccount.addr)]
    // Keeps the mocked estimation, as a real one would reload it in the background
    jest.spyOn(EstimationController.prototype, 'estimate').mockResolvedValue(undefined)

    return init(
      eoaAccount,
      accountOp,
      eoaSigner,
      {
        providerEstimation: { gasUsed: 21000n, feePaymentOptions },
        flags: {},
        updatedAt: Date.now()
      } as any,
      gasPrices,
      false,
      {
        // Without eip7702 off the account may broadcast through an EIP-7702 delegation
        featureFlags,
        onBroadcastSuccess,
        onPartialBroadcast,
        type,
        createReplacement: isSpeedUp
          ? (activity) => new TxnReplacement({ accountOp: accountOp.op, activity })
          : undefined
      }
    )
  }

  describe('an EOA', () => {
    test('is held back, and signing stops', async () => {
      const { controller } = await initEoa()
      expect(hasEarlierPendingError(controller)).toBe(false)

      holdBehind(controller, buildPendingAccountOp())

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(hasEarlierPendingError(controller)).toBe(true)
      expect(controller.status?.type).toBe(SigningStatus.UnableToSign)
      await controller.sign()
      expect(controller.status?.type).not.toBe(SigningStatus.Done)
      expect(controller.accountOp.signature).toBeFalsy()
    })

    test('is not held back by a pending op of another account or another network', async () => {
      const { controller } = await initEoa()

      holdBehind(
        controller,
        buildPendingAccountOp({
          id: 'other-account',
          accountAddr: smartAccount.addr,
          paidBy: smartAccount.addr,
          broadcastOption: broadcastLib.BROADCAST_OPTIONS.byBundler
        }),
        buildPendingAccountOp({ id: 'other-chain', chainId: 10n })
      )

      expect(controller.earlierPendingAccountOp).toBeNull()
      expect(hasEarlierPendingError(controller)).toBe(false)
    })

    test('a speed up of the pending op is not held back', async () => {
      jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
      const { controller } = await initEoa({ isSpeedUp: true })

      // An earlier speed up of the same txn, sent under its own id, holds the same nonce
      holdBehind(controller, buildPendingAccountOp({ id: 'earlier-speed-up' }))

      expect(controller.isSpeedUpTransaction).toBe(true)
      expect(controller.earlierPendingAccountOp).toBeNull()
      expect(hasEarlierPendingError(controller)).toBe(false)
    })

    test('a first-time delegation takes the nonce after the pending one, so Replace is not offered when another op holds it', async () => {
      const { controller } = await initEoa({
        callsCount: 2,
        featureFlags: { eip7702: true }
      })
      expect(controller.accountOp.gasFeePayment?.broadcastOption).toBe(
        broadcastLib.BROADCAST_OPTIONS.delegation
      )
      holdBehind(
        controller,
        buildPendingAccountOp(),
        buildPendingAccountOp({ id: 'next-op', eoaNonce: 6n })
      )

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)
    })

    test('is released and emits once Activity confirms the pending op', async () => {
      const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
      const { controller } = await initEoa()
      const pendingAccountOp = buildPendingAccountOp()
      const pendingAccountOpsSpy = holdBehind(controller, pendingAccountOp)
      const onActivityUpdate = onUpdateSpy.mock.calls.find(
        ([, id]) => typeof id === 'string' && id.startsWith('sign-account-op-earlier-pending')
      )?.[0] as (() => void) | undefined
      const onControllerUpdate = jest.fn()
      controller.onUpdate(onControllerUpdate)

      // Activity updates for other reasons while it's still pending
      onActivityUpdate?.()
      expect(onControllerUpdate).not.toHaveBeenCalled()

      pendingAccountOpsSpy.mockReturnValue({})
      onActivityUpdate?.()

      expect(onActivityUpdate).toBeDefined()
      expect(controller.earlierPendingAccountOp).toBeNull()
      expect(hasEarlierPendingError(controller)).toBe(false)
      expect(controller.status?.type).toBe(SigningStatus.ReadyToSign)
      expect(onControllerUpdate).toHaveBeenCalled()
    })
  })

  /** Stands in for the network, and records the nonce and fees of every sent txn */
  const mockRawBroadcast = ({ fail = false }: { fail?: boolean } = {}) => {
    const buildRawTransaction = jest
      .spyOn(broadcastLib, 'buildRawTransaction')
      .mockImplementation(async () => ({ to: '0x', value: 0n }) as any)
    jest
      .spyOn(KeystoreSigner.prototype, 'signRawTransaction')
      .mockImplementation(async () => '0xsigned')
    // An instance field, so it's replaced on each signer the keystore hands out
    const getSigner = KeystoreController.prototype.getSigner
    jest.spyOn(KeystoreController.prototype, 'getSigner').mockImplementation(async function (
      this: KeystoreController,
      ...args
    ) {
      const signer = await getSigner.apply(this, args)
      signer.signTransactionTypeFour = async () => '0xsigned'
      return signer
    })
    jest.spyOn(broadcastLib, 'broadcastTransaction').mockImplementation(async () => {
      if (fail) throw new Error('could not coalesce error (error={ "message": "network down" })')
      return { hash: `0x${'cd'.repeat(32)}` } as any
    })
    return buildRawTransaction
  }

  describe('Replace', () => {
    const replaceAndBroadcast = async (
      controller: SignAccountOpController,
      broadcastOption: string
    ) => {
      controller.replacePendingAccountOp()
      // How the account sends depends on its delegation, which these tests don't set up
      ;(controller.accountOp as any).gasFeePayment = {
        ...controller.accountOp.gasFeePayment,
        broadcastOption
      }
      await controller.signAndBroadcast().catch(() => {})
    }

    test.each([
      broadcastLib.BROADCAST_OPTIONS.bySelf,
      broadcastLib.BROADCAST_OPTIONS.bySelf7702,
      broadcastLib.BROADCAST_OPTIONS.delegation
    ])(
      '%s: sends with the nonce of the pending op and a fee high enough to replace it',
      async (broadcastOption) => {
        const submittedAccountOps: SubmittedAccountOp[] = []
        const { controller } = await initEoa({
          onBroadcastSuccess: async ({ submittedAccountOp }) => {
            submittedAccountOps.push(submittedAccountOp)
          }
        })
        const pendingAccountOp = buildPendingAccountOp({ broadcastOption })
        holdBehind(controller, pendingAccountOp)
        // The chain and the pending op both point past the pending nonce
        jest.spyOn(controller.provider, 'getTransactionCount').mockResolvedValue(6)
        const buildRawTransaction = mockRawBroadcast()
        // A delegation goes out through eth_sendRawTransaction directly
        jest.spyOn(controller.provider, 'send').mockResolvedValue(`0x${'cd'.repeat(32)}`)
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)

        await replaceAndBroadcast(controller, broadcastOption)

        const minFees = getMinReplacementFees(pendingFees)
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(hasEarlierPendingError(controller)).toBe(false)
        expect(buildRawTransaction.mock.calls.map((call) => call[5])).toEqual([5])
        expect(submittedAccountOps).toHaveLength(1)
        expect(submittedAccountOps[0]!.eoaNonce).toBe(5n)
        expect(submittedAccountOps[0]!.gasFeePayment!.gasPrice).toBeGreaterThanOrEqual(
          minFees.maxFeePerGas
        )
        expect(submittedAccountOps[0]!.gasFeePayment!.maxPriorityFeePerGas).toBeGreaterThanOrEqual(
          minFees.maxPriorityFeePerGas
        )
        if (broadcastOption === broadcastLib.BROADCAST_OPTIONS.delegation) {
          // The authorization comes after the txn, so it takes the next nonce
          expect(controller.accountOp.meta?.delegation?.nonce).toBe(toBeHex(6n))
        }
      }
    )

    test('a failed broadcast keeps the nonce of the pending op', async () => {
      const { controller } = await initEoa()
      holdBehind(controller, buildPendingAccountOp())
      mockRawBroadcast({ fail: true })

      await replaceAndBroadcast(controller, broadcastLib.BROADCAST_OPTIONS.bySelf)

      expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
      expect(controller.accountOp.eoaNonce).toBe(5n)
    })

    describe('when the user rejects the second call of a batch sent one transaction per call', () => {
      /** Call 1 goes out at the nonce of the pending op, then the signature of call 2 is refused */
      const replaceBatchAndRefuseSecondCall = async (type?: SignAccountOpType) => {
        const submittedAccountOps: SubmittedAccountOp[] = []
        const pendingAccountOp = buildPendingAccountOp()
        let pendingAccountOpsSpy: ReturnType<typeof holdBehind> | undefined
        const { controller } = await initEoa({
          callsCount: 3,
          type,
          onBroadcastSuccess: async ({ submittedAccountOp }) => {
            submittedAccountOps.push(submittedAccountOp)
            // Activity now holds the sent part, next to the pending op it replaced
            pendingAccountOpsSpy?.mockReturnValue({
              [eoaAccount.addr]: [pendingAccountOp, submittedAccountOp]
            })
          },
          onPartialBroadcast: async () => {}
        })
        pendingAccountOpsSpy = holdBehind(controller, pendingAccountOp)
        mockRawBroadcast()
        jest
          .spyOn(KeystoreSigner.prototype, 'signRawTransaction')
          .mockResolvedValueOnce('0xsigned')
          .mockRejectedValueOnce(new Error('Card operation cancelled.'))
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)

        await replaceAndBroadcast(controller, broadcastLib.BROADCAST_OPTIONS.bySelf)

        return { controller, submittedAccountOps }
      }

      test('the rest is a normal op held behind the sent part, and does not reuse its nonce', async () => {
        const { controller, submittedAccountOps } = await replaceBatchAndRefuseSecondCall()
        expect(submittedAccountOps).toHaveLength(1)
        expect(submittedAccountOps[0]!.eoaNonce).toBe(5n)

        const notSentCalls = controller.cleanupAfterBroadcast([
          controller.accountOp.calls[0]!.id as string
        ])

        expect(notSentCalls.map((call) => call.id)).toEqual(['call-1', 'call-2'])
        expect(controller.accountOp.calls.map((call) => call.id)).toEqual(['call-1', 'call-2'])
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(controller.earlierPendingAccountOp?.id).toBe(submittedAccountOps[0]!.id)
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        // Several transactions can't be replaced as one
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)
        expect(hasEarlierPendingError(controller)).toBe(true)
      })

      test('in the built-in swap, the retry does not reuse the nonce either', async () => {
        const { controller, submittedAccountOps } = await replaceBatchAndRefuseSecondCall(
          'one-click-swap-and-bridge'
        )

        expect(submittedAccountOps).toHaveLength(0)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
      })
    })

    test('is dropped when the pending op gets confirmed before signing', async () => {
      const findByIdentifiedBy = jest
        .spyOn(ActivityController.prototype, 'findByIdentifiedBy')
        .mockReturnValue(undefined)
      const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
      const { controller } = await initEoa()
      const pendingAccountOp = buildPendingAccountOp()
      const pendingAccountOpsSpy = holdBehind(controller, pendingAccountOp)
      controller.replacePendingAccountOp()
      expect(controller.accountOp.eoaNonce).toBe(5n)

      pendingAccountOpsSpy.mockReturnValue({})
      findByIdentifiedBy.mockReturnValue({ ...pendingAccountOp, status: AccountOpStatus.Success })
      onUpdateSpy.mock.calls
        .filter(([, id]) => typeof id === 'string' && id.startsWith('sign-account-op-speed-up'))
        .forEach(([callback]) => (callback as () => void)())

      expect(controller.accountOp.eoaNonce).toBeUndefined()
      // Null also means it no longer replaces the pending op
      expect(controller.earlierPendingAccountOp).toBeNull()
      expect(hasEarlierPendingError(controller)).toBe(false)
      // Back to the normal fees
      expect(controller.selectedOptionGasPrices).toEqual(gasPrices)
    })

    describe('when the pending op stops being the one it replaces', () => {
      /** Runs the Activity listeners as an update of Activity would, in the order they were added */
      const spyOnActivityUpdates = () => {
        const onUpdateSpy = jest.spyOn(ActivityController.prototype, 'onUpdate')
        const notify = (idPrefix: string) =>
          onUpdateSpy.mock.calls
            .filter(([, id]) => typeof id === 'string' && id.startsWith(idPrefix))
            .forEach(([callback]) => (callback as () => void)())

        return {
          // Finds the earlier pending op again
          notifyEarlierPending: () => notify('sign-account-op-earlier-pending'),
          // Checks whether the replaced op was processed
          notifyReplacedWatchers: () => notify('sign-account-op-speed-up')
        }
      }

      const startReplacing = async (initOptions?: Parameters<typeof initEoa>[0]) => {
        jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
        const activityUpdates = spyOnActivityUpdates()
        const ctrl = await initEoa(initOptions)
        const pendingAccountOp = buildPendingAccountOp()
        const pendingAccountOpsSpy = holdBehind(ctrl.controller, pendingAccountOp)
        ctrl.controller.replacePendingAccountOp()
        expect(ctrl.controller.earlierPendingAccountOp?.isReplacing).toBe(true)

        return { ...ctrl, ...activityUpdates, pendingAccountOp, pendingAccountOpsSpy }
      }

      test('leaves Replace mode when the pending op got stuck and no longer holds the nonce', async () => {
        const { controller, notifyEarlierPending, pendingAccountOpsSpy } = await startReplacing()

        pendingAccountOpsSpy.mockReturnValue({})
        notifyEarlierPending()

        expect(controller.earlierPendingAccountOp).toBeNull()
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(hasEarlierPendingError(controller)).toBe(false)
        // Back to the normal fees
        expect(controller.selectedOptionGasPrices).toEqual(gasPrices)
        // It was not processed, the user has to know why Replace ended on its own
        expect(controller.isReplacedPendingAccountOpProcessed).toBe(false)
      })

      test('leaves Replace mode when the pending op was sped up, so the fee floor is the new one', async () => {
        const { controller, notifyEarlierPending, pendingAccountOp, pendingAccountOpsSpy } =
          await startReplacing()
        const speedUpFees = { gasPrice: 2000n, maxPriorityFeePerGas: 900n }
        const speedUpAccountOp = buildPendingAccountOp({
          id: 'speed-up-op',
          timestamp: Date.now(),
          identifiedBy: { type: 'Transaction', identifier: `0x${'ef'.repeat(32)}` },
          gasFeePayment: { ...pendingAccountOp.gasFeePayment!, ...speedUpFees }
        })

        // Same payer and nonce, so Activity lists only the newer op
        pendingAccountOpsSpy.mockReturnValue({
          [eoaAccount.addr]: [pendingAccountOp, speedUpAccountOp]
        })
        notifyEarlierPending()

        expect(controller.earlierPendingAccountOp?.id).toBe('speed-up-op')
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(hasEarlierPendingError(controller)).toBe(true)
        expect(controller.selectedOptionGasPrices).toEqual(gasPrices)
      })

      test('leaves Replace mode when another pending op takes a nonce after the replaced one', async () => {
        const { controller, notifyEarlierPending, pendingAccountOp, pendingAccountOpsSpy } =
          await startReplacing({ callsCount: 2 })
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)

        pendingAccountOpsSpy.mockReturnValue({
          [eoaAccount.addr]: [
            pendingAccountOp,
            buildPendingAccountOp({ id: 'next-op', eoaNonce: 6n, timestamp: Date.now() })
          ]
        })
        notifyEarlierPending()

        expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
      })

      test('stays in Replace mode while no fee options are known', async () => {
        const { controller, notifyEarlierPending } = await startReplacing()

        controller.estimation.availableFeeOptions = []
        notifyEarlierPending()
        controller.update({ hasNewEstimation: true })

        // No replacement can be built without fee options, but Don't replace stays
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(controller.accountOp.eoaNonce).toBe(5n)
      })

      test('does not leave while signing, and does once back to ReadyToSign', async () => {
        const { controller, notifyEarlierPending, pendingAccountOpsSpy } = await startReplacing()
        controller.status = { type: SigningStatus.InProgress }

        pendingAccountOpsSpy.mockReturnValue({})
        notifyEarlierPending()

        expect(controller.accountOp.eoaNonce).toBe(5n)
        expect(controller.earlierPendingAccountOp).toBeNull()

        controller.updateStatus(SigningStatus.ReadyToSign)

        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(controller.selectedOptionGasPrices).toEqual(gasPrices)
      })

      test('leaves Replace mode once the first-time delegation turns the fee option into one that is not replaceable', async () => {
        const { controller } = await startReplacing({
          callsCount: 2,
          featureFlags: { eip7702: true }
        })

        expect(controller.accountOp.gasFeePayment?.broadcastOption).toBe(
          broadcastLib.BROADCAST_OPTIONS.delegation
        )
        // The delegation takes the nonce after the pending op, which another op holds
        holdBehind(
          controller,
          buildPendingAccountOp(),
          buildPendingAccountOp({ id: 'next-op', eoaNonce: 6n, timestamp: Date.now() })
        )

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(hasEarlierPendingError(controller)).toBe(true)
      })

      describe('when the pending op gets processed', () => {
        const processPendingAccountOp = (
          ctrl: Awaited<ReturnType<typeof startReplacing>>,
          status = AccountOpStatus.Success
        ) => {
          ctrl.pendingAccountOpsSpy.mockReturnValue({})
          ;(ActivityController.prototype.findByIdentifiedBy as jest.Mock).mockReturnValue({
            ...ctrl.pendingAccountOp,
            status
          })
        }

        test('says so, and stops saying so when Replace starts again', async () => {
          const ctrl = await startReplacing()
          const { controller } = ctrl
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(false)

          processPendingAccountOp(ctrl)
          // The earlier pending op is dropped first, but it is the processed op that ends Replace
          ctrl.notifyEarlierPending()
          ctrl.notifyReplacedWatchers()

          expect(controller.accountOp.eoaNonce).toBeUndefined()
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(true)
          expect(controller.toJSON().isReplacedPendingAccountOpProcessed).toBe(true)

          // A new pending op holds this op again, and Replace can be used for it
          ;(ActivityController.prototype.findByIdentifiedBy as jest.Mock).mockReturnValue(undefined)
          holdBehind(controller, buildPendingAccountOp({ id: 'newer-pending-op' }))
          controller.replacePendingAccountOp()

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(false)
        })

        test('waits while the warning modal pauses the updates, and leaves when it is cancelled', async () => {
          const ctrl = await startReplacing()
          const { controller } = ctrl
          controller.updateStatus(SigningStatus.UpdatesPaused)

          processPendingAccountOp(ctrl)
          ctrl.notifyReplacedWatchers()

          expect(controller.accountOp.eoaNonce).toBe(5n)
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(false)

          // Cancel in the modal
          controller.updateStatus(SigningStatus.ReadyToSign)

          expect(controller.accountOp.eoaNonce).toBeUndefined()
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(true)
        })

        test('is checked once the signing ends, when the modal was accepted', async () => {
          const ctrl = await startReplacing()
          const { controller } = ctrl
          controller.updateStatus(SigningStatus.UpdatesPaused)
          processPendingAccountOp(ctrl)
          ctrl.notifyReplacedWatchers()
          expect(controller.accountOp.eoaNonce).toBe(5n)

          // Proceed in the modal starts signing, which fails as the nonce is taken
          controller.status = { type: SigningStatus.InProgress }
          controller.cancelSignReq()

          expect(controller.accountOp.eoaNonce).toBeUndefined()
          expect(controller.isReplacedPendingAccountOpProcessed).toBe(true)
        })
      })
    })

    describe('when the fee option of the pending op disappears', () => {
      const startReplacing = async () => {
        const ctrl = await initEoa()
        holdBehind(ctrl.controller, buildPendingAccountOp())
        ctrl.controller.replacePendingAccountOp()
        expect(ctrl.controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        return ctrl
      }

      test('goes back to a normal op that the pending op blocks, and picks another payer', async () => {
        const { controller } = await startReplacing()

        controller.estimation.availableFeeOptions = [nativeFeeOption(smartAccount.addr)]
        controller.update({ hasNewEstimation: true })

        expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(hasEarlierPendingError(controller)).toBe(true)
        expect(controller.accountOp.gasFeePayment?.paidBy).toBe(smartAccount.addr)
      })

      test('stays in Replace mode while the options are empty, e.g. during a reload', async () => {
        const { controller } = await startReplacing()

        controller.estimation.availableFeeOptions = []
        controller.update({ hasNewEstimation: true })

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(controller.accountOp.eoaNonce).toBe(5n)
        // So Don't replace stays
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)
      })
    })

    test('keeps the payer of the pending op when another one is picked', async () => {
      const { controller } = await initEoa()
      holdBehind(controller, buildPendingAccountOp())
      controller.replacePendingAccountOp()
      const otherOption = nativeFeeOption(smartAccount.addr)
      controller.estimation.availableFeeOptions = [
        ...controller.estimation.availableFeeOptions,
        otherOption
      ]

      // The options are kept while the estimation reloads, but the paid way is not restored then
      controller.estimation.status = EstimationStatus.Loading

      controller.update({ feeToken: otherOption.token, paidBy: otherOption.paidBy })

      expect(controller.accountOp.gasFeePayment?.paidBy).toBe(eoaAccount.addr)
      expect(controller.selectedOption?.paidBy).toBe(eoaAccount.addr)
    })

    describe('stopReplacingPendingAccountOp', () => {
      test('goes back to a normal op that the pending op blocks', async () => {
        const { controller } = await initEoa()
        holdBehind(controller, buildPendingAccountOp())
        controller.replacePendingAccountOp()
        expect(hasEarlierPendingError(controller)).toBe(false)

        controller.stopReplacingPendingAccountOp()

        expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(hasEarlierPendingError(controller)).toBe(true)
        expect(controller.selectedOptionGasPrices).toEqual(gasPrices)
      })

      test('can replace again afterwards', async () => {
        const { controller } = await initEoa()
        holdBehind(controller, buildPendingAccountOp())
        controller.replacePendingAccountOp()
        controller.stopReplacingPendingAccountOp()

        controller.replacePendingAccountOp()

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(controller.accountOp.eoaNonce).toBe(5n)
      })

      test('does nothing while signing', async () => {
        const { controller } = await initEoa()
        holdBehind(controller, buildPendingAccountOp())
        controller.replacePendingAccountOp()
        controller.status = { type: SigningStatus.InProgress }

        controller.stopReplacingPendingAccountOp()

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(controller.accountOp.eoaNonce).toBe(5n)
      })

      test('does not stop a speed up', async () => {
        jest.spyOn(ActivityController.prototype, 'findByIdentifiedBy').mockReturnValue(undefined)
        const { controller } = await initEoa({ isSpeedUp: true })

        controller.stopReplacingPendingAccountOp()

        expect(controller.isSpeedUpTransaction).toBe(true)
      })
    })

    test.each<
      [string, Partial<SubmittedAccountOp> & { paidBy?: string; broadcastOption?: string }]
    >([
      [
        'sent through a bundler',
        {
          broadcastOption: broadcastLib.BROADCAST_OPTIONS.byBundler,
          // Only the 7702 authorization takes a nonce of the EOA, so it holds this op back
          asUserOperation: {
            eip7702Auth: { nonce: '0x5' }
          } as unknown as SubmittedAccountOp['asUserOperation']
        }
      ],
      [
        'sent as several transactions',
        { identifiedBy: { type: 'MultipleTxns', identifier: '0x01-0x02' } }
      ],
      ['paid by an account this op can not be paid by', { paidBy: smartAccount.addr }]
    ])('is not offered for a pending op %s', async (_, overrides) => {
      const { controller } = await initEoa()

      holdBehind(controller, buildPendingAccountOp(overrides))
      controller.replacePendingAccountOp()

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)
      expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
      expect(hasEarlierPendingError(controller)).toBe(true)
    })
  })

  describe('a Safe', () => {
    const owners = [eoaSigner.keyPublicAddress, safeAccount.associatedKeys[0]!]
    const buildPendingSafeAccountOp = (nonce: bigint) =>
      buildPendingAccountOp({
        accountAddr: safeAccount.addr,
        paidBy: safeAccount.addr,
        broadcastOption: broadcastLib.BROADCAST_OPTIONS.byBundler,
        nonce,
        eoaNonce: null
      })

    /**
     * A Safe op at `nonce` that `threshold` owners must sign, `signed` of them already did. Its
     * fee is paid by `paidBy`, the Safe itself by default
     */
    const initSafe = async ({
      threshold,
      signed,
      nonce = 3n,
      paidBy = safeAccount.addr
    }: {
      threshold: number
      signed: string[]
      nonce?: bigint
      paidBy?: string
    }) => {
      const feePaymentOptions = [nativeFeeOption(paidBy)]
      const accountOp = createAccountOp(safeAccount, chainId)
      accountOp.op.nonce = nonce
      accountOp.op.signed = signed
      jest.spyOn(EstimationController.prototype, 'estimate').mockResolvedValue(undefined)

      const ctrl = await init(
        safeAccount,
        accountOp,
        eoaSigner,
        {
          providerEstimation: { gasUsed: 25000n, feePaymentOptions },
          ambireEstimation: {
            deploymentGas: 0n,
            gasUsed: 25000n,
            feePaymentOptions,
            // A Safe is estimated with a state override, which returns the op's own nonce
            ambireAccountNonce: Number(nonce),
            flags: {}
          },
          flags: {},
          updatedAt: Date.now()
        },
        gasPrices,
        false,
        {
          // The paying EOA is an account of the wallet too
          initialSetStorage: (storageCtrl) => storageCtrl.set('accounts', [safeAccount, eoaAccount])
        }
      )
      // On Ethereum the state is read at the pending block, so it can count the pending op
      const accountState = ctrl.accountsCtrl.accountStates[safeAccount.addr]![chainId.toString()]!
      accountState.nonce = 3n
      accountState.threshold = threshold
      accountState.safeVersion = '1.4.1'
      accountState.isDeployed = true
      accountState.associatedKeys = owners
      // Only the first owner's key is in this wallet
      accountState.importedAccountKeys = [
        { addr: eoaSigner.keyPublicAddress, type: 'internal', label: 'Key 1' } as any
      ]
      ctrl.controller.update({ hasNewEstimation: true })
      return ctrl
    }

    test('signed by every owner, it cannot execute while a lower Safe nonce is pending', async () => {
      const { controller } = await initSafe({ threshold: 2, signed: owners })
      expect(controller.canBroadcast).toBe(true)

      holdBehind(controller, buildPendingSafeAccountOp(2n))

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(controller.canBroadcast).toBe(false)
      expect(hasEarlierPendingError(controller)).toBe(true)
      // Sent through a bundler, which holds the transaction, so it can't be replaced
      expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)
    })

    test('the owners can still sign behind a pending transaction', async () => {
      const { controller } = await initSafe({ threshold: 2, signed: [] })

      holdBehind(controller, buildPendingSafeAccountOp(2n))

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(controller.canBroadcast).toBe(false)
      expect(controller.errors).toEqual([])
      expect(controller.readyToSign).toBe(true)
    })

    describe('paid by the EOA that sent the pending Safe transaction', () => {
      const payerAddr = eoaSigner.keyPublicAddress
      // The pending Safe transaction took Safe nonce 3 and the payer's EOA nonce 5
      const buildPendingSentByEoa = () =>
        buildPendingAccountOp({
          accountAddr: safeAccount.addr,
          paidBy: payerAddr,
          broadcastOption: broadcastLib.BROADCAST_OPTIONS.byOtherEOA,
          nonce: 3n,
          eoaNonce: 5n
        })

      test('not signed yet, Replace takes the pending Safe nonce', async () => {
        const { controller } = await initSafe({
          threshold: 2,
          signed: [],
          nonce: 4n,
          paidBy: payerAddr
        })
        holdBehind(controller, buildPendingSentByEoa())
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)

        controller.replacePendingAccountOp()

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
        expect(controller.accountOp.nonce).toBe(3n)
        expect(controller.accountOp.eoaNonce).toBe(5n)
      })

      test('a 1/1 Safe with its only key here executes a Replace right after signing', async () => {
        const { controller } = await initSafe({
          threshold: 1,
          signed: [],
          nonce: 4n,
          paidBy: payerAddr
        })
        controller.update({ signingKeyAddr: payerAddr, signingKeyType: 'internal' })
        holdBehind(controller, buildPendingSentByEoa())
        controller.replacePendingAccountOp()
        // A new transaction would take Safe nonce 4, after the pending one
        jest.spyOn(ActivityController.prototype, 'getNextNonce').mockReturnValue(4n)
        const propose = jest.spyOn(safeLib, 'propose').mockResolvedValue(undefined)

        await controller.sign()

        expect(controller.accountOp.nonce).toBe(3n)
        expect(controller.accountOp.signed).toEqual([payerAddr])
        expect(propose).not.toHaveBeenCalled()
        expect(controller.status?.type).toBe(SigningStatus.Done)
      })

      describe('picking the Safe nonce', () => {
        const initHeldBack = async () => {
          const ctrl = await initSafe({ threshold: 2, signed: [], nonce: 4n, paidBy: payerAddr })
          holdBehind(ctrl.controller, buildPendingSentByEoa())
          expect(ctrl.controller.earlierPendingAccountOp?.canReplace).toBe(true)
          return ctrl
        }

        test('the pending Safe nonce replaces the pending transaction, as Replace pending does', async () => {
          const { controller } = await initHeldBack()

          controller.setSafeNonce(3n)

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
          expect(controller.accountOp.nonce).toBe(3n)
          expect(controller.accountOp.eoaNonce).toBe(5n)
        })

        test('a later Safe nonce stops replacing, keeping the picked nonce', async () => {
          const { controller } = await initHeldBack()
          controller.replacePendingAccountOp()

          controller.setSafeNonce(6n)

          expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
          expect(controller.accountOp.nonce).toBe(6n)
          expect(controller.accountOp.eoaNonce).toBeUndefined()
        })

        test('a later Safe nonce is kept as a later transaction, without replacing', async () => {
          const { controller } = await initHeldBack()

          controller.setSafeNonce(6n)

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
          expect(controller.accountOp.nonce).toBe(6n)
          expect(controller.accountOp.eoaNonce).toBeUndefined()
        })

        test('Replace pending takes the pending Safe nonce over a picked one', async () => {
          const { controller } = await initHeldBack()
          controller.setSafeNonce(6n)

          controller.replacePendingAccountOp()

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
          expect(controller.accountOp.nonce).toBe(3n)
          expect(controller.accountOp.eoaNonce).toBe(5n)
        })

        test("Replace, a later Safe nonce, Replace again and Don't replace, one after another", async () => {
          const { controller } = await initHeldBack()
          controller.replacePendingAccountOp()
          controller.setSafeNonce(6n)
          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)

          controller.replacePendingAccountOp()

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
          expect(controller.accountOp.nonce).toBe(3n)
          // A new transaction takes Safe nonce 4, after the pending one
          jest.spyOn(ActivityController.prototype, 'getNextNonce').mockReturnValue(4n)

          controller.stopReplacingPendingAccountOp()

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
          expect(controller.accountOp.nonce).toBe(4n)
        })

        test("picking the pending Safe nonce again after Don't replace replaces it again", async () => {
          const { controller } = await initHeldBack()
          controller.replacePendingAccountOp()
          controller.stopReplacingPendingAccountOp()
          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)

          controller.setSafeNonce(3n)

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(true)
          expect(controller.accountOp.nonce).toBe(3n)
        })

        test('the Safe nonce of a pending transaction it cannot replace is only set', async () => {
          const { controller } = await initSafe({ threshold: 2, signed: [], nonce: 4n })
          // Sent through a bundler, which holds the transaction
          holdBehind(controller, buildPendingSafeAccountOp(3n))
          expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)

          controller.setSafeNonce(3n)

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
          expect(controller.accountOp.nonce).toBe(3n)
          expect(controller.accountOp.eoaNonce).toBeUndefined()
        })

        test('signed by an owner, the pending Safe nonce neither replaces nor changes the nonce', async () => {
          const { controller } = await initSafe({
            threshold: 2,
            signed: [owners[0]!],
            nonce: 4n,
            paidBy: payerAddr
          })
          holdBehind(controller, buildPendingSentByEoa())

          controller.setSafeNonce(3n)

          expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
          expect(controller.accountOp.nonce).toBe(4n)
          expect(controller.accountOp.eoaNonce).toBeUndefined()
        })
      })

      test("Don't replace takes the Safe nonce of a new transaction, after the pending one", async () => {
        const { controller } = await initSafe({ threshold: 2, signed: [], paidBy: payerAddr })
        holdBehind(controller, buildPendingSentByEoa())
        controller.replacePendingAccountOp()
        expect(controller.accountOp.nonce).toBe(3n)
        const getNextNonce = jest
          .spyOn(ActivityController.prototype, 'getNextNonce')
          .mockReturnValue(4n)

        controller.stopReplacingPendingAccountOp()

        expect(getNextNonce).toHaveBeenCalledWith(safeAccount.addr, chainId, 'account', 3n)
        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.nonce).toBe(4n)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
      })

      test('when Replace ends on its own, it moves past the Safe nonce of the replaced transaction', async () => {
        const { controller } = await initSafe({ threshold: 2, signed: [], paidBy: payerAddr })
        const pendingAccountOpsSpy = holdBehind(controller, buildPendingSentByEoa())
        controller.replacePendingAccountOp()
        expect(controller.accountOp.nonce).toBe(3n)
        // Confirmed, so Activity counts its Safe nonce while the chain may not yet
        jest.spyOn(ActivityController.prototype, 'getNextNonce').mockReturnValue(4n)

        pendingAccountOpsSpy.mockReturnValue({})
        controller.update({ hasNewEstimation: true })

        expect(controller.earlierPendingAccountOp).toBeNull()
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(controller.accountOp.nonce).toBe(4n)
      })

      test('signed by an owner, it is not offered to replace, as the signature is for its Safe nonce', async () => {
        const { controller } = await initSafe({
          threshold: 2,
          signed: [owners[0]!],
          nonce: 4n,
          paidBy: payerAddr
        })
        holdBehind(controller, buildPendingSentByEoa())

        expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
        expect(controller.earlierPendingAccountOp?.canReplace).toBe(false)

        controller.replacePendingAccountOp()

        expect(controller.earlierPendingAccountOp?.isReplacing).toBe(false)
        expect(controller.accountOp.eoaNonce).toBeUndefined()
        expect(controller.accountOp.nonce).toBe(4n)
        expect(controller.accountOp.signed).toEqual([owners[0]])
      })
    })
  })

  describe('a smart account paid by an EOA', () => {
    const initPaidByEoa = async () => {
      const feePaymentOptions = [nativeFeeOption(eoaSigner.keyPublicAddress)]
      const accountOp = createAccountOp(smartAccount, chainId)
      accountOp.op.signingKeyAddr = eoaSigner.keyPublicAddress
      accountOp.op.signingKeyType = 'internal'
      jest.spyOn(EstimationController.prototype, 'estimate').mockResolvedValue(undefined)

      return init(
        smartAccount,
        accountOp,
        eoaSigner,
        {
          providerEstimation: { gasUsed: 25000n, feePaymentOptions },
          ambireEstimation: {
            deploymentGas: 0n,
            gasUsed: 25000n,
            feePaymentOptions,
            ambireAccountNonce: 5,
            flags: {}
          },
          flags: {},
          updatedAt: Date.now()
        },
        gasPrices,
        false,
        {
          // The paying EOA is an account of the wallet too
          initialSetStorage: (storageCtrl) =>
            storageCtrl.set('accounts', [smartAccount, eoaAccount])
        }
      )
    }

    test('is held back while the paying EOA has its own transaction pending', async () => {
      const { controller } = await initPaidByEoa()
      expect(controller.accountOp.gasFeePayment?.broadcastOption).toBe(
        broadcastLib.BROADCAST_OPTIONS.byOtherEOA
      )

      // Stored under the EOA, not the account being signed
      holdBehind(controller, buildPendingAccountOp())

      expect(controller.earlierPendingAccountOp?.id).toBe('pending-op')
      expect(hasEarlierPendingError(controller)).toBe(true)
    })

    test('Replace refuses to send from an account other than the one that paid the pending op', async () => {
      const { controller } = await initPaidByEoa()
      const pendingAccountOp = buildPendingAccountOp({
        accountAddr: smartAccount.addr,
        paidBy: eoaSigner.keyPublicAddress,
        broadcastOption: broadcastLib.BROADCAST_OPTIONS.byOtherEOA,
        nonce: 4n
      })
      holdBehind(controller, pendingAccountOp)
      jest.spyOn(controller.baseAccount, 'getBroadcastNonce').mockResolvedValue(5n)
      jest.spyOn(controller.provider, 'getTransactionCount').mockResolvedValue(6)
      const buildRawTransaction = mockRawBroadcast()
      const broadcastTransaction = jest.spyOn(broadcastLib, 'broadcastTransaction')
      controller.replacePendingAccountOp()
      // Another account pays at broadcast time, as if the payer of the pending op was dropped.
      // Signing keeps the payer, so it is swapped once signed
      const otherPayerAddr = '0x1111111111111111111111111111111111111111'
      const getAccountState = AccountsController.prototype.getOrFetchAccountOnChainState
      jest
        .spyOn(AccountsController.prototype, 'getOrFetchAccountOnChainState')
        .mockImplementation(async function (this: AccountsController, ...args) {
          const { gasFeePayment } = controller.accountOp
          if (gasFeePayment) gasFeePayment.paidBy = otherPayerAddr
          return getAccountState.apply(this, args)
        })

      const throwBroadcastAccountOp = jest.spyOn(controller, 'throwBroadcastAccountOp')

      await controller.signAndBroadcast().catch(() => {})

      expect(throwBroadcastAccountOp.mock.calls[0]?.[0].message).toContain(
        'paid from a different account'
      )
      expect(buildRawTransaction).not.toHaveBeenCalled()
      expect(broadcastTransaction).not.toHaveBeenCalled()
    })

    test('Replace signs with the account nonce of the pending op and its EOA nonce', async () => {
      const { controller } = await initPaidByEoa()
      // The pending op of the same account took account nonce 4 and the payer's nonce 5
      const pendingAccountOp = buildPendingAccountOp({
        accountAddr: smartAccount.addr,
        paidBy: eoaSigner.keyPublicAddress,
        broadcastOption: broadcastLib.BROADCAST_OPTIONS.byOtherEOA,
        nonce: 4n
      })
      holdBehind(controller, pendingAccountOp)
      // The chain already counts it, as the pending block does on Ethereum
      jest.spyOn(controller.baseAccount, 'getBroadcastNonce').mockResolvedValue(5n)
      expect(controller.earlierPendingAccountOp?.canReplace).toBe(true)

      controller.replacePendingAccountOp()
      await controller.sign()

      expect(controller.status?.type).toBe(SigningStatus.Done)
      expect(controller.accountOp.nonce).toBe(4n)
      expect(controller.accountOp.eoaNonce).toBe(5n)
    })
  })
})
