/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { getAddress, Interface, Wallet, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, jest } from '@jest/globals'

import { getNonce } from '../../../test/helpers'
import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BLACKLIST_UPDATE_INTERVAL } from '../../consts/intervals'
import { networks } from '../../consts/networks'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { StoredKey } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { AccountOp, areAccountOpsEqual } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import * as defiPositionsLib from '../../libs/defiPositions/defiPositions'
import * as defiPricesLib from '../../libs/defiPositions/defiPrices'
import { getProviderId } from '../../libs/defiPositions/helpers'
import * as defiProviders from '../../libs/defiPositions/providers'
import { AssetType, DeFiPositionsError } from '../../libs/defiPositions/types'
import {
  erc721CollectionToLearnedAssetKeys,
  learnedErc721sToHints
} from '../../libs/portfolio/helpers'
import {
  CollectionResult,
  Hints,
  LearnedAssets,
  PortfolioGasTankResult,
  PortfolioLibGetResult,
  PortfolioNetworkResult,
  PreviousHintsStorage,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { Portfolio, PORTFOLIO_LIB_ERROR_NAMES } from '../../libs/portfolio/portfolio'
import { getRpcProvider } from '../../services/provider'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { StorageController } from '../storage/storage'
import { COLIBRI_CATCH_UP_RETRY_INTERVAL } from '../verification/verification'
import { PortfolioController } from './portfolio'

import type { FeatureFlags } from '../../consts/featureFlags'

const EMPTY_ACCOUNT_ADDR = '0xA098B9BccaDd9BAEc311c07433e94C9d260CbC07'

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.chainId.toString()] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.chainId.toString()]!.isWorking = true
})

const ethereum = networks.find((network) => network.chainId === 1n)!
const gnosis: Network = {
  ...ethereum,
  name: 'Gnosis',
  nativeAssetSymbol: 'xDAI',
  nativeAssetName: 'xDAI',
  rpcUrls: ['https://invictus.ambire.com/gnosis'],
  selectedRpcUrl: 'https://invictus.ambire.com/gnosis',
  rpcNoStateOverride: true,
  chainId: 100n,
  explorerUrl: 'https://gnosisscan.io',
  platformId: 'xdai',
  nativeAssetId: 'xdai',
  feeOptions: { is1559: false, feeIncrease: 100n },
  wrappedAddr: '0x6A023ccd1ff6f2045C3309768eAd9E68F978f6e1'
}

const getAccountOnchainState = (
  stateAccount: Account,
  overrides?: Partial<AccountOnchainState>
): AccountOnchainState => ({
  accountAddr: stateAccount.addr,
  isDeployed: true,
  eoaNonce: null,
  nonce: 0n,
  erc4337Nonce: 0n,
  associatedKeys: stateAccount.associatedKeys,
  importedAccountKeys: [],
  balance: 0n,
  isEOA: false,
  isErc4337Enabled: false,
  isErc4337Nonce: false,
  isV2: false,
  currentBlock: 0n,
  isSmarterEoa: false,
  delegatedContract: null,
  delegatedContractName: null,
  threshold: 1,
  updatedAt: 0,
  ...overrides
})

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) =>
      getAccountState(providers[network.chainId.toString()]!, network, accounts, [])
    )
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: Network, netIndex: number) => {
          return [network.chainId, result[netIndex]![accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

const account = {
  addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  initialPrivileges: [],
  associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  }
}

const account2 = {
  addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
  associatedKeys: ['0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'],
  initialPrivileges: [],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
  }
}

const account3: Account = {
  addr: '0x018D034c782db8462d864996dE3c297bcf66f86A',
  initialPrivileges: [
    [
      '0xdD6487aa74f0158733e8a36E466A98f4aEE9c179',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  associatedKeys: ['0xdD6487aa74f0158733e8a36E466A98f4aEE9c179'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f9405c22160986551985df269a2a18b4e60aa0a1347bd75cbcea777ea18692b1c553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x018D034c782db8462d864996dE3c297bcf66f86A'
  }
}

const account4: Account = {
  addr: '0x3e2D734349654166a2Ad92CaB2437A76a70B650a',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb'],
  creation: {
    factoryAddr: '0x26cE6745A633030A6faC5e64e41D21fb6246dc2d',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d730f2aa7bcda3d9d210df69a394b6965cb2566c8285af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x3e2D734349654166a2Ad92CaB2437A76a70B650a'
  }
}

const emptyAccount = {
  addr: EMPTY_ACCOUNT_ADDR,
  initialPrivileges: [],
  associatedKeys: [],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: EMPTY_ACCOUNT_ADDR
  }
}

const ambireV2Account: Account = {
  addr: '0xf2d83373bE7dE6dEB14745F6512Df1306b6175EA',
  initialPrivileges: [
    [
      '0xF5102a9bd0Ca021D3cF262BeF81c25F704AF1615',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  associatedKeys: ['0xF5102a9bd0Ca021D3cF262BeF81c25F704AF1615'],
  creation: {
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f04f3c84c7bf7b333aca32e4d61247cc315ac4a0e396a5fc174276184ae537f84553d602d80604d3d3981f3363d3d373d3d3d363d730f2aa7bcda3d9d210df69a394b6965cb2566c8285af43d82803e903d91602b57fd5bf3',
    factoryAddr: '0x26cE6745A633030A6faC5e64e41D21fb6246dc2d',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  preferences: {
    label: 'Smart Account v2',
    pfp: '0xf2d83373bE7dE6dEB14745F6512Df1306b6175EA'
  }
}

const accountWithManyAssets = {
  addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  initialPrivileges: [],
  associatedKeys: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  creation: null,
  preferences: {
    label: 'Vitalik',
    pfp: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  }
}

// If the account ever has to be replaced:
// 1. Go to https://debank.com/protocols
// 2. Find an Account that has both Aave v3 and Uniswap v3 positions on mainnet
// 3. Replace the address below with that account's address
// 4. Update the static MOCK_DEBANK_RESPONSE_DATA below with a fresh call to cena
const DEFI_TEST_ACCOUNT = {
  addr: '0x741aa7cfb2c7bf2a1e7d4da2e3df6a56ca4131f3',
  initialPrivileges: [],
  associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: 'Test account',
    pfp: '0x741aa7cfb2c7bf2a1e7d4da2e3df6a56ca4131f3'
  }
}

const generateRandomAddresses = (count: number): string[] => {
  const addresses = []

  for (let i = 0; i < count; i++) {
    const wallet = Wallet.createRandom()
    addresses.push(wallet.address)
  }

  return addresses
}

const getMultipleAccountsLearnedAssets = () => {
  const tokenHints1 = generateRandomAddresses(20)
  const tokenHints2 = generateRandomAddresses(10)

  const turnHintsToLearnedAssets = (hints: string[]) => {
    return hints.reduce(
      (acc, addr) => {
        acc[addr] = Date.now()

        return acc
      },
      {} as LearnedAssets['erc20s'][string]
    )
  }

  const turnCollectionsToLearnedAssetKeys = (
    collections: [string, bigint[]][]
  ): LearnedAssets['erc721s'][string] => {
    return collections.reduce(
      (acc, nft) => {
        erc721CollectionToLearnedAssetKeys(nft).forEach((key) => {
          acc[key] = Date.now()
        })

        return acc
      },
      {} as LearnedAssets['erc721s'][string]
    )
  }

  return {
    erc20s: {
      [`${1}:${account.addr}`]: turnHintsToLearnedAssets(tokenHints1),
      [`${1}:${account2.addr}`]: turnHintsToLearnedAssets(tokenHints2)
    },
    erc721s: {
      [`${1}:${account.addr}`]: turnCollectionsToLearnedAssetKeys([
        [tokenHints1[0]!, [1n, 2n, 3n]],
        [tokenHints1[1]!, [4n, 5n, 6n]],
        [tokenHints1[2]!, [7n, 8n, 9n]]
      ]),
      [`${1}:${account2.addr}`]: turnCollectionsToLearnedAssetKeys([
        // Collision with account 1 (on purpose)
        [tokenHints1[0]!, [10n, 11n, 12n]],
        [tokenHints2[5]!, [13n, 14n, 15n]]
      ])
    }
  }
}

const getKeystoreKeys = (): StoredKey[] => {
  return [
    {
      privKey: '0',
      dedicatedToOneSA: false,
      addr: account.associatedKeys[0]!,
      type: 'internal',
      label: 'key 1',
      meta: {} as any
    },
    {
      privKey: '0',
      dedicatedToOneSA: false,
      addr: account2.associatedKeys[0]!,
      type: 'internal',
      label: 'key 2',
      meta: {} as any
    }
  ]
}

const prepareTest = async (opts?: {
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
  fetchOverride?: typeof fetch
  skipBlacklistFetch?: boolean
  awaitInitialLoad?: boolean
  skipAccountStateFetch?: boolean
  featureFlags?: Partial<FeatureFlags>
}) => {
  const {
    initialSetStorage,
    awaitInitialLoad = true,
    fetchOverride,
    featureFlags,
    skipBlacklistFetch = true,
    skipAccountStateFetch = true
  } = opts || {}

  const { mainCtrl } = await makeMainController(
    async (storageCtrl) => {
      await storageCtrl.set('accounts', [
        account,
        account2,
        account3,
        account4,
        emptyAccount,
        ambireV2Account,
        accountWithManyAssets,
        DEFI_TEST_ACCOUNT
      ])
      await storageCtrl.set('learnedAssets', {
        erc20s: {},
        erc721s: {
          '1:0xB674F3fd5F43464dB0448a57529eAF37F04cceA5': {
            '0x932261f9Fc8DA46C4a22e31B45c4De60623848bF:39118': Date.now(),
            '0xcF30DEf37DcB65d244F14E075Dc0ce875ccFa065:2442': Date.now()
          }
        }
      })
      if (initialSetStorage) await initialSetStorage(storageCtrl)
    },
    {
      awaitInitialLoad: awaitInitialLoad,
      skipPortfolioFetchBlacklistOnLoad: skipBlacklistFetch,
      skipAccountStateLoad: skipAccountStateFetch,
      overrides: {
        fetch: fetchOverride,
        featureFlags
      }
    }
  )

  await mainCtrl.accounts.initialLoadPromise
  await mainCtrl.providers.initialLoadPromise
  await mainCtrl.networks.initialLoadPromise
  await mainCtrl.portfolio.initialLoadPromise

  return {
    controller: mainCtrl.portfolio as PortfolioController,
    storageCtrl: mainCtrl.storage,
    networksCtrl: mainCtrl.networks,
    accountsCtrl: mainCtrl.accounts,
    providersCtrl: mainCtrl.providers,
    verificationCtrl: mainCtrl.verification
  }
}

// @TODO: Divide into multiple files (.blacklisting, .hints, .simulation, .tokens, .defiPositions, etc.)
describe('Portfolio Controller ', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })
  async function getAccountOp(
    collectibleAddress: string = '0xcf30def37dcb65d244f14e075dc0ce875ccfa065',
    tokenId: number = 2442,
    network: Network = ethereum
  ) {
    const ABI = ['function transferFrom(address from, address to, uint256 tokenId)']
    const iface = new Interface(ABI)
    const data = iface.encodeFunctionData('transferFrom', [
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      tokenId
    ])

    const nonce = await getNonce(
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      providers[network.chainId.toString()]!
    )
    const calls = [{ to: collectibleAddress, value: BigInt(0), data }]

    const op = {
      id: generateUuid(),
      accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
      gasLimit: null,
      gasFeePayment: null,
      signingKeyType: 'internal',
      chainId: network.chainId,
      nonce,
      signature: '0x',
      calls
    } as AccountOp

    return {
      [network.chainId.toString()]: [op]
    } as Record<string, AccountOp[]>
  }

  test('Colibri portfolio verification warns on changed balances, stale RPCs and succeeds on matching balances', async () => {
    // The Colibri head. Its relation to the RPC result block decides whether a
    // fresh, comparable verification is possible (see VerificationController).
    const verifiedProvider = {
      destroyed: false,
      getBlockNumber: jest.fn<() => Promise<number>>().mockResolvedValue(122)
    } as any
    const colibriEthereum = { ...ethereum, isColibriEnabled: true }
    const tokenAddress = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    const rpcAmount = 100n
    let verifiedAmount = 99n
    // The block the RPC balances were fetched at. Colibri verifies at this exact block.
    let rpcResultBlockNumber = 122
    const makeToken = (amount: bigint, chainId: bigint): TokenResult => ({
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: tokenAddress,
      chainId,
      amount,
      priceIn: [{ baseCurrency: 'usd', price: 1 }],
      marketDataIn: [],
      flags: {
        onGasTank: false,
        rewardsType: null,
        canTopUpGasTank: false,
        isFeeToken: false
      }
    })
    const makePortfolioLibResult = (
      amount: bigint,
      blockNumber: number,
      chainId: bigint
    ): PortfolioLibGetResult => ({
      updateStarted: Date.now(),
      discoveryTime: 0,
      oracleCallTime: 0,
      priceUpdateTime: 0,
      tokenDataCache: new Map(),
      tokens: [makeToken(amount, chainId)],
      feeTokens: [],
      toBeLearned: { erc20s: [], erc721s: {} },
      tokenErrors: [],
      collectionErrors: [],
      collections: [],
      errors: [],
      blockNumber,
      beforeNonce: 0n,
      afterNonce: 0n
    })
    const createRelayerResponse = (body: unknown) =>
      ({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body))
      }) as any
    const fetchOverride = jest.fn(() =>
      Promise.resolve(
        createRelayerResponse({
          success: true,
          data: {
            banner: null,
            rewards: {
              stkWalletClaimableBalance: [],
              walletClaimableBalance: []
            },
            rewardsProjectionDataV2: {},
            frozenRewardSeason1: 0,
            gasTank: {
              balance: []
            }
          }
        })
      )
    ) as unknown as typeof fetch
    const { controller, providersCtrl, verificationCtrl } = await prepareTest({
      fetchOverride,
      featureFlags: { tokenAndDefiAutoDiscovery: false }
    })

    jest.spyOn(verificationCtrl, 'getReadyProvider').mockReturnValue(verifiedProvider)
    const verifyPortfolioSpy = jest.spyOn(verificationCtrl, 'verifyPortfolio')
    jest.spyOn(controller as any, 'batchedPortfolioDiscovery').mockResolvedValue({
      data: { hints: null, defi: null, otherNetworksDefiCounts: {} },
      discoveryTime: 0,
      errors: []
    })
    jest
      .spyOn(defiPositionsLib, 'getCustomProviderPositions')
      .mockResolvedValue({ positionsByProvider: [], error: null, providerErrors: [] } as any)
    const portfolioGetCalls: { isColibri: boolean; blockTag: unknown }[] = []
    jest.spyOn(Portfolio.prototype, 'get').mockImplementation(function (this: Portfolio, _, opts) {
      const isColibri = this.provider === verifiedProvider
      const chainId = this.network.chainId
      portfolioGetCalls.push({ isColibri, blockTag: opts?.blockTag })

      return Promise.resolve(
        isColibri
          ? makePortfolioLibResult(verifiedAmount, rpcResultBlockNumber, chainId)
          : makePortfolioLibResult(rpcAmount, rpcResultBlockNumber, chainId)
      )
    })

    // Verification is fire-and-forget, so it resolves after updateSelectedAccount returns.
    const waitForVerification = async (chainId = '1') => {
      for (let i = 0; i < 50; i += 1) {
        const current = controller.getAccountPortfolioState(account.addr)[chainId]?.verification
        if (current && current.status !== 'loading') return current

        await wait(10)
      }

      return controller.getAccountPortfolioState(account.addr)[chainId]?.verification
    }

    // 1) Balances differ between RPC and Colibri at the same block -> warning.
    await controller.updateSelectedAccount(account.addr, [colibriEthereum])
    const warningVerification = await waitForVerification()

    // The RPC fetch is a plain 'both'; Colibri re-fetches at the RPC result's block.
    expect(portfolioGetCalls).toEqual(
      expect.arrayContaining([
        { isColibri: false, blockTag: 'both' },
        { isColibri: true, blockTag: 122 }
      ])
    )
    expect(warningVerification?.status).toBe('warning')
    expect(warningVerification?.error).toBe(
      '1 balance(s) differed from the Colibri verified result'
    )

    // 2) Matching balances -> success.
    verifiedAmount = rpcAmount
    portfolioGetCalls.length = 0
    await controller.updateSelectedAccount(account.addr, [colibriEthereum])
    const successfulVerification = await waitForVerification()

    expect(successfulVerification?.status).toBe('success')
    expect(successfulVerification?.error).toBeUndefined()

    // 3) If Colibri is slightly behind, wait for it to catch up and verify the RPC block.
    verifiedProvider.getBlockNumber.mockReset()
    verifiedProvider.getBlockNumber.mockResolvedValueOnce(121).mockResolvedValueOnce(122)
    rpcResultBlockNumber = 122
    verifiedAmount = rpcAmount
    portfolioGetCalls.length = 0
    jest.useFakeTimers()
    try {
      await controller.updateSelectedAccount(account.addr, [colibriEthereum])

      await jest.advanceTimersByTimeAsync(COLIBRI_CATCH_UP_RETRY_INTERVAL)
      await Promise.resolve()

      const catchUpVerification =
        controller.getAccountPortfolioState(account.addr)['1']?.verification
      expect(catchUpVerification?.status).toBe('success')
      expect(catchUpVerification?.error).toBeUndefined()
      expect(verifiedProvider.getBlockNumber).toHaveBeenCalledTimes(2)
      expect(portfolioGetCalls).toEqual(
        expect.arrayContaining([
          { isColibri: false, blockTag: 'both' },
          { isColibri: true, blockTag: 122 }
        ])
      )
    } finally {
      jest.useRealTimers()
    }

    // 4) Colibri is more than the threshold behind the RPC block -> warning, no Colibri fetch.
    rpcResultBlockNumber = 123
    verifiedProvider.getBlockNumber.mockResolvedValue(117)
    portfolioGetCalls.length = 0
    await controller.updateSelectedAccount(account.addr, [colibriEthereum])
    const colibriBehindVerification = await waitForVerification()

    expect(portfolioGetCalls).toEqual([{ isColibri: false, blockTag: 'both' }])
    expect(colibriBehindVerification?.status).toBe('warning')
    expect(colibriBehindVerification?.error).toBe('Colibri is 6 blocks behind the RPC latest block')

    // 5) RPC is more than the threshold behind Colibri -> stale, no Colibri fetch.
    rpcResultBlockNumber = 100
    verifiedProvider.getBlockNumber.mockResolvedValue(111)
    portfolioGetCalls.length = 0
    await controller.updateSelectedAccount(account.addr, [colibriEthereum])
    const staleVerification = await waitForVerification()

    expect(portfolioGetCalls).toEqual([{ isColibri: false, blockTag: 'both' }])
    expect(staleVerification?.status).toBe('stale')
    expect(staleVerification?.blockDiff).toBe(11)

    // 6) Gnosis is also Colibri-supported: changed balances warn.
    const colibriGnosis = { ...gnosis, isColibriEnabled: true }
    await providersCtrl.setProvider(colibriGnosis)
    verifiedProvider.getBlockNumber.mockResolvedValue(222)
    rpcResultBlockNumber = 222
    verifiedAmount = 99n
    portfolioGetCalls.length = 0

    await controller.updateSelectedAccount(account.addr, [colibriGnosis])
    const gnosisWarningVerification = await waitForVerification('100')

    expect(portfolioGetCalls).toEqual(
      expect.arrayContaining([
        { isColibri: false, blockTag: 'both' },
        { isColibri: true, blockTag: 222 }
      ])
    )
    expect(gnosisWarningVerification?.status).toBe('warning')
    expect(gnosisWarningVerification?.error).toBe(
      '1 balance(s) differed from the Colibri verified result'
    )

    // 7) Gnosis matching balances succeed.
    verifiedAmount = rpcAmount
    portfolioGetCalls.length = 0
    await controller.updateSelectedAccount(account.addr, [colibriGnosis])
    const gnosisSuccessfulVerification = await waitForVerification('100')

    expect(gnosisSuccessfulVerification?.status).toBe('success')
    expect(gnosisSuccessfulVerification?.error).toBeUndefined()

    // 8) Simulated portfolio updates must skip Colibri verification.
    const verifyCallsBeforeSimulation = verifyPortfolioSpy.mock.calls.length
    const simulatedAccountOp: AccountOp = {
      id: 'colibri-simulation-skip',
      accountAddr: account.addr,
      signingKeyAddr: account.associatedKeys[0]!,
      signingKeyType: 'internal',
      gasLimit: null,
      gasFeePayment: null,
      chainId: 1n,
      nonce: 0n,
      signature: '0x',
      calls: []
    }
    portfolioGetCalls.length = 0

    await controller.updateSelectedAccount(
      account.addr,
      [colibriEthereum],
      {
        accountOps: { ['1']: [simulatedAccountOp] },
        states: { ['1']: getAccountOnchainState(account) }
      },
      { isManualUpdate: true }
    )

    expect(verifyPortfolioSpy).toHaveBeenCalledTimes(verifyCallsBeforeSimulation)
    expect(controller.getAccountPortfolioState(account.addr)['1']?.verification).toBeUndefined()
    expect(portfolioGetCalls).toEqual([{ isColibri: false, blockTag: 'both' }])

    // 9) Unexpected verifier failures should resolve the pending loading state to a warning.
    verifyPortfolioSpy.mockRejectedValueOnce(new Error('Colibri verification crashed'))
    portfolioGetCalls.length = 0

    await controller.updateSelectedAccount(account.addr, [colibriEthereum])
    const rejectedVerification = await waitForVerification()

    expect(rejectedVerification?.status).toBe('warning')
    expect(rejectedVerification?.error).toBe('Colibri could not verify portfolio balances')
    expect(portfolioGetCalls).toEqual([{ isColibri: false, blockTag: 'both' }])
  })

  test('Account updates (by account and network, updateSelectedAccount()) are queued and executed sequentially to avoid race conditions', async () => {
    const { controller } = await prepareTest()
    const ethereum = networks.find((network) => network.chainId === 1n)

    // Here's how we test if account updates are queued correctly.
    // To validate the order of execution, we mock the `updatePortfolioState()` method.
    // When this method is called, we log the invocation to `controller.queueOrder`.
    // Additionally, we intentionally delay the first invocation (using setTimeout) to check if the other chained functions
    // will wait for it or if they will resolve earlier and break the queue.
    // At the end of the test, we simply verify that `controller.queueOrder` reflects the correct order of function executions.
    const queueOrder: string[] = []

    jest
      // @ts-expect-error test
      .spyOn(controller, 'updatePortfolioState')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              queueOrder.push('updatePortfolioState - #1 call')
              // @ts-expect-error test
              resolve([true, null])
            }, 2000)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #2 call')
            resolve([true, null])
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #3 call')
            resolve([true, null])
          })
      )

    void controller.updateSelectedAccount(
      account.addr,
      ethereum ? [ethereum] : undefined,
      undefined
    )

    void controller.updateSelectedAccount(
      account.addr,
      ethereum ? [ethereum] : undefined,
      undefined
    )

    // We need to wait for the latest update, or the bellow expect will run too soon,
    // and we won't be able to check the queue properly.
    await controller.updateSelectedAccount(
      account.addr,
      ethereum ? [ethereum] : undefined,
      undefined
    )

    expect(queueOrder).toEqual([
      'updatePortfolioState - #1 call',
      'updatePortfolioState - #2 call',
      'updatePortfolioState - #3 call'
    ])
  })

  describe('Tokens', () => {
    test('Tokens are fetched and kept in the controller', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(ambireV2Account.addr)

      const state1 = controller.getAccountPortfolioState(ambireV2Account.addr)?.['42161']!
      expect(state1.isReady).toEqual(true)
      expect(state1.result?.tokens.length).toBeGreaterThan(0)
      expect(state1.result?.collections?.length).toBeGreaterThan(0)
      expect(state1.result?.lastExternalApiUpdateData).toBeTruthy()
    })

    test('Tokens are fetched only once in a short period of time (20s maxDataAgeMs)', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(account.addr)
      const state1 = controller.getAccountPortfolioState(account.addr)?.['1']
      const updateStarted1 = state1?.result?.updateStarted

      expect(updateStarted1).toBeDefined()

      await controller.updateSelectedAccount(account.addr, undefined, undefined, {
        maxDataAgeMs: 20 * 1000
      })

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']
      const updateStarted2 = state2?.result?.updateStarted

      expect(updateStarted2).toBe(updateStarted1)
    })
  })

  describe('Pending tokens', () => {
    test('Pending tokens + simulation are fetched and kept in the controller', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      controller.onUpdate(() => {
        const state = controller.getAccountPortfolioState(
          '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
        )['1']!
        const collection = state.result?.collections?.find(
          (c: CollectionResult) => c.symbol === 'NFT Fiesta'
        )
        expect(state.isLoading).toEqual(false)

        expect(state.result?.tokens.length).toBeGreaterThan(0)
        expect(state.result?.collections?.length).toBeGreaterThan(0)
        expect(state.result?.lastExternalApiUpdateData).toBeTruthy()
        expect(state.result?.total.usd).toBeGreaterThan(1000)
        // Expect amount post simulation to be calculated correctly
        expect(collection?.amountPostSimulation).toBe(0n)
      })
    })
    test('Pending tokens are re-fetched, if `forceUpdate` flag is set, no matter if AccountOp is the same or changer', async () => {
      const done = jest.fn(() => null)
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()

      let state1: any
      let state2: any
      controller.onUpdate(() => {
        if (!state1?.isReady) {
          state1 = controller.getAccountPortfolioState(
            '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
          )?.['1']
          return
        }
        if (state1?.isReady) {
          state2 = controller.getAccountPortfolioState(
            '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
          )?.['1']
        }
        if (state1.result?.updateStarted < state2.result?.updateStarted) {
          done()
        }
      })
      const accountStates = await getAccountsInfo([account])
      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })
      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      expect(done).toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched if AccountOp is changed (omitted, i.e. undefined)', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })
      const state1 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })
      const state2 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      expect(state2.result?.updateStarted).toBeGreaterThan(state1.result?.updateStarted!)
    })

    test('Pending tokens are re-fetched if AccountOp is changed', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })
      const state1 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      const accountOp2 = await getAccountOp()
      // Change the address
      accountOp2['1']![0]!.accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA4'

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp2,
        states: accountStates[account.addr]!
      })
      const state2 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      expect(state2.result?.updateStarted).toBeGreaterThan(state1.result?.updateStarted!)
    })
  })

  describe('Simulation discarding', () => {
    const getEthereumPortfolioState = (controller: PortfolioController) =>
      controller.getAccountPortfolioState(account.addr)['1']!

    const getSimulatedCollection = (
      controller: PortfolioController,
      address: string = '0xcf30def37dcb65d244f14e075dc0ce875ccfa065'
    ) =>
      getEthereumPortfolioState(controller).result?.collections?.find(
        (collection: CollectionResult) => collection.address.toLowerCase() === address
      )

    test('overrideSimulationResults removes the current simulation result and stored accountOps', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      const stateBefore = getEthereumPortfolioState(controller)
      const collectionBefore = getSimulatedCollection(controller)

      expect(areAccountOpsEqual(stateBefore.accountOps!, accountOp['1']!)).toBe(true)
      expect(collectionBefore?.amountPostSimulation).toBe(0n)

      await controller.overrideSimulationResults(accountOp['1']![0]!)

      const stateAfter = getEthereumPortfolioState(controller)
      const collectionAfter = getSimulatedCollection(controller)

      expect(stateAfter.accountOps).toBeUndefined()
      expect(collectionAfter).toBeTruthy()
      expect(collectionAfter?.amountPostSimulation).toBeUndefined()
      expect(collectionAfter?.postSimulation).toBeUndefined()
      expect(collectionAfter?.simulationAmount).toBeUndefined()
      expect(
        stateAfter.result?.tokens.some(
          (token) =>
            token.amountPostSimulation !== undefined || token.simulationAmount !== undefined
        )
      ).toBe(false)
    })

    test('calling overrideSimulationResults during a portfolio update still removes the simulation result and stored accountOps', async () => {
      const { controller } = await prepareTest()
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      const updatePromise = controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      // Wait a short period
      await wait(50)

      // We call overrideSimulationResults in the middle of the updateSelectedAccount flow, to make sure it can handle that case
      const overridePromise = controller.overrideSimulationResults(accountOp['1']![0]!)

      await updatePromise
      await overridePromise

      const stateAfter = getEthereumPortfolioState(controller)

      expect(stateAfter.accountOps).toBeUndefined()
    })

    test('overrideSimulationResults is a no-op when there is no matching simulated state', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()

      expect(() => controller.overrideSimulationResults(accountOp['1']![0]!)).not.toThrow()
      expect(controller.getAccountPortfolioState(account.addr)).toEqual({})
    })

    test('discardSimulation removes the matching simulated account op and refreshes the portfolio', async () => {
      const { controller } = await prepareTest()
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      const stateBefore = getEthereumPortfolioState(controller)
      expect(stateBefore.accountOps).toStrictEqual(accountOp['1'])
      expect(getSimulatedCollection(controller)?.amountPostSimulation).toBe(0n)

      await controller.discardSimulation(accountOp['1']!)

      const stateAfter = getEthereumPortfolioState(controller)

      expect(stateAfter.accountOps).toBeUndefined()
      expect(stateAfter.result?.updateStarted).toBeGreaterThan(stateBefore.result?.updateStarted!)
      expect(getSimulatedCollection(controller)?.amountPostSimulation).toBeUndefined()
      expect(stateAfter.accountOps).toBeUndefined()
    })

    test('discardSimulation is a no-op when the account op is not part of the current simulation', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      const updateSelectedAccountSpy = jest.spyOn(controller, 'updateSelectedAccount')
      const nonMatchingAccountOp = structuredClone(accountOp['1']![0]!)
      nonMatchingAccountOp.accountAddr = account2.addr

      await controller.discardSimulation([nonMatchingAccountOp])

      expect(updateSelectedAccountSpy).not.toHaveBeenCalled()
      expect(getEthereumPortfolioState(controller).accountOps).toStrictEqual(accountOp['1'])
      expect(getSimulatedCollection(controller)?.amountPostSimulation).toBe(0n)
    })

    test('discardSimulation does not affect a different account op, even if they are called together', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const ethereum = networks.find((network) => network.chainId === 1n)!
      const oldAccountOp = await getAccountOp()
      const toBeDiscardedAccountOp = await getAccountOp(
        '0x932261f9fc8da46c4a22e31b45c4de60623848bf',
        39118
      )
      const accountStates = await getAccountsInfo([account])

      const updatePromise = controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: oldAccountOp,
        states: accountStates[account.addr]!
      })

      const discardPromise = controller.discardSimulation(toBeDiscardedAccountOp['1']!)

      await Promise.all([updatePromise, discardPromise])

      const stateAfter = getEthereumPortfolioState(controller)

      expect(areAccountOpsEqual(stateAfter.accountOps!, oldAccountOp['1']!)).toBe(true)
    })

    test('discardSimulation does not discard a newer simulation when it is queued first', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const ethereum = networks.find((network) => network.chainId === 1n)!
      const oldAccountOp = await getAccountOp()
      const newAccountOp = await getAccountOp('0x932261f9fc8da46c4a22e31b45c4de60623848bf', 39118)
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: oldAccountOp,
        states: accountStates[account.addr]!
      })

      const discardPromise = controller.discardSimulation(oldAccountOp['1']!)
      const updatePromise = controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: newAccountOp,
        states: accountStates[account.addr]!
      })

      await Promise.all([discardPromise, updatePromise])

      const stateAfter = getEthereumPortfolioState(controller)

      expect(areAccountOpsEqual(stateAfter.accountOps!, newAccountOp['1']!)).toBe(true)
    })
    test('discardSimulation is not affected by account op nonces being updated in between', async () => {
      const { controller } = await prepareTest({ skipAccountStateFetch: false })
      const ethereum = networks.find((network) => network.chainId === 1n)!
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      const updatedAccountOp = structuredClone(accountOp)
      ;(updatedAccountOp['1']![0]!.nonce as bigint) += 1n

      await controller.discardSimulation(accountOp['1']!)

      const stateAfter = controller.getAccountPortfolioState(account.addr)['1']!

      expect(stateAfter.accountOps).toBeUndefined()
    })
    test('discardSimulation removes the account ops from state even if the portfolio update fails', async () => {
      const { restore } = suppressConsole()
      const { controller } = await prepareTest()
      const ethereum = networks.find((network) => network.chainId === 1n)!
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, [ethereum], {
        accountOps: accountOp,
        states: accountStates[account.addr]!
      })

      expect(controller.getAccountPortfolioState(account.addr)['1']!.accountOps).toBeDefined()

      // Mock getAllHints error which will cause the update to fail
      // @ts-expect-error test
      jest.spyOn(controller.hints, 'getAllHints').mockImplementationOnce(() => {
        throw new Error('Failed to get hints')
      })

      await controller.discardSimulation(accountOp['1']!)

      const stateAfter = controller.getAccountPortfolioState(account.addr)['1']!

      expect(stateAfter.accountOps).toBeUndefined()
      restore()
    })
  })

  describe('Scheduled updates', () => {
    suppressConsoleBeforeEach()
    // A minimal portfolio lib result, so updatePortfolioState can fill the state without
    // hitting the network.
    const makePortfolioLibResult = (): any => ({
      updateStarted: Date.now(),
      discoveryTime: 0,
      oracleCallTime: 0,
      priceUpdateTime: 0,
      tokenDataCache: new Map(),
      tokens: [],
      feeTokens: [],
      toBeLearned: { erc20s: [], erc721s: {} },
      tokenErrors: [],
      collectionErrors: [],
      collections: [],
      errors: [],
      blockNumber: 0,
      beforeNonce: 0n,
      afterNonce: 0n
    })

    // Mock the network calls so a real updateSelectedAccount completes without real requests.
    const mockFetchLayer = (controller: PortfolioController) => {
      const discoverySpy: any = jest
        // @ts-expect-error test
        .spyOn(controller, 'batchedPortfolioDiscovery')
      discoverySpy.mockResolvedValue(null)
      jest.spyOn(Portfolio.prototype, 'get').mockResolvedValue(makePortfolioLibResult())
      jest
        .spyOn(defiPositionsLib, 'getCustomProviderPositions')
        .mockResolvedValue({ positionsByProvider: [], error: null, providerErrors: [] } as any)

      return { discoverySpy }
    }

    // The runner's scheduled updates are the calls that pass bypassServerSideCache in opts.
    const getBypassUpdates = (spy: any) =>
      spy.mock.calls.filter((call: any[]) => call[3]?.bypassServerSideCache === true)

    // Schedules a cache-busting update the way MainController does after a confirmed tx.
    const schedule = (controller: PortfolioController, accountId: string, chainId: bigint) =>
      controller.scheduleUpdate({ accountId, chainId, bypassServerSideCache: true })

    test('schedules a cache-busting update that fires only after the 60s threshold', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        schedule(controller, account.addr, 1n)

        // The runner ticks at 20s and 40s, but the update is younger than 60s so nothing fires.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(0)

        // At 60s it's old enough, so the bypass update fires for the account and network.
        await jest.advanceTimersByTimeAsync(20 * 1000)
        const bypassUpdates = getBypassUpdates(updateSpy)
        expect(bypassUpdates).toHaveLength(1)
        expect(bypassUpdates[0][0]).toBe(account.addr)
        expect(bypassUpdates[0][1].map((n: Network) => n.chainId)).toEqual([1n])
      } finally {
        jest.useRealTimers()
      }
    })

    test('a scheduled update is removed after it fires and does not run twice', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        schedule(controller, account.addr, 1n)

        // Advance past the threshold so the scheduled update fires.
        await jest.advanceTimersByTimeAsync(60 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)

        // The entry was removed, so later ticks don't fire it again.
        await jest.advanceTimersByTimeAsync(120 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)
      } finally {
        jest.useRealTimers()
      }
    })

    test('re-scheduling debounces: the window restarts from the most recent confirmation', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        // First confirmation schedules the update.
        schedule(controller, account.addr, 1n)

        // After 40s a second confirmation re-schedules and resets the timer.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        schedule(controller, account.addr, 1n)

        // 80s after the first confirmation it would have fired already, but it's only 40s after
        // the second one, so nothing fires yet.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(0)

        // 60s after the second confirmation it finally fires.
        await jest.advanceTimersByTimeAsync(20 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)
      } finally {
        jest.useRealTimers()
      }
    })

    test('the runner does not call updateSelectedAccount when no scheduled update is due yet', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        schedule(controller, account.addr, 1n)

        // The update is younger than 60s, so the runner shouldn't call updateSelectedAccount.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        expect(updateSpy).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    test('scheduled updates are tracked per network and fire independently', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        // Ethereum confirms first, Polygon 30s later.
        schedule(controller, account.addr, 1n)
        await jest.advanceTimersByTimeAsync(30 * 1000)
        schedule(controller, account.addr, 137n)

        // At 60s only Ethereum is due.
        await jest.advanceTimersByTimeAsync(30 * 1000)
        let bypassUpdates = getBypassUpdates(updateSpy)
        expect(bypassUpdates).toHaveLength(1)
        expect(bypassUpdates[0][1].map((n: Network) => n.chainId)).toEqual([1n])

        // Polygon was scheduled 30s later, so it becomes due around 90s and fires on the 100s
        // tick. Ethereum has already fired.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        bypassUpdates = getBypassUpdates(updateSpy)
        expect(bypassUpdates).toHaveLength(2)
        expect(bypassUpdates[1][1].map((n: Network) => n.chainId)).toEqual([137n])
      } finally {
        jest.useRealTimers()
      }
    })

    test('a slow scheduled update is removed before the await and is not processed twice', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })

        // Make the scheduled update hang so it's still running on the next ticks. The entry is
        // removed before the await, so it shouldn't be picked up again.
        let resolveSlowUpdate: () => void = () => {}
        const slowUpdate = new Promise<void>((resolve) => {
          resolveSlowUpdate = () => resolve()
        })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockImplementation((...args: any[]) =>
            args[3]?.bypassServerSideCache ? (slowUpdate as any) : Promise.resolve(undefined)
          )

        schedule(controller, account.addr, 1n)

        // This fires the scheduled update, which now hangs.
        await jest.advanceTimersByTimeAsync(60 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)

        // While it's still running, it isn't called again.
        await jest.advanceTimersByTimeAsync(60 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)

        // Once it resolves the schedule is empty, so it still doesn't run again.
        resolveSlowUpdate()
        await jest.advanceTimersByTimeAsync(40 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)
      } finally {
        jest.useRealTimers()
      }
    })

    // The force state derived from the defiUpdateMode passed to batchedPortfolioDiscovery. Only the
    // per-network discovery sets the mode; the defi-apps (customAppChain) call doesn't, so it's
    // filtered out.
    const getForceFlags = (discoverySpy: any): boolean[] =>
      discoverySpy.mock.calls
        .map((call: any[]) => call[0].defiUpdateMode)
        .filter((mode: unknown) => mode !== undefined)
        .map((mode: string) => mode === defiPositionsLib.DefiUpdateMode.Force)

    test('a pending scheduled update suppresses the server-side bypass on the next update', async () => {
      const { controller } = await prepareTest()
      const { discoverySpy } = mockFetchLayer(controller)
      // After a tx the nonce changes, so the defi update can't be skipped and discovery runs.
      jest.spyOn(defiPositionsLib, 'getHasNonceChangedSinceLastUpdate').mockReturnValue(true)

      // A cache-busting update is scheduled, as MainController does after a confirmed tx.
      schedule(controller, account.addr, 1n)

      // A regular update in the meantime shouldn't force the bypass (the scheduled one will),
      // even though the nonce changed.
      await controller.updateSelectedAccount(account.addr, [ethereum])

      const forceFlags = getForceFlags(discoverySpy)
      expect(forceFlags.length).toBeGreaterThan(0)
      forceFlags.forEach((flag: boolean) => expect(flag).toBe(false))
    })

    test('without a pending scheduled update, a nonce change does force the server-side bypass (control)', async () => {
      const { controller } = await prepareTest()
      const { discoverySpy } = mockFetchLayer(controller)
      jest.spyOn(defiPositionsLib, 'getHasNonceChangedSinceLastUpdate').mockReturnValue(true)

      // With no scheduled update pending, a nonce change forces the bypass. This is the
      // counterpart to the previous test.
      await controller.updateSelectedAccount(account.addr, [ethereum])

      const forceFlags = getForceFlags(discoverySpy)
      expect(forceFlags.length).toBeGreaterThan(0)
      expect(forceFlags.some((flag: boolean) => flag === true)).toBe(true)
    })

    test('The scheduled cache-busting update reaches discovery with forceUpdateDefi=true', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const { discoverySpy } = mockFetchLayer(controller)

        discoverySpy.mockResolvedValue({
          networkId: '1',
          chainId: 1,
          accountAddr: account.addr,
          erc20s: [],
          erc721s: {},
          hasHints: true,
          prices: {},
          defi: { positions: [], updatedAt: Date.now() }
        })

        // Spy without mocking the implementation, so the runner runs the real updateSelectedAccount.
        const updateSpy = jest.spyOn(controller, 'updateSelectedAccount')

        schedule(controller, account.addr, 1n)

        await jest.advanceTimersByTimeAsync(60 * 1000)

        const bypassCalls = updateSpy.mock.calls.filter(
          (call: any[]) => call[3]?.bypassServerSideCache === true
        )
        expect(bypassCalls).toHaveLength(1)

        // And it actually forces the defi discovery.
        const forcedDiscovery = discoverySpy.mock.calls.some(
          (call: any[]) => call[0]?.defiUpdateMode === defiPositionsLib.DefiUpdateMode.Force
        )
        expect(forcedDiscovery).toBe(true)

        // The defi-apps (customAppChain) positions are refreshed too, not skipped. In the real
        // batcher this call is merged with the network one, so it inherits update=true.
        const updatedDefiApps = discoverySpy.mock.calls.some(
          (call: any[]) => call[0]?.chainId === 'customAppChain'
        )
        expect(updatedDefiApps).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    })

    test('scheduled updates are tracked per account and fire independently', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockResolvedValue(undefined)

        // account confirms first, account2 30s later.
        schedule(controller, account.addr, 1n)
        await jest.advanceTimersByTimeAsync(30 * 1000)
        schedule(controller, account2.addr, 1n)

        // At 60s only account is due.
        await jest.advanceTimersByTimeAsync(30 * 1000)
        let bypassUpdates = getBypassUpdates(updateSpy)
        expect(bypassUpdates).toHaveLength(1)
        expect(bypassUpdates[0][0]).toBe(account.addr)

        // account2 was scheduled 30s later, so it becomes due around 90s and fires on the 100s
        // tick. account has already fired.
        await jest.advanceTimersByTimeAsync(40 * 1000)
        bypassUpdates = getBypassUpdates(updateSpy)
        expect(bypassUpdates).toHaveLength(2)
        expect(bypassUpdates[1][0]).toBe(account2.addr)
      } finally {
        jest.useRealTimers()
      }
    })

    test('a failing scheduled update does not crash the runner or block other accounts', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })

        // The scheduled update for account fails, account2 succeeds.
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockImplementation((...args: any[]) => {
            if (args[3]?.bypassServerSideCache && args[0] === account.addr)
              return Promise.reject(new Error('RPC down'))
            return Promise.resolve(undefined)
          })

        schedule(controller, account.addr, 1n)
        schedule(controller, account2.addr, 1n)

        // Both are due at 60s. account2 should still run even though account's update fails, and
        // the runner shouldn't throw.
        await expect(jest.advanceTimersByTimeAsync(60 * 1000)).resolves.not.toThrow()

        const accounts = getBypassUpdates(updateSpy).map((call: any[]) => call[0])
        expect(accounts).toContain(account.addr)
        expect(accounts).toContain(account2.addr)

        // There's no retry. The failed entry was already removed, so account isn't run again.
        await jest.advanceTimersByTimeAsync(60 * 1000)
        const accountsAfter = getBypassUpdates(updateSpy).map((call: any[]) => call[0])
        expect(accountsAfter.filter((addr: string) => addr === account.addr)).toHaveLength(1)
      } finally {
        jest.useRealTimers()
      }
    })

    test('a confirmation arriving while a scheduled update is in flight is not lost', async () => {
      jest.useFakeTimers()
      try {
        const { controller } = await prepareTest({ awaitInitialLoad: false })

        // Make the scheduled update hang so a new confirmation can come in while it's running.
        let resolveSlowUpdate: () => void = () => {}
        const slowUpdate = new Promise<void>((resolve) => {
          resolveSlowUpdate = () => resolve()
        })
        const updateSpy = jest
          .spyOn(controller, 'updateSelectedAccount')
          .mockImplementation((...args: any[]) =>
            args[3]?.bypassServerSideCache ? (slowUpdate as any) : Promise.resolve(undefined)
          )

        // First confirmation schedules the update.
        schedule(controller, account.addr, 1n)

        // At 60s the runner fires the first update, which hangs.
        await jest.advanceTimersByTimeAsync(60 * 1000)
        expect(getBypassUpdates(updateSpy)).toHaveLength(1)

        // A new confirmation comes in while the first update is still running. The old entry was
        // already removed, so this adds a fresh one.
        schedule(controller, account.addr, 1n)

        // Let the hanging update finish, then advance to the new entry's deadline.
        resolveSlowUpdate()
        await jest.advanceTimersByTimeAsync(60 * 1000)

        // The new confirmation wasn't lost, so a second update fired.
        expect(getBypassUpdates(updateSpy)).toHaveLength(2)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('Pinned tokens', () => {
    test('Pinned tokens are set in an account with no tokens', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(
        emptyAccount.addr,
        // we pass a network here, just because the portfolio is trying to perform a call to an undefined network,
        // and it throws a silent error
        [networks.find((network) => network.chainId === 1n)!],
        undefined
      )

      PINNED_TOKENS.filter((token) => token.chainId === 1n).forEach((pinnedToken) => {
        const token = controller
          .getAccountPortfolioState(emptyAccount.addr)
          ['1']?.result?.tokens.find((t) => t.address === pinnedToken.address)

        expect(token).toBeTruthy()
      })
    })

    test('Pinned gas tank tokens are not set in an account with tokens', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(account.addr)

      if (controller.getAccountPortfolioState(account.addr).gasTank?.isLoading) return

      const gasTankResult = controller.getAccountPortfolioState(account.addr).gasTank
        ?.result as PortfolioGasTankResult

      controller.getAccountPortfolioState(account.addr)['1']?.result?.tokens.forEach((token) => {
        expect(token.amount > 0)
      })
      gasTankResult.gasTankTokens.forEach((token) => {
        expect(token.amount > 0)
      })
    })
  })

  describe('Gas Tank with USDC token', () => {
    const usdcTokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const foundUsdcToken = PINNED_TOKENS.find(
      (token) => token.address === usdcTokenAddress && token.chainId === 1n
    )

    test('USDC gas tank token is set in a smart account with no tokens', async () => {
      const { controller } = await prepareTest()

      expect(foundUsdcToken).toBeTruthy()

      await controller.updateSelectedAccount(account3.addr)

      if (controller.getAccountPortfolioState(account3.addr).gasTank?.isLoading) return

      const gasTankResult = controller.getAccountPortfolioState(account3.addr).gasTank
        ?.result as PortfolioGasTankResult

      const token = gasTankResult.gasTankTokens.find((t) => t.address === foundUsdcToken?.address)

      expect(token).toBeTruthy()
      expect(token?.amount).toEqual(0n)
      expect(token?.availableAmount).toEqual(0n)
    })
  })

  describe('Hints- token/nft learning, external api hints and temporary tokens', () => {
    afterEach(() => {
      jest.restoreAllMocks()
      jest.clearAllMocks()
    })
    test('Non-asset passed to addTokensToBeLearned is not learned', async () => {
      const ETHX_TOKEN_ADDR = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b'
      const SMART_CONTRACT_ADDR = '0xa8202f888b9b2dfa5ceb2204865018133f6f179a'
      const { storageCtrl, controller } = await prepareTest()

      controller.addTokensToBeLearned([ETHX_TOKEN_ADDR, SMART_CONTRACT_ADDR], 1n)

      await controller.updateSelectedAccount(account.addr)

      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )
      const key = `${1}:${account.addr}`

      expect(learnedAssets.erc20s[key]).not.toHaveProperty(SMART_CONTRACT_ADDR)
      expect(learnedAssets.erc20s[key]).toHaveProperty(ETHX_TOKEN_ADDR)
    })
    test('Non-asset passed to addErc721sToBeLearned is not learned', async () => {
      const NFT_ADDR = getAddress('0x026224a2940bfe258d0dbe947919b62fe321f042')
      const SMART_CONTRACT_ADDR = '0xa8202f888b9b2dfa5ceb2204865018133f6f179a'
      const { storageCtrl, controller } = await prepareTest()

      controller.addErc721sToBeLearned(
        [
          [NFT_ADDR, [2647n]],
          [SMART_CONTRACT_ADDR, [1n]]
        ],
        account2.addr,
        1n
      )
      await controller.updateSelectedAccount(account2.addr)
      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )
      const key = `${1}:${account2.addr}`

      expect(learnedAssets.erc721s[key]).not.toHaveProperty(SMART_CONTRACT_ADDR)
      // Note: The nft must be owned in order to appear in learned
      expect(learnedAssets.erc721s[key]).toHaveProperty(`${NFT_ADDR}:2647`)
    })
    test('Not owned ERC721 NFT in toBeLearned is added to specialErc721Hints.learn', async () => {
      const NFT_ADDR = getAddress('0x026224a2940bfe258d0dbe947919b62fe321f042')
      const { controller } = await prepareTest()

      controller.addErc721sToBeLearned([[NFT_ADDR, [1n]]], account2.addr, 1n)

      // @ts-expect-error test
      const allHints = controller.hints.getAllHints(account2.addr, 1n)

      expect(allHints.specialErc721Hints.learn[NFT_ADDR]).toContain(1n)
    })

    test('Portfolio should filter out ER20 tokens that mimic native tokens (same symbol and amount)', async () => {
      const ERC_20_MATIC_ADDR = '0x0000000000000000000000000000000000001010'
      const { controller } = await prepareTest()

      // @ts-expect-error test
      await controller.hints.learnTokens([ERC_20_MATIC_ADDR], `${137}:${account.addr}`, 137n)

      await controller.updateSelectedAccount(account.addr)

      const hasErc20Matic = controller
        .getAccountPortfolioState(account.addr)
        ['137']!.result!.tokens.find((token) => token.address === ERC_20_MATIC_ADDR)

      expect(hasErc20Matic).toBeFalsy()
    })

    test('To be learned erc20 cleanup mechanism works', async () => {
      // A total of 80 tokens are added. 30 of them are "no longer owned"
      // but only 10 of them should be removed as the threshold of unowned is 20
      const firstBatchOf50 = generateRandomAddresses(50)
      const startingLearnedAssets: LearnedAssets = {
        erc20s: {
          [`${1}:${account.addr}`]: firstBatchOf50.reduce(
            (acc, addr, index) => {
              // First 20 are still owned, last 30 are no longer owned
              acc[addr] = index <= 20 ? Date.now() : Date.now() - 24 * 60 * 60 * 1000

              return acc
            },
            {} as LearnedAssets['erc20s'][string]
          )
        },
        erc721s: {}
      }

      const { controller, storageCtrl } = await prepareTest({
        initialSetStorage: (storageC) => storageC.set('learnedAssets', startingLearnedAssets)
      })

      const nextBatchOf30 = generateRandomAddresses(30)
      const allCurrentlyOwned = [...firstBatchOf50.slice(0, 20), ...nextBatchOf30]

      // @ts-expect-error test
      await controller.hints.learnTokens(allCurrentlyOwned, `${1}:${account.addr}`, 1n)

      // Expect the oldest 10 to be removed
      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )
      const learnedErc20s = learnedAssets.erc20s?.[`${1}:${account.addr}`]

      expect(Object.keys(learnedErc20s!).length).toBe(70)
    })

    test('To be learned erc721 cleanup mechanism works', async () => {
      // A total of 80 collections are added. 30 of them are "no longer owned"
      // but only 10 of them should be removed as the threshold of unowned is 20
      const firstRandomCollections = generateRandomAddresses(50).reduce(
        (acc, addr, index) => {
          acc.push([addr, Math.random() < 0.2 ? [] : [BigInt(index)]] as [string, bigint[]])

          return acc
        },
        [] as [string, bigint[]][]
      )

      const keys = firstRandomCollections.map((c) => erc721CollectionToLearnedAssetKeys(c)).flat()

      const startingLearnedAssets: LearnedAssets = {
        erc20s: {},
        erc721s: {
          [`${1}:${account.addr}`]: keys.reduce(
            (acc, key, index) => {
              // First 20 are still owned, last 30 are no longer owned
              acc[key] = index <= 20 ? Date.now() : Date.now() - 24 * 60 * 60 * 1000

              return acc
            },
            {} as LearnedAssets['erc721s'][string]
          )
        }
      }

      const { controller, storageCtrl } = await prepareTest({
        initialSetStorage: (storageC) => storageC.set('learnedAssets', startingLearnedAssets)
      })

      const nextRandomCollections = generateRandomAddresses(30).reduce(
        (acc, addr, index) => {
          acc.push([addr, Math.random() < 0.2 ? [] : [BigInt(index)]] as [string, bigint[]])

          return acc
        },
        [] as [string, bigint[]][]
      )

      const allCurrentlyOwnedCollections = [
        ...firstRandomCollections.slice(0, 20),
        ...nextRandomCollections
      ]

      // @ts-expect-error test
      await controller.hints.learnNfts(allCurrentlyOwnedCollections, account.addr, 1n)

      // Expect the oldest 10 to be removed
      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )

      const learnedErc721s = learnedAssets.erc721s?.[`${1}:${account.addr}`]!

      Object.keys(learnedErc721s).forEach((key) => {
        const [, id] = key.split(':')

        if (id === '') throw new Error(`bad id. Should never happen: ${id}`)
      })

      const expectedCount = Object.keys(learnedErc721s).length
      expect(expectedCount).toBe(70)
    })

    test('Add the same to be learned asset twice (with different address case)', async () => {
      const { controller } = await prepareTest()

      const DUPLICATE_TOKEN_ADDR = getAddress('0xae7ab96520de3a18e5e111b5eaab095312d7fe84')

      controller.addTokensToBeLearned([DUPLICATE_TOKEN_ADDR], 1n)
      controller.addTokensToBeLearned(
        [DUPLICATE_TOKEN_ADDR.toLowerCase(), '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'],
        1n
      )

      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      controller.addErc721sToBeLearned(
        [DUPLICATE_COLLECTION, ['0xbd3531da5cf5857e7cfaa92426877b022e612cf8', [1n, 2n]]],
        account.addr,
        1n
      )
      controller.addErc721sToBeLearned(
        [[DUPLICATE_COLLECTION[0]!.toLowerCase(), [1n, 2n]]],
        account.addr,
        1n
      )

      // @ts-expect-error test
      const allHints = controller.hints.getAllHints(account.addr, 1n)

      expect(
        allHints.specialErc20Hints.learn.filter(
          (addr) => addr.toLowerCase() === DUPLICATE_TOKEN_ADDR.toLowerCase()
        ).length
      ).toBe(1)
      expect(
        Object.keys(allHints.specialErc721Hints.learn).filter(
          (addr) => addr.toLowerCase() === DUPLICATE_COLLECTION[0]!.toLowerCase()
        ).length
      ).toBe(1)
      expect(allHints.specialErc721Hints.learn[DUPLICATE_COLLECTION[0]]!.length).toBe(2)
    })

    test('Add the same learned asset twice', async () => {
      const { controller, storageCtrl } = await prepareTest()

      const DUPLICATE_TOKEN_ADDR = getAddress('0xae7ab96520de3a18e5e111b5eaab095312d7fe84')
      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      // @ts-expect-error test
      await controller.hints.learnTokens(
        [
          DUPLICATE_TOKEN_ADDR,
          '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
          '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee'
        ],
        `${1}:${account.addr}`,
        1n
      )

      // @ts-expect-error test
      await controller.hints.learnTokens(
        [
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
          DUPLICATE_TOKEN_ADDR,
          '0x8d010bf9c26881788b4e6bf5fd1bdc358c8f90b8'
        ],
        `${1}:${account.addr}`,
        1n
      )

      // @ts-expect-error test
      await controller.hints.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      // @ts-expect-error test
      await controller.hints.learnNfts(
        [
          [DUPLICATE_COLLECTION[0], [1n, 2n]],
          ['0x0a1bbd57033f57e7b6743621b79fcb9eb2ce3676', [1n, 2n]]
        ],
        account.addr,
        1n
      )

      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )

      expect(
        Object.keys(learnedAssets.erc20s?.[`${1}:${account.addr}`] || {}).filter(
          (addr) => addr === DUPLICATE_TOKEN_ADDR
        ).length
      ).toBe(1)

      expect(
        Object.keys(learnedAssets.erc721s?.[`${1}:${account.addr}`] || {}).filter((addr) =>
          addr.toLowerCase().startsWith(DUPLICATE_COLLECTION[0]!.toLowerCase())
        ).length
      ).toBe(2)
    })

    test('Learn a collectible, then learn the same collection as enumerable (enumerable is with priority)', async () => {
      const { controller, storageCtrl } = await prepareTest()

      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      // @ts-expect-error test
      await controller.hints.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      // @ts-expect-error test
      await controller.hints.learnNfts(
        [
          // Empty array makes it enumerable
          [DUPLICATE_COLLECTION[0], []]
        ],
        account.addr,
        1n
      )

      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )

      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:1`
      )
      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:enumerable`
      )

      // @ts-expect-error test
      const { additionalErc721Hints } = controller.hints.getAllHints(account.addr, 1n)

      // Enumerable is with priority
      expect(additionalErc721Hints[DUPLICATE_COLLECTION[0]]).toEqual([])
    })

    test('Learn an enumerable collection, then learn a collectible from it (enumerable is with priority)', async () => {
      const { controller, storageCtrl } = await prepareTest()

      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      // @ts-expect-error test
      await controller.hints.learnNfts(
        [
          // Empty array makes it enumerable
          [DUPLICATE_COLLECTION[0], []]
        ],
        account.addr,
        1n
      )

      // @ts-expect-error test
      await controller.hints.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )

      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:1`
      )
      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:enumerable`
      )

      // @ts-expect-error test
      const { additionalErc721Hints } = controller.hints.getAllHints(account.addr, 1n)

      // Enumerable is with priority
      expect(additionalErc721Hints[DUPLICATE_COLLECTION[0]]).toEqual([])
    })

    test('Portfolio should filter out ERC20 tokens that mimic native tokens when they are added as custom tokens', async () => {
      const ERC_20_MATIC_ADDR = '0x0000000000000000000000000000000000001010'
      const { controller } = await prepareTest()

      const customToken = {
        address: ERC_20_MATIC_ADDR,
        chainId: 137n,
        standard: 'ERC20'
      } as const

      await controller.addCustomToken(customToken, account.addr, true)

      const hasErc20Matic = controller
        .getAccountPortfolioState(account.addr)
        ['137']!.result!.tokens.find((token) => token.address === ERC_20_MATIC_ADDR)

      expect(hasErc20Matic).toBeFalsy()
    })
    test('To be learned token is returned from portfolio, but not passed to learnTokens (as it is without balance)', async () => {
      const { storageCtrl, controller } = await prepareTest()
      const ethereum = networks.find((network) => network.chainId === 1n)!
      const clonedEthereum = structuredClone(ethereum)
      // In order to test whether toBeLearned token is passed and persisted in learnedTokens correctly we need to:
      // 1. make sure we pass a token we know is with balance to toBeLearned list.
      // 2. retrieve the token from portfolio and check if it is found.
      // 3. check if the token is persisted in learnedTokens with timestamp.
      // in learnedTokens as a new token, when found with balance from toBeLearned list.

      // This will work on networks without relayer support so we mock one,
      // otherwise the token will be fetched from the relayer and won't be available for learnedTokens,
      // but will be stored in fromExternalAPI.
      clonedEthereum.hasRelayer = false

      await controller.addTokensToBeLearned(['0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b'], 1n)

      await controller.updateSelectedAccount(
        account.addr,
        clonedEthereum ? [clonedEthereum] : undefined,
        undefined
      )

      const toBeLearnedToken = controller
        .getAccountPortfolioState(account.addr)
        [
          '1'
        ]?.result?.tokens.find((token) => token.address === '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b')

      expect(toBeLearnedToken).toBeTruthy()

      const previousHintsStorage = await storageCtrl.get(
        'previousHints',
        {} as PreviousHintsStorage
      )
      const tokenInLearnedTokens =
        previousHintsStorage.learnedTokens?.['1'] &&
        previousHintsStorage.learnedTokens?.['1'][toBeLearnedToken!.address]

      expect(tokenInLearnedTokens).toBeFalsy()
    })

    test('To be learned token is returned from portfolio and updated with timestamp in learnedAssets', async () => {
      const { storageCtrl, controller } = await prepareTest()
      const polygon = networks.find((network) => network.chainId === 137n)!
      // In order to test whether toBeLearned token is passed and persisted in learnedAssets correctly we need to:
      // 1. make sure we pass a token we know is with balance to toBeLearned list.
      // 2. retrieve the token from portfolio and check if it is found.
      // 3. check if the token is persisted in learnedAssets with timestamp.
      // in learnedAssets as a new token, when found with balance from toBeLearned list.

      const hints: Hints = {
        erc20s: [ZeroAddress],
        erc721s: {},
        externalApi: {
          hasHints: true,
          lastUpdate: Date.now(),
          prices: {}
        }
      }

      // @ts-expect-error test
      jest.spyOn(Portfolio.prototype, 'externalHintsAPIDiscovery').mockImplementationOnce(() =>
        // @ts-expect-error test
        Promise.resolve({
          hints
        })
      )

      controller.addTokensToBeLearned(['0xc2132D05D31c914a87C6611C10748AEb04B58e8F'], 137n)

      await controller.updateSelectedAccount(account2.addr, [polygon], undefined)

      const toBeLearnedToken = controller
        .getAccountPortfolioState(account2.addr)
        [
          '137'
        ]?.result?.tokens.find((token) => token.address === '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' && token.amount > 0n)
      expect(toBeLearnedToken).toBeTruthy()

      const key = `${137}:${account2.addr}`

      const previousHintsStorage: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )
      const tokenInLearnedTokens = previousHintsStorage.erc20s?.[key]![toBeLearnedToken!.address]

      expect(tokenInLearnedTokens).toBeTruthy()
    })

    test('Native tokens are fetched for all networks', async () => {
      const { controller, networksCtrl } = await prepareTest()

      await controller.updateSelectedAccount(account.addr)

      networksCtrl.networks.forEach((network) => {
        const nativeToken = controller
          .getAccountPortfolioState(account.addr)
          [
            network.chainId.toString()
          ]?.result?.tokens.find((token) => token.address === ZeroAddress)

        if (!nativeToken) {
          console.error('Native token not found for network:', network.name)
        }

        expect(nativeToken).toBeTruthy()
      })
    })

    test('External API hints are persisted (cached) for 15 minutes', async () => {
      const { controller } = await prepareTest()
      const ethereum = networks.find((network) => network.chainId === 1n)!

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state1 = controller.getAccountPortfolioState(account.addr)?.['1']!

      const lastUpdatedOne = state1.result?.lastExternalApiUpdateData?.lastUpdate

      expect(lastUpdatedOne).toBeGreaterThan(0)

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']!
      expect(state2.result?.lastExternalApiUpdateData?.lastUpdate).toBe(lastUpdatedOne)

      const originalDateNow = Date.now
      // Spy on Date.now and move time 16 minutes forward
      jest.spyOn(Date, 'now').mockImplementation(() => originalDateNow() + 16 * 60 * 1000)

      await controller.updateSelectedAccount(account.addr, [ethereum])
      const state3 = controller.getAccountPortfolioState(account.addr)?.['1']!

      expect(state3.result?.lastExternalApiUpdateData?.lastUpdate).toBeDefined()
      expect(state3.result?.lastExternalApiUpdateData?.lastUpdate).toBeGreaterThan(
        lastUpdatedOne || 0
      )
    })
    test('External API hints are persisted (cached) for 60 minutes on networks with hasHints false', async () => {
      const { controller } = await prepareTest()
      const ethereum = networks.find((network) => network.chainId === 1n)!

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state1 = controller.getAccountPortfolioState(account.addr)?.['1']!

      const lastUpdatedOne = state1.result?.lastExternalApiUpdateData?.lastUpdate

      expect(lastUpdatedOne).toBeGreaterThan(0)

      // Mock hasHints false (e.g. static hints)
      state1.result!.lastExternalApiUpdateData!.hasHints = false

      const originalDateNow = Date.now
      // Spy on Date.now and move time 16 minutes forward
      jest.spyOn(Date, 'now').mockImplementation(() => originalDateNow() + 16 * 60 * 1000)

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']!
      expect(state2.result?.lastExternalApiUpdateData?.lastUpdate).toBe(lastUpdatedOne)

      // Spy on Date.now and move time 16 minutes forward
      jest.spyOn(Date, 'now').mockImplementation(() => originalDateNow() + 61 * 60 * 1000)

      await controller.updateSelectedAccount(account.addr, [ethereum])
      const state3 = controller.getAccountPortfolioState(account.addr)?.['1']!
      expect(state3.result?.lastExternalApiUpdateData?.lastUpdate).toBeDefined()
      expect(state3.result?.lastExternalApiUpdateData?.lastUpdate).toBeGreaterThan(
        lastUpdatedOne || 0
      )
    })
    test("External API hints aren't persisted (cached) on a manual update", async () => {
      const { controller } = await prepareTest()
      const ethereum = networks.find((network) => network.chainId === 1n)!

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state1 = controller.getAccountPortfolioState(account.addr)?.['1']!

      const lastUpdatedOne = state1.result?.lastExternalApiUpdateData?.lastUpdate
      expect(lastUpdatedOne).toBeGreaterThan(0)

      await controller.updateSelectedAccount(account.addr, [ethereum], undefined, {
        isManualUpdate: true
      })

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']!
      expect(state2.result?.lastExternalApiUpdateData?.lastUpdate).toBeGreaterThan(
        lastUpdatedOne || 0
      )
    })
    test('Learned assets are fetched from storage', async () => {
      const STETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'
      const CHAINLINK = '0x514910771af9ca656af840dff83e8264ecf986ca'
      const LILPUDGIS_COLLECTION = getAddress('0x524cab2ec69124574082676e6f654a18df49a048')
      const initialLearnedAssets: LearnedAssets = {
        erc20s: {
          [`${1}:${account.addr}`]: {
            [STETH]: Date.now()
          },
          [`${137}:${account.addr}`]: {
            [STETH]: Date.now()
          },
          [`${137}:${account2.addr}`]: {
            [CHAINLINK]: Date.now()
          }
        },
        erc721s: {
          [`${1}:${account.addr}`]: {
            [`${LILPUDGIS_COLLECTION}:1`]: Date.now()
          }
        }
      }
      const { controller } = await prepareTest({
        initialSetStorage: async (storageCtrl) => {
          await storageCtrl.set('learnedAssets', initialLearnedAssets)
        }
      })

      // @ts-expect-error test
      const allHints = controller.hints.getAllHints(account.addr, 1n)

      expect(allHints.additionalErc20Hints).toContain(STETH)
      expect(allHints.additionalErc20Hints).not.toContain(CHAINLINK)
      expect(allHints.additionalErc721Hints).toHaveProperty(LILPUDGIS_COLLECTION)
    })
    test('Learning ERC-721 nfts works', async () => {
      const { controller, storageCtrl } = await prepareTest()
      const LILPUDGIS_COLLECTION = getAddress('0x524cab2ec69124574082676e6f654a18df49a048')
      const key = `${1}:${account.addr}`
      const ethereum = networks.find(({ chainId }) => chainId === 1n)!
      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state1 = controller.getAccountPortfolioState(account.addr)?.['1']!

      expect(
        state1.result?.collections?.find(({ address }) => address === LILPUDGIS_COLLECTION)
      ).not.toBeDefined()

      // @ts-expect-error test
      await controller.hints.learnNfts([[LILPUDGIS_COLLECTION, [1n, 2n, 3n]]], account.addr, 1n)

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']!

      expect(
        state2.result?.collections?.find(({ address }) => address === LILPUDGIS_COLLECTION)
      ).toBeDefined()

      const learnedInStorage: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )

      if (!learnedInStorage.erc721s[key]) throw new Error('No learned erc721s for the account')

      // Nfts learned by directly calling learnNfts are added to learned in storage, regardless
      // of whether the user has a collectible from the collection or not.
      expect(learnedInStorage.erc721s[key][`${LILPUDGIS_COLLECTION}:1`]).toBeGreaterThan(0)
      expect(learnedInStorage.erc721s[key][`${LILPUDGIS_COLLECTION}:2`]).toBeGreaterThan(0)
      expect(learnedInStorage.erc721s[key][`${LILPUDGIS_COLLECTION}:3`]).toBeGreaterThan(0)
    })
    test('Adding invalid or not checksummed ERC-721 nft to toBeLearned', async () => {
      const { restore } = suppressConsole()
      const INVALID_ADDRESS = '0x524'
      const COLLECTION_ADDRESS = '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270'
      const { controller } = await prepareTest()

      const hasLearned = controller.addErc721sToBeLearned(
        [[INVALID_ADDRESS, [1n]]],
        account.addr,
        1n
      )
      // @ts-expect-error test
      const { specialErc721Hints } = controller.hints.getAllHints(account.addr, 1n)

      expect(hasLearned).toBeFalsy()
      expect(specialErc721Hints).toEqual({
        custom: {},
        hidden: {},
        learn: {}
      })

      const hasLearned2 = controller.addErc721sToBeLearned(
        [[COLLECTION_ADDRESS, [1n, 2n]]],
        account.addr,
        1n
      )
      // @ts-expect-error test
      const { specialErc721Hints: specialErc721Hints2 } = controller.hints.getAllHints(
        account.addr,
        1n
      )

      expect(hasLearned2).toBeTruthy()
      expect(specialErc721Hints2.learn).toEqual({
        [getAddress(COLLECTION_ADDRESS)]: [1n, 2n]
      })
      restore()
    })
    test('The portfolio result is exactly the same when the external API hints fetch is skipped', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(account.addr)
      const tokens1 = Object.values(
        controller.getAccountPortfolioState(account.addr) || {}
      ).flatMap((res) => (res?.result as PortfolioNetworkResult)?.tokens || [])

      const latestHintsUpdate = controller.getAccountPortfolioState(account.addr)['1']?.result
        ?.lastExternalApiUpdateData?.lastUpdate

      expect(latestHintsUpdate).toBeDefined()
      expect(tokens1.length).toBeGreaterThan(0)

      await controller.updateSelectedAccount(account.addr)

      const tokens2 = Object.values(
        controller.getAccountPortfolioState(account.addr) || {}
      ).flatMap((res) => (res?.result as PortfolioNetworkResult)?.tokens || [])

      const latestHintsUpdate2 = controller.getAccountPortfolioState(account.addr)['1']?.result
        ?.lastExternalApiUpdateData?.lastUpdate

      // Filter 0 balance tokens because of pinned
      expect(tokens2.filter(({ amount }) => amount > 0n).length).toBe(
        tokens1.filter(({ amount }) => amount > 0).length
      )
      expect(latestHintsUpdate2).toBe(latestHintsUpdate)
    })
    test('All external API hints with balance are learned', async () => {
      const { controller, storageCtrl } = await prepareTest()
      const ethereum = networks.find(({ chainId }) => chainId === 1n)!

      await controller.updateSelectedAccount(accountWithManyAssets.addr, [ethereum])

      const state1 = controller.getAccountPortfolioState(accountWithManyAssets.addr)?.['1']!
      const learnedAssets: LearnedAssets = await storageCtrl.get(
        'learnedAssets',
        {} as LearnedAssets
      )
      const key = `1:${accountWithManyAssets.addr}`
      const { tokens, collections } = state1.result || {}

      expect(tokens?.length).toBeGreaterThan(0)
      expect(collections?.length).toBeGreaterThan(0)

      tokens
        ?.filter(({ amount }) => amount > 0)
        .forEach(({ address, flags }) => {
          if (address === ZeroAddress) return
          if (flags.defiTokenType) {
            console.warn(`Skipping defi token ${address} from learned assets check`)
            // Defi tokens are learned in a different way. Warning just in case someone debugs
            // this test in the future if the behaviour changes
            return
          }
          expect(learnedAssets.erc20s[key]).toHaveProperty(address)
          // Has a timestamp
          expect(learnedAssets.erc20s[key]![address]).toBeDefined()
        })

      collections?.forEach(({ address, collectibles }) => {
        // Return if the user has no collectibles from this collection as they are not learned
        if (!collectibles.length) return

        collectibles.forEach((id) => {
          const collectibleKey = `${address}:${id.toString()}`

          expect(learnedAssets.erc721s[key]).toHaveProperty(collectibleKey)
          expect(learnedAssets.erc721s[key]![collectibleKey]).toBeGreaterThan(0)
        })
      })
    })
    test('Old learned tokens and learned NFTs (from previousHints) are migrated to the new structure', async () => {
      const ETHX_TOKEN_ADDR = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b'
      const CHAINLINK = '0x514910771af9ca656af840dff83e8264ecf986ca'
      const LILPUDGIS_COLLECTION = '0x524cab2ec69124574082676e6f654a18df49a048'
      const MOONPEPES_COLLECTION = '0x02F74badcE458387ECAef9b1F229afB5678E9AAd'

      const previousHints: PreviousHintsStorage = {
        learnedTokens: {
          '1': {
            [CHAINLINK]: Date.now().toString(),
            [ETHX_TOKEN_ADDR]: null
          }
        },
        learnedNfts: {
          '1': {
            [LILPUDGIS_COLLECTION]: [1n, 2n, 3n],
            [MOONPEPES_COLLECTION]: []
          }
        },
        fromExternalAPI: {}
      }
      const { controller, storageCtrl } = await prepareTest({
        initialSetStorage: async (storage) => {
          await storage.set('previousHints', previousHints)
          await storage.remove('learnedAssets') // Make sure learnedAssets is empty to test the migration logic
        }
      })

      const learnedAssets = await storageCtrl.get('learnedAssets', null)
      expect(learnedAssets).toBe(null)

      // @ts-expect-error test
      const allHints = controller.hints.getAllHints(account.addr, 1n)

      Object.keys(previousHints.learnedTokens['1']!).forEach((addr) => {
        expect(allHints.specialErc20Hints.learn.find((toBeLearned) => addr === toBeLearned))
      })
      Object.keys(previousHints.learnedNfts['1']!).forEach((addr) => {
        expect(allHints.specialErc721Hints.learn).toHaveProperty(addr)
      })

      // Update the portfolio so the assets with balance are learned and
      // expect allHints to no longer return zero balance asset hints
      await controller.updateSelectedAccount(account.addr)

      // @ts-expect-error test
      const allHints2 = controller.hints.getAllHints(account.addr, 1n)

      expect(allHints2.specialErc20Hints.learn.length).toBe(0)
      expect(Object.keys(allHints2.specialErc721Hints.learn).length).toBe(0)
    })
    test('Learned assets from view-only account are not returned', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest({
        initialSetStorage: async (storageController) => {
          await storageController.set('learnedAssets', learnedAssets)
          // Get rid of the second account's key (to make it view-only)
          await storageController.set('keystoreKeys', getKeystoreKeys().slice(0, 1))
        }
      })

      // @ts-expect-error test
      const hints = controller.hints.getAllHints(account.addr, 1n, undefined, true)
      const key = `${1n}:${account.addr}`

      expect(hints.additionalErc20Hints).toEqual(Object.keys(learnedAssets.erc20s[key]!))
      expect(hints.additionalErc721Hints).toEqual(
        learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {}))
      )
    })
    test('Learned assets from other imported accounts are not returned if the update is not manual', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest({
        initialSetStorage: async (storageController) => {
          await storageController.set('learnedAssets', learnedAssets)
          // Get rid of the second account's key (to make it view-only)
          await storageController.set('keystoreKeys', getKeystoreKeys())
        }
      })

      // @ts-expect-error test
      const hints = controller.hints.getAllHints(account.addr, 1n)
      const key = `${1n}:${account.addr}`

      expect(hints.additionalErc20Hints).toEqual(Object.keys(learnedAssets.erc20s[key]!))
      expect(hints.additionalErc721Hints).toEqual(
        learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {}))
      )
    })
    test('Learned assets are added from other imported accounts on a manual update', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest({
        initialSetStorage: async (storageController) => {
          await storageController.set('learnedAssets', learnedAssets)
          // Get rid of the second account's key (to make it view-only)
          await storageController.set('keystoreKeys', getKeystoreKeys())
        }
      })

      // @ts-expect-error test
      const hints = controller.hints.getAllHints(account.addr, 1n, undefined, true)
      const key = `${1n}:${account.addr}`
      const key2 = `${1n}:${account2.addr}`

      expect(hints.additionalErc20Hints).toEqual([
        ...Object.keys(learnedAssets.erc20s[key]!),
        ...Object.keys(learnedAssets.erc20s[key2]!)
      ])
      const firstNftAddr = Object.keys(learnedAssets.erc721s[key]!)[0]!.split(':')[0]!
      expect(hints.additionalErc721Hints).toEqual({
        ...learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {})),
        ...learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key2] || {})),
        [firstNftAddr]: [1n, 2n, 3n, 10n, 11n, 12n]
      })

      // Collectibles are merged correctly for the same collection
      expect(hints.additionalErc721Hints[firstNftAddr]).toHaveLength(6)
    })
  })

  describe('Defi positions', () => {
    const ethereum = networks.find((n) => n.chainId === 1n)!

    const getDefiAppsResponse = () => ({
      networkId: 'customAppChain',
      chainId: 'customAppChain',
      accountAddr: account.addr,
      erc20s: [],
      erc721s: {},
      hasHints: true,
      prices: {},
      lastUpdate: Date.now(),
      defi: {
        positions: [
          {
            providerName: 'Polymarket',
            iconUrl:
              'https://static.debank.com/image/project/logo_url/app_polymarket/265aca8cef9212e094ef24c71a01c175.png',
            siteUrl: 'https://polymarket.com/',
            type: 'Deposit',
            positions: [
              {
                id: '87f34311-e915-48c7-b51f-f5e92dc4ea39',
                assets: [
                  {
                    id: 'be0eecf639f4e6a57e375123e46ed7b4',
                    name: 'USDC',
                    symbol: 'USDC',
                    decimals: 6,
                    logo_url:
                      'https://static.debank.com/image/app_token/logo_url/polymarket/fc98c076b66fa798bcd8755cd859032e.png',
                    app_id: 'polymarket',
                    price: 0.999500249875063,
                    amount: 64.230076,
                    type: 1,
                    value: 64.1979770114943
                  }
                ],
                additionalData: {
                  positionInUSD: 64.1979770114943,
                  collateralInUSD: 64.1979770114943,
                  positionIndex: 'cash_0xb78006ab9f2acfb90834c16b321eeb5008123393',
                  name: 'Deposit',
                  detailTypes: ['common'],
                  updateAt: 1776933578.75451,
                  position_index: 'cash_0xb78006ab9f2acfb90834c16b321eeb5008123393'
                }
              }
            ],
            positionInUSD: 64.1979770114943
          }
        ],
        updatedAt: Date.now()
      },
      otherNetworksDefiCounts: {}
    })

    beforeEach(() => {
      jest.restoreAllMocks()
      jest.clearAllMocks()
    })
    it('should update positions correctly', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      expect(result?.defiPositions.lastSuccessfulUpdate).toBeDefined()
      expect(result?.defiPositions.positionsByProvider.length).toBeGreaterThan(0)
    })

    it('should handle errors in update positions', async () => {
      const consoleSuppressor = suppressConsole()
      jest.spyOn(defiProviders, 'getAAVEPositions').mockImplementation(
        () =>
          new Promise((_, reject) => {
            reject(new Error('AAVE error'))
          })
      )
      jest.spyOn(defiProviders, 'getDebankEnhancedUniV3Positions').mockImplementation(
        () =>
          new Promise((_, reject) => {
            reject(new Error('Uniswap error'))
          })
      )
      const { controller } = await prepareTest()
      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      expect(result?.defiPositions.providerErrors).toEqual([
        { providerName: 'AAVE v3', error: 'AAVE error' },
        { providerName: 'Uniswap V3', error: 'Uniswap error' }
      ])

      consoleSuppressor.restore()
    })

    it('should set asset prices correctly', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      const positions = result?.defiPositions.positionsByProvider!
      expect(positions.length).toBeGreaterThan(0)
      positions.forEach((provider) => {
        provider.positions.forEach((position) => {
          position.assets.forEach((asset) => {
            expect(asset.value).toBeDefined()
            expect(asset.priceIn).toEqual({ baseCurrency: 'usd', price: expect.any(Number) })
          })
        })
      })
    })

    it('should update networksWithPositionsByAccounts properly', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const networksWithPositions = controller.getNetworksWithDefiPositions(DEFI_TEST_ACCOUNT.addr)

      expect(networksWithPositions['1']).toContain('AAVE v3')
    })
    it('should handle provider error and empty state for networksWithPositionsByAccounts', async () => {
      const consoleSuppressor = suppressConsole()

      jest.spyOn(defiProviders, 'getAAVEPositions').mockImplementation(
        () =>
          new Promise((_, reject) => {
            reject(new Error('AAVE error'))
          })
      )
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      expect(result?.defiPositions.providerErrors!.length).toBeGreaterThan(0)

      const networksWithPositions = controller.getNetworksWithDefiPositions(DEFI_TEST_ACCOUNT.addr)

      // Undefined because there is a provider has an error, so we
      // can't be certain if the account has positions on that network
      expect(networksWithPositions['137']).toBeUndefined()
      expect(networksWithPositions['1']).toBeUndefined()

      consoleSuppressor.restore()
    })

    it('should add a critical defi error if the portfolio discovery fails, despite custom positions being fetched properly', async () => {
      const { restore } = suppressConsole()
      const { controller } = await prepareTest()

      jest
        // @ts-expect-error test
        .spyOn(controller, 'batchedPortfolioDiscovery')
        // @ts-expect-error test
        .mockRejectedValue(new Error('Portfolio discovery failed'))

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const state = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']
      const result = state!.result

      expect(result?.defiPositions.error).toBe(DeFiPositionsError.CriticalError)
      expect(state?.errors.length).toBeGreaterThan(0)
      // Custom positions are still fetched and present
      expect(result?.defiPositions.positionsByProvider.length).toBeGreaterThan(0)

      restore()
    })

    it('uniswap v3 positions are added from the discovery and enhanced with custom positions', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const state = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']

      const uniswapV3Positions = state?.result?.defiPositions.positionsByProvider.find(
        (p) => p.providerName === 'Uniswap V3'
      )

      expect(uniswapV3Positions).toBeDefined()
      expect(uniswapV3Positions!.positions.length).toBeGreaterThan(0)

      uniswapV3Positions!.positions.forEach((position) => {
        expect(position.additionalData.positionIndex).toBeDefined()
      })

      // It's not guaranteed that all positions will have inRange defined, but only in the tests
      // That is because the call to debank returns static data that is defined below. If the position
      // no longer exists, deployless will not return it and there is no way for it to be inRange
      // It's enough for us to check that one is being enhanced with the custom data
      expect(
        uniswapV3Positions?.positions.some((p) => typeof p.additionalData.inRange === 'boolean')
      ).toBe(true)
    })
    it('aave v3 is coming from custom positions', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      const aaveV3Positions = result?.defiPositions.positionsByProvider.find(
        (p) => getProviderId(p.providerName) === 'aave v3'
      )

      expect(aaveV3Positions).toBeDefined()
      expect(aaveV3Positions!.positions.length).toBeGreaterThan(0)
      expect(aaveV3Positions!.source).toBe('custom')
      aaveV3Positions!.positions.forEach((position) => {
        expect(position.additionalData.healthRate).toBeDefined()
      })
    })

    it('portfolio discovery critical error is prioritized over price errors', async () => {
      const { restore } = suppressConsole()

      jest
        .spyOn(defiPricesLib, 'updatePositionsByProviderAssetPrices')
        .mockImplementationOnce(async () => {
          throw new Error('Asset price error')
        })

      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      expect(result?.defiPositions.error).toBe(DeFiPositionsError.AssetPriceError)

      jest
        // @ts-expect-error test
        .spyOn(controller, 'batchedPortfolioDiscovery')
        // @ts-expect-error test
        .mockRejectedValue(new Error('Portfolio discovery failed'))

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum], undefined, {
        defiMaxDataAgeMs: 0
      })

      const result2 = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      expect(result2?.defiPositions.error).toBe(DeFiPositionsError.CriticalError)
      restore()
    })

    it('custom positions are persisted after a failure', async () => {
      const { restore } = suppressConsole()
      const spy = jest.spyOn(defiProviders, 'getAAVEPositions')

      const { controller } = await prepareTest()

      // First, do a successful update to have positions stored
      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      const hasPosition = result?.defiPositions.positionsByProvider.some(
        (p) => getProviderId(p.providerName) === 'aave v3'
      )

      expect(hasPosition).toBe(true)

      // Mock getAAVEPositions to throw
      spy.mockImplementation(
        () =>
          new Promise((_, reject) => {
            reject(new Error('AAVE error'))
          })
      )

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum], undefined, {
        defiMaxDataAgeMs: 0,
        isManualUpdate: true
      })

      const result2 = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result!

      const hasPosition2 = result2?.defiPositions.positionsByProvider.some(
        (p) => getProviderId(p.providerName) === 'aave v3'
      )

      expect(hasPosition2).toBe(true)

      expect(result2.defiPositions.providerErrors).toBeDefined()
      expect(result2.defiPositions.providerErrors?.length).toBeGreaterThan(0)

      restore()
    })

    it('positions from portfolio discovery are persisted after a call failure', async () => {
      const { restore } = suppressConsole()

      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])

      const result = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result

      const hasDebankPositions = result?.defiPositions.positionsByProvider.some(
        (p) => p.source === 'debank'
      )
      expect(hasDebankPositions).toBe(true)

      jest
        // @ts-expect-error test
        .spyOn(controller, 'batchedPortfolioDiscovery')
        // @ts-expect-error test
        .mockRejectedValue(new Error('Portfolio discovery failed'))

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum], undefined, {
        defiMaxDataAgeMs: 0,
        isManualUpdate: true
      })
      const state2 = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']
      const result2 = state2!.result!

      const hasDebankPositions2 = result2.defiPositions.positionsByProvider.some(
        (p) => p.source === 'debank'
      )
      expect(hasDebankPositions2).toBe(true)

      expect(result2.defiPositions.error).toBe(DeFiPositionsError.CriticalError)
      expect(state2!.errors.length).toBeGreaterThan(0)
      restore()
    })

    it("Uniswap V3 shouldn't lose its API enhancement (e.g. rewards) when the discovery call is skipped", async () => {
      const { controller } = await prepareTest()

      // A formatted discovery response carrying a Debank Uniswap V3 entry. It's mocked rather than
      // relying on the live API, since Debank's coverage of a given account varies over time.
      const discoveryWithDebankUniV3 = {
        data: {
          defi: {
            updatedAt: Date.now(),
            isForceUpdate: false,
            positions: [
              {
                providerName: 'Uniswap V3',
                chainId: 1n,
                source: 'debank' as const,
                iconUrl: '',
                siteUrl: 'https://app.uniswap.org',
                type: 'common' as const,
                positions: [
                  {
                    id: 'debank-uni-v3-eth',
                    assets: [
                      {
                        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                        symbol: 'WETH',
                        name: 'Wrapped Ether',
                        decimals: 18,
                        amount: 1000000000000000000n,
                        priceIn: { price: 3000, baseCurrency: 'usd' },
                        value: 3000,
                        type: AssetType.Liquidity,
                        iconUrl: ''
                      }
                    ],
                    additionalData: { positionIndex: 'debank-uni-v3-eth', name: 'Liquidity Pool' }
                  }
                ],
                positionInUSD: 3000
              }
            ]
          },
          hints: null,
          otherNetworksDefiCounts: {}
        },
        discoveryTime: 1,
        errors: []
      }

      // @ts-expect-error - getPortfolioFromApiDiscovery is private, spied on at runtime
      const discoverySpy: any = jest.spyOn(controller, 'getPortfolioFromApiDiscovery')
      // First update: the custom (deployless) position is enhanced with the Debank entry (source: 'mixed')
      discoverySpy.mockResolvedValueOnce(discoveryWithDebankUniV3)
      // Second update: a skipped discovery returns null. This is a routine occurrence (the data is
      // still fresh) and is NOT a failure.
      discoverySpy.mockResolvedValueOnce(null)

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum])
      const firstResult = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result
      const uniBeforeSkip = firstResult?.defiPositions.positionsByProvider.find(
        (p) => getProviderId(p.providerName) === 'uniswap v3'
      )

      // Check before updating again to ensure it's mixed
      expect(uniBeforeSkip?.source).toBe('mixed')

      await controller.updateSelectedAccount(DEFI_TEST_ACCOUNT.addr, [ethereum], undefined, {
        defiMaxDataAgeMs: 0,
        isManualUpdate: true
      })

      const secondResult = controller.getAccountPortfolioState(DEFI_TEST_ACCOUNT.addr)['1']!.result
      const uniAfterSkip = secondResult?.defiPositions.positionsByProvider.find(
        (p) => getProviderId(p.providerName) === 'uniswap v3'
      )

      // MUST BE MIXED!!!!!
      expect(uniAfterSkip?.source).toBe('mixed')
    })

    describe('Defi apps', () => {
      it('should skip update if canSkipUpdate=true', async () => {
        const { controller } = await prepareTest()
        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockResolvedValue(getDefiAppsResponse())

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: false
        })

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: false
        })

        expect(discoverySpy).toHaveBeenCalledTimes(1)
      })

      it('should bypass skip and re-fetch on manual update', async () => {
        const { controller } = await prepareTest()
        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockResolvedValue(getDefiAppsResponse())

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: false
        })

        const firstUpdateStarted =
          controller.getAccountPortfolioState(account.addr).defiApps?.result?.updateStarted || 0

        await wait(5)

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: true
        })

        const secondUpdateStarted =
          controller.getAccountPortfolioState(account.addr).defiApps?.result?.updateStarted || 0

        expect(discoverySpy).toHaveBeenCalledTimes(2)
        expect(secondUpdateStarted).toBeGreaterThan(firstUpdateStarted)
      })

      it('should persist app positions under defiApps with no chainId and empty tokens', async () => {
        const { controller } = await prepareTest()

        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockResolvedValue(getDefiAppsResponse())

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 0,
          hasKeys: true,
          isManualUpdate: false
        })

        const state = controller.getAccountPortfolioState(account.addr).defiApps
        const positionsByProvider = state?.result?.defiPositions.positionsByProvider || []
        const firstProvider = positionsByProvider[0]
        const firstAsset = firstProvider?.positions[0]?.assets[0]

        expect(state?.isReady).toBe(true)
        expect(state?.isLoading).toBe(false)
        expect(state?.result?.tokens).toEqual([])
        expect(firstProvider?.chainId).toBeUndefined()
        expect(firstAsset?.address).toBe(undefined)
      })

      it('should set criticalError on discovery failure', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareTest()

        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockRejectedValue(new Error('Defi apps failure'))

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 0,
          hasKeys: true,
          isManualUpdate: false
        })

        const state = controller.getAccountPortfolioState(account.addr).defiApps

        expect(state?.isLoading).toBe(false)
        expect(state?.criticalError?.message).toContain('Defi apps failure')
        restore()
      })

      it('should handle external API errorState responses', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareTest()

        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockResolvedValue({
          defi: {
            success: false,
            errorState: [{ message: 'Velcro app error', level: 'fatal' }]
          }
        })

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 0,
          hasKeys: true,
          isManualUpdate: false
        })

        const state = controller.getAccountPortfolioState(account.addr).defiApps

        expect(state?.isLoading).toBe(false)
        expect(state?.criticalError?.message).toContain('Velcro app error')
        restore()
      })

      it('should not skip update when previous defiApps state has a criticalError', async () => {
        const { restore } = suppressConsole()
        const { controller } = await prepareTest()
        // @ts-expect-error test
        const discoverySpy: any = jest.spyOn(controller, 'batchedPortfolioDiscovery')
        discoverySpy.mockRejectedValueOnce(new Error('first call fails'))
        discoverySpy.mockResolvedValueOnce(getDefiAppsResponse())

        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: false
        })

        // Should not be skipped despite maxDataAgeMs, because state.criticalError is set
        // @ts-expect-error test
        await controller.updateDefiAppsState(account, {
          defiMaxDataAgeMs: 60 * 1000,
          hasKeys: true,
          isManualUpdate: false
        })

        const state = controller.getAccountPortfolioState(account.addr).defiApps

        expect(discoverySpy).toHaveBeenCalledTimes(2)
        expect(state?.criticalError).toBeUndefined()
        expect(state?.isReady).toBe(true)
        restore()
      })
    })
  })

  test('Check Token Validity - erc20, erc1155', async () => {
    const { restore } = suppressConsole()
    const { controller } = await prepareTest()
    const token = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      chainId: 1n
    }
    const tokenERC1155 = {
      address: '0xEBba467eCB6b21239178033189CeAE27CA12EaDf',
      chainId: 42161n
    }

    await controller.updateTokenValidationByStandard(token, account.addr)
    await controller.updateTokenValidationByStandard(tokenERC1155, account.addr)

    controller.onUpdate(() => {
      const tokenIsValid =
        controller.validTokens.erc20[`${token.address}-${token.chainId}`]?.isValid === true
      const tokenIsNotValid =
        controller.validTokens.erc20[`${tokenERC1155.address}-${tokenERC1155.chainId}`]?.isValid ===
        false
      expect(tokenIsNotValid).toBeFalsy()
      expect(tokenIsValid).toBeTruthy()
    })

    restore()
  })

  test('Add and remove custom token', async () => {
    const { controller } = await prepareTest()

    const customToken = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      chainId: 1n,
      standard: 'ERC20'
    } as const

    await controller.addCustomToken(customToken, account.addr, true)

    const tokenIsSet = controller.customTokens.find(
      (token) => token.address === customToken.address && token.chainId === customToken.chainId
    )

    const getCustomTokenFromPortfolio = () => {
      return controller
        .getAccountPortfolioState(account.addr)
        [
          '1'
        ]?.result?.tokens.find((token) => token.address === customToken.address && token.chainId === customToken.chainId)
    }

    expect(tokenIsSet).toEqual(customToken)
    expect(getCustomTokenFromPortfolio()).toBeTruthy()

    await controller.removeCustomToken(customToken, account.addr, true)

    const tokenIsRemoved = controller.customTokens.find(
      (token) => token.address === customToken.address && token.chainId === customToken.chainId
    )
    expect(tokenIsRemoved).toBeFalsy()
    expect(getCustomTokenFromPortfolio()).toBeFalsy()
  })

  test('Cannot add the same custom token twice', async () => {
    const { controller } = await prepareTest()
    const customToken = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      chainId: 1n,
      standard: 'ERC20'
    } as const

    await controller.addCustomToken(customToken, account.addr)

    const tokenIsSet = controller.customTokens.find(
      (token) => token.address === customToken.address && token.chainId === customToken.chainId
    )

    expect(tokenIsSet).toEqual(customToken)

    await controller.addCustomToken(
      {
        ...customToken,
        address: customToken.address.toLowerCase()
      },
      account.addr
    )

    const matchingTokens = controller.customTokens.filter(
      (token) =>
        token.address.toLowerCase() === customToken.address.toLowerCase() &&
        token.chainId === customToken.chainId
    )

    expect(matchingTokens.length).toBe(1)
  })

  test('Update Token Preferences - hide a token and portfolio returns isHidden flag', async () => {
    const { controller } = await prepareTest()

    const preference = {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1n
    }

    await controller.toggleHideToken(preference, account.addr, true)

    const hiddenToken = controller
      .getAccountPortfolioState(account.addr)
      [
        '1'
      ]?.result?.tokens.find((token) => token.address === preference.address && token.chainId === preference.chainId && token.flags.isHidden)
    expect(hiddenToken).toBeTruthy()
  })
  test('Calling toggleHideToken a second time deletes the preference', async () => {
    const { controller } = await prepareTest()

    const preference = {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1n
    }

    await controller.toggleHideToken(preference, account.addr)

    const tokenInPreferences = controller.tokenPreferences.find(
      ({ address, chainId }) => address === preference.address && chainId === preference.chainId
    )

    expect(tokenInPreferences).toBeTruthy()
    expect(tokenInPreferences?.isHidden).toBeTruthy()

    await controller.toggleHideToken(preference, account.addr)

    const tokenInPreferencesAfterDelete = controller.tokenPreferences.find(
      ({ address, chainId }) => address === preference.address && chainId === preference.chainId
    )

    expect(tokenInPreferencesAfterDelete).toBeFalsy()
  })
  test('lastSuccessfulUpdate is updated properly', async () => {
    const { restore } = suppressConsole()
    const { controller } = await prepareTest()
    const ethereum = [networks.find((n) => n.chainId === 1n)!]

    await controller.updateSelectedAccount(account.addr, ethereum)

    const lastSuccessfulUpdate = controller.getAccountPortfolioState(account.addr)['1']
      ?.lastSuccessfulUpdate

    expect(lastSuccessfulUpdate).toBeTruthy()

    jest
      .spyOn(Portfolio.prototype, 'get')
      // Mock an error twice
      .mockRejectedValueOnce(new Error('Simulated error'))

    await controller.updateSelectedAccount(account.addr, ethereum)
    const lastSuccessfulUpdate2 = controller.getAccountPortfolioState(account.addr)['1']
      ?.lastSuccessfulUpdate

    // Last successful update should not change if the update fails
    expect(lastSuccessfulUpdate2).toEqual(lastSuccessfulUpdate)

    jest
      .spyOn(Portfolio.prototype, 'get')
      // Mock an error twice
      .mockRejectedValueOnce(new Error('Simulated error'))

    // Set maxDataAgeMs to 0 (simulate a manual update), which should reset lastSuccessfulUpdate to 0
    await controller.updateSelectedAccount(account.addr, ethereum, undefined, {
      isManualUpdate: true
    })

    const lastSuccessfulUpdate3 = controller.getAccountPortfolioState(account.addr)['1']
      ?.lastSuccessfulUpdate
    // Last successful update should reset on a manual update (passing maxDataAgeMs: 0)
    expect(lastSuccessfulUpdate2).not.toEqual(lastSuccessfulUpdate3)
    expect(lastSuccessfulUpdate3).toBe(0)

    restore()
  })
  it('Price cache is updated after portfolio discovery', async () => {
    const { controller } = await prepareTest()

    // Make the test deterministic: we only want to verify that discovery prices
    // populate the controller cache, not that the external API is reachable.
    // @ts-expect-error test
    controller.batchedPortfolioDiscovery = jest.fn().mockResolvedValue({
      networkId: '137',
      chainId: 137,
      accountAddr: account.addr,
      erc20s: [],
      erc721s: {},
      hasHints: true,
      prices: {
        '0x0000000000000000000000000000000000000000': {
          baseCurrency: 'usd',
          price: 1,
          usd_24h_change: 0,
          usd_market_cap: 1,
          usd_24h_vol: 1,
          exchanges: []
        }
      },
      lastUpdate: Date.now(),
      defi: {
        positions: [],
        updatedAt: Date.now()
      },
      otherNetworksDefiCounts: {}
    })

    // @ts-expect-error test
    expect(controller.tokenDataCache['137']).toBe(undefined)

    jest
      // @ts-expect-error test
      .spyOn(controller, 'batchedPortfolioDiscovery')
      // @ts-expect-error test
      .mockResolvedValueOnce({
        networkId: 'polygon',
        chainId: 137,
        accountAddr: account.addr,
        erc20s: [ZeroAddress],
        erc721s: {},
        prices: {
          [ZeroAddress]: {
            baseCurrency: 'usd',
            price: 1
          }
        },
        hasHints: true,
        defi: {
          updatedAt: Date.now(),
          positions: []
        },
        otherNetworksDefiCounts: {}
      })

    // @ts-expect-error test
    await controller.getPortfolioFromApiDiscovery({
      chainId: 137n,
      account,
      hasKeys: true,
      baseCurrency: 'usd',
      externalApiHintsResponse: null
    })

    // @ts-expect-error test
    expect(controller.tokenDataCache['137']).toBeDefined()
    // @ts-expect-error test
    expect(controller.tokenDataCache['137'].size).toBeGreaterThan(0)
  })
  it('A defi error is not returned if canSkipDefiUpdate=true', async () => {
    const { restore } = suppressConsole()

    const { controller } = await prepareTest()
    const ethereum = networks.find((n) => n.chainId === 1n)!

    await controller.updateSelectedAccount(account.addr, [ethereum])

    jest
      // @ts-expect-error test
      .spyOn(controller, 'batchedPortfolioDiscovery')
      // @ts-expect-error test
      .mockRejectedValue(new Error('Velcro error'))

    // @ts-expect-error test
    const formatted = await controller.getPortfolioFromApiDiscovery({
      chainId: 1n,
      account,
      hasKeys: true,
      baseCurrency: 'usd',
      defiMaxDataAgeMs: 6000000,
      isManualUpdate: false
    })

    if (!formatted) throw new Error('Portfolio API Discovery response should not be null')

    expect(formatted.errors.length).toBe(1)
    expect(formatted.errors[0]!.name).toBe(PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError)
    expect(formatted.data).toBe(null)
    restore()
  })
  it('A defi error is returned if canSkipDefiUpdate=false', async () => {
    const { restore } = suppressConsole()
    const { controller } = await prepareTest()

    jest
      // @ts-expect-error test
      .spyOn(controller, 'batchedPortfolioDiscovery')
      // @ts-expect-error test
      .mockRejectedValue(new Error('Velcro error'))

    // @ts-expect-error test
    const formatted = await controller.getPortfolioFromApiDiscovery({
      chainId: 1n,
      account,
      hasKeys: true,
      baseCurrency: 'usd',
      defiMaxDataAgeMs: 6000000,
      isManualUpdate: false
    })

    if (!formatted) throw new Error('Portfolio API Discovery response should not be null')

    expect(formatted.errors.length).toBe(2)
    expect(formatted.data).toBe(null)
    restore()
  })
  it('A hints error is not added if canSkipExternalApiHintsUpdate=true', async () => {
    const { restore } = suppressConsole()
    const { controller } = await prepareTest()

    jest
      // @ts-expect-error test
      .spyOn(controller, 'batchedPortfolioDiscovery')
      // @ts-expect-error test
      .mockRejectedValue(new Error('Velcro error'))

    // @ts-expect-error test
    const formatted = await controller.getPortfolioFromApiDiscovery({
      chainId: 1n,
      account,
      hasKeys: true,
      baseCurrency: 'usd',
      defiMaxDataAgeMs: 6000000,
      isManualUpdate: false,
      externalApiHintsResponse: {
        lastUpdate: Date.now(),
        hasHints: true
      }
    })

    if (!formatted) throw new Error('Portfolio API Discovery response should not be null')

    expect(formatted.errors.length).toBe(1)
    expect(formatted.errors[0]!.name).toBe(PORTFOLIO_LIB_ERROR_NAMES.DefiDiscoveryError)
    expect(formatted.data).toBe(null)
    restore()
  })
  test('removeAccountData', async () => {
    const { controller } = await prepareTest()
    await controller.updateSelectedAccount(account.addr)
    await controller.updateSelectedAccount(account.addr)
    const hasItems = (obj: any) => !!Object.keys(obj).length

    expect(hasItems(controller.getAccountPortfolioState(account.addr))).toBeTruthy()
    expect(hasItems(controller.getAccountPortfolioState(account.addr))).toBeTruthy()
    expect(controller.getNetworksWithAssets(account.addr).length).not.toEqual(0)

    controller.removeAccountData(account.addr)

    expect(hasItems(controller.getAccountPortfolioState(account.addr))).not.toBeTruthy()
    expect(hasItems(controller.getAccountPortfolioState(account.addr))).not.toBeTruthy()
    expect(Object.keys(controller.getNetworksWithAssets(account.addr)).length).toEqual(0)
  })
  test('should do a request with a simulation; then a second request without the simulation should come and it should not be allowed to persist', async () => {
    const { controller, accountsCtrl } = await prepareTest()
    // We need account state for the simulation to be persisted
    await accountsCtrl.updateAccountState(account.addr, 'latest', [1n])
    const ethereum = networks.find((n) => n.chainId === 1n)!
    const accountOpsOnEthereum = await getAccountOp()
    const accountStates = await getAccountsInfo([account])

    // update and persist the simulation
    await controller.updateSelectedAccount(account.addr, [ethereum], {
      accountOps: accountOpsOnEthereum,
      states: accountStates[account.addr]!
    })
    // make sure the simulation is there
    const hasItems = (obj: any) => !!Object.keys(obj).length
    const portfolioState = controller.getAccountPortfolioState(account.addr)
    expect(hasItems(portfolioState)).toBeTruthy()
    expect(portfolioState['1']).not.toBe(undefined)
    const ethereumPortfolioState = portfolioState['1']!
    expect(ethereumPortfolioState.accountOps).not.toBe(undefined)
    expect(ethereumPortfolioState.accountOps).not.toBe(null)
    expect(ethereumPortfolioState.accountOps).toStrictEqual(accountOpsOnEthereum['1'])

    // update the selected account again and make sure this
    // request doesn't get persisted
    await controller.updateSelectedAccount(account.addr, [ethereum], undefined, {
      isManualUpdate: true
    })
    const newPortfolioState = controller.getAccountPortfolioState(account.addr)
    expect(hasItems(newPortfolioState)).toBeTruthy()
    expect(newPortfolioState['1']).not.toBe(undefined)
    const newEthereumPortfolioState = newPortfolioState['1']!
    expect(newEthereumPortfolioState.accountOps).not.toBe(undefined)
    expect(newEthereumPortfolioState.accountOps).not.toBe(null)
    expect(newEthereumPortfolioState.accountOps).toStrictEqual(accountOpsOnEthereum['1'])
  })

  describe('Blacklisting', () => {
    const mockBlacklistResponse = {
      success: true,
      blacklistAddrs: {
        '1': ['0x956f824b5a37673c6fc4a6904186cb3ba499349b'],
        '10': ['0x0B91B07bEb67333225A5bA0259D55AeE10E3A578'],
        '137': ['0x0b91b07beb67333225a5ba0259d55aee10e3a578']
      },
      blacklistBySymbols: [
        'visit to',
        'claim bonus',
        'free claim',
        'visit',
        'claim your special rewards',
        'thefork',
        'claim'
      ],
      updatedAt: Date.now()
    }

    const BLACKLIST_URL = 'https://cena.ambire.com/api/v3/tokens/black-list'

    const createJsonResponse = (body: unknown, ok = true, statusText = 'OK') => ({
      ok,
      statusText,
      json: () => Promise.resolve(body)
    })

    const createBlacklistFetchOverride = (
      handler: (
        url: string,
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => any
    ) =>
      jest.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === 'string' ? input : input.toString()

        if (url === BLACKLIST_URL) return handler(url, input, init)

        return fetch(input as any, init as any)
      }) as unknown as typeof fetch

    const waitForBlacklist = async (
      controller: PortfolioController,
      advanceTime?: (ms: number) => Promise<void>
    ) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        // @ts-expect-error test - access private getter
        const blacklist = controller.blacklist
        if (!blacklist.isLoading && blacklist.updatedAt) return blacklist

        if (advanceTime) {
          await advanceTime(25)
        } else {
          await wait(25)
        }
      }

      // @ts-expect-error test - access private getter
      return controller.blacklist
    }

    const wasBlacklistFetched = (fetchOverride: typeof fetch) => {
      const calls = (fetchOverride as unknown as jest.Mock).mock.calls as [unknown, unknown?][]

      return calls.some(([url]) => url === BLACKLIST_URL)
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should fetch blacklist from API successfully', async () => {
      const { restore } = suppressConsole()
      const fetchOverride = createBlacklistFetchOverride(() =>
        Promise.resolve(
          createJsonResponse({
            ...mockBlacklistResponse,
            blacklistAddrs: {
              ...mockBlacklistResponse.blacklistAddrs,
              '42161': ['bad-address', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831']
            }
          })
        )
      )

      const { controller, storageCtrl } = await prepareTest({
        fetchOverride,
        skipBlacklistFetch: false,
        awaitInitialLoad: false
      })
      const blacklist = await waitForBlacklist(controller)
      const storedBlacklist = await storageCtrl.get('tokenBlacklist', null)

      expect(wasBlacklistFetched(fetchOverride)).toBe(true)
      expect(blacklist).toEqual({
        blacklistAddrs: {
          '1': [getAddress(mockBlacklistResponse.blacklistAddrs['1'][0]!)],
          '10': [getAddress(mockBlacklistResponse.blacklistAddrs['10'][0]!)],
          '137': [getAddress(mockBlacklistResponse.blacklistAddrs['137'][0]!)],
          // Bad address should be filtered out
          '42161': [getAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')]
        },
        blacklistBySymbols: mockBlacklistResponse.blacklistBySymbols,
        updatedAt: expect.any(Number),
        isLoading: false
      })
      expect(storedBlacklist).toEqual({
        blacklistAddrs: blacklist.blacklistAddrs,
        blacklistBySymbols: blacklist.blacklistBySymbols,
        updatedAt: blacklist.updatedAt
      })
      restore()
    })

    test('should not persist blacklist when the API does not work at all', async () => {
      const { restore } = suppressConsole()
      const fetchOverride = createBlacklistFetchOverride(() =>
        Promise.reject(new Error('blacklist unavailable'))
      )

      const { storageCtrl } = await prepareTest({
        fetchOverride,
        skipBlacklistFetch: false,
        awaitInitialLoad: false
      })

      expect(wasBlacklistFetched(fetchOverride)).toBe(true)
      expect(await storageCtrl.get('tokenBlacklist', null)).toBeNull()
      restore()
    })

    test('should keep cached blacklist if refresh fails during initialization', async () => {
      const { restore } = suppressConsole()
      const staleCachedBlacklist = {
        blacklistAddrs: { '1': [getAddress(mockBlacklistResponse.blacklistAddrs['1'][0]!)] },
        blacklistBySymbols: ['claim'],
        updatedAt: Date.now() - BLACKLIST_UPDATE_INTERVAL - 60 * 1000
      }
      const fetchOverride = createBlacklistFetchOverride(() =>
        Promise.reject(new Error('refresh failed'))
      )

      const { controller, storageCtrl } = await prepareTest({
        fetchOverride,
        initialSetStorage: async (storageCtrlInner) => {
          await storageCtrlInner.set('tokenBlacklist', staleCachedBlacklist)
        },
        skipBlacklistFetch: false,
        awaitInitialLoad: false
      })

      expect(wasBlacklistFetched(fetchOverride)).toBe(true)
      // @ts-expect-error test - access private getter
      expect(controller.blacklist).toEqual({ ...staleCachedBlacklist, isLoading: false })
      expect(await storageCtrl.get('tokenBlacklist', null)).toEqual(staleCachedBlacklist)
      restore()
    })

    test('should recover when the API fails on the first try and succeeds on the next try', async () => {
      const { restore } = suppressConsole()
      jest.useFakeTimers()

      try {
        let call = 0
        const fetchOverride = createBlacklistFetchOverride(() => {
          if (call === 0) {
            call++
            return Promise.reject(new Error('blacklist unavailable'))
          }

          return Promise.resolve(createJsonResponse(mockBlacklistResponse))
        })
        const { controller, storageCtrl } = await prepareTest({
          fetchOverride,
          skipBlacklistFetch: false,
          awaitInitialLoad: false
        })

        expect(await storageCtrl.get('tokenBlacklist', null)).toBeNull()

        // Advance time by 5 minutes to trigger the retry (controller retries after 5 minutes on initial failure)
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000)

        const blacklist = await waitForBlacklist(controller, (ms) =>
          jest.advanceTimersByTimeAsync(ms)
        )
        const storedBlacklist = await storageCtrl.get('tokenBlacklist', null)

        expect(wasBlacklistFetched(fetchOverride)).toBe(true)
        expect(blacklist).toEqual({
          blacklistAddrs: {
            '1': [getAddress(mockBlacklistResponse.blacklistAddrs['1'][0]!)],
            '10': [getAddress(mockBlacklistResponse.blacklistAddrs['10'][0]!)],
            '137': [getAddress(mockBlacklistResponse.blacklistAddrs['137'][0]!)]
          },
          blacklistBySymbols: mockBlacklistResponse.blacklistBySymbols,
          updatedAt: expect.any(Number),
          isLoading: false
        })
        expect(storedBlacklist).toEqual({
          blacklistAddrs: blacklist.blacklistAddrs,
          blacklistBySymbols: blacklist.blacklistBySymbols,
          updatedAt: blacklist.updatedAt
        })
      } finally {
        jest.useRealTimers()
        restore()
      }
    })

    test('should ignore malformed or unsuccessful API responses', async () => {
      const { restore } = suppressConsole()
      const fetchOverride = createBlacklistFetchOverride(() =>
        Promise.resolve(
          createJsonResponse({ success: false, blacklistAddrs: {}, blacklistBySymbols: [] })
        )
      )

      const { storageCtrl } = await prepareTest({
        fetchOverride,
        skipBlacklistFetch: false,
        awaitInitialLoad: false
      })

      expect(wasBlacklistFetched(fetchOverride)).toBe(true)
      expect(await storageCtrl.get('tokenBlacklist', null)).toBeNull()
      restore()
    })
  })

  describe('batchedPortfolioDiscovery', () => {
    const createJsonResponse = (body: unknown, status = 200, statusText = 'OK') => ({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
    })

    const getPortfolioResponseByNetworks = (url: string) => {
      const networkParam = new URL(url).searchParams.get('networks') || ''
      const networkCount = networkParam.split(',').filter(Boolean).length

      return Array.from({ length: networkCount }, (_, index) => ({
        hasHints: true,
        erc20s: [],
        erc721s: {},
        prices: {},
        otherNetworksDefiCounts: {},
        defi: {
          positions: [],
          updatedAt: Date.now()
        },
        index
      }))
    }

    const createDiscoveryFetchOverride = (
      handler: (url: string) => Promise<{
        ok: boolean
        status: number
        statusText: string
        json: () => Promise<unknown>
      }>
    ) =>
      jest.fn((input: Parameters<typeof fetch>[0]) => {
        const url = typeof input === 'string' ? input : input.toString()

        if (url.includes('/portfolio?')) return handler(url)

        return Promise.resolve(createJsonResponse({}))
      }) as unknown as typeof fetch

    test('Should send defi=force even when batchedPortfolioDiscovery is called for multiple networks, but only one calls with the Force mode', async () => {
      const discoveryUrls: string[] = []
      const fetchOverride = createDiscoveryFetchOverride(async (url) => {
        discoveryUrls.push(url)

        return createJsonResponse(getPortfolioResponseByNetworks(url))
      })

      const { controller } = await prepareTest({
        fetchOverride,
        awaitInitialLoad: false
      })

      // @ts-expect-error test
      const firstCall = controller.batchedPortfolioDiscovery({
        chainId: 1n,
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
      })

      // @ts-expect-error test
      const secondCall = controller.batchedPortfolioDiscovery({
        chainId: 137n,
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Force
      })

      await Promise.allSettled([firstCall, secondCall])

      expect(discoveryUrls).toHaveLength(1)
      expect(new URL(discoveryUrls[0]!).searchParams.get('defi')).toBe('force')
    })

    test('defi=force is account-pair specific', async () => {
      const discoveryUrls: string[] = []
      const fetchOverride = createDiscoveryFetchOverride(async (url) => {
        discoveryUrls.push(url)

        return createJsonResponse(getPortfolioResponseByNetworks(url))
      })

      const { controller } = await prepareTest({
        fetchOverride,
        awaitInitialLoad: false
      })

      const affectedPair = [
        // @ts-expect-error test
        controller.batchedPortfolioDiscovery({
          chainId: 1n,
          accountAddr: account.addr,
          baseCurrency: 'usd',
          defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
        }),
        // @ts-expect-error test
        controller.batchedPortfolioDiscovery({
          chainId: 137n,
          accountAddr: account.addr,
          baseCurrency: 'usd',
          defiUpdateMode: defiPositionsLib.DefiUpdateMode.Force
        })
      ]

      const unaffectedPair = [
        // @ts-expect-error test
        controller.batchedPortfolioDiscovery({
          chainId: 1n,
          accountAddr: account2.addr,
          baseCurrency: 'usd',
          defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
        })
      ]

      await Promise.allSettled([...affectedPair, ...unaffectedPair])

      const pairWithForceUpdate = discoveryUrls.find((url) =>
        url.includes(`account=${account.addr}`)
      )
      const pairWithoutForceUpdate = discoveryUrls.find((url) =>
        url.includes(`account=${account2.addr}`)
      )

      expect(discoveryUrls).toHaveLength(2)
      expect(pairWithForceUpdate).toBeDefined()
      expect(pairWithoutForceUpdate).toBeDefined()

      expect(new URL(pairWithForceUpdate!).searchParams.get('defi')).toBe('force')
      expect(new URL(pairWithoutForceUpdate!).searchParams.get('defi')).toBe('default')
    })

    test('Malformed array length mismatch should trigger mismatch rejection', async () => {
      const fetchOverride = createDiscoveryFetchOverride(async () => createJsonResponse([{}]))

      const { controller } = await prepareTest({
        fetchOverride,
        awaitInitialLoad: false
      })

      // @ts-expect-error test
      const firstCall = controller.batchedPortfolioDiscovery({
        chainId: 1n,
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
      })

      // @ts-expect-error test
      const secondCall = controller.batchedPortfolioDiscovery({
        chainId: 137n,
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
      })

      const [firstResult, secondResult] = await Promise.allSettled([firstCall, secondCall])

      expect(firstResult.status).toBe('rejected')
      expect(secondResult.status).toBe('rejected')

      if (firstResult.status === 'rejected') {
        expect(firstResult.reason?.message).toContain(
          'internal error: queue length and response length mismatch'
        )
      }

      if (secondResult.status === 'rejected') {
        expect(secondResult.reason?.message).toContain(
          'internal error: queue length and response length mismatch'
        )
      }
    })

    test('customAppChain discovery is batched with network discovery for the same account/baseCurrency', async () => {
      const discoveryUrls: string[] = []
      const fetchOverride = createDiscoveryFetchOverride(async (url) => {
        discoveryUrls.push(url)

        return createJsonResponse(getPortfolioResponseByNetworks(url))
      })

      const { controller } = await prepareTest({
        fetchOverride,
        awaitInitialLoad: false
      })

      // @ts-expect-error test
      const firstCall = controller.batchedPortfolioDiscovery({
        chainId: 1n,
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
      })

      // @ts-expect-error test
      const secondCall = controller.batchedPortfolioDiscovery({
        chainId: 'customAppChain',
        accountAddr: account.addr,
        baseCurrency: 'usd',
        defiUpdateMode: defiPositionsLib.DefiUpdateMode.Default
      })

      await Promise.allSettled([firstCall, secondCall])

      expect(discoveryUrls).toHaveLength(1)
      const networkParams = (new URL(discoveryUrls[0]!).searchParams.get('networks') || '')
        .split(',')
        .filter(Boolean)

      expect(networkParams).toContain('1')
      expect(networkParams).toContain('customAppChain')
    })
  })
})
