import { ethers, Wallet, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'
import { getAddress } from 'viem'

import { describe, expect, jest } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { getNonce, produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account, AccountStates } from '../../interfaces/account'
import { StoredKey } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import { Portfolio } from '../../libs/portfolio'
import {
  erc721CollectionToLearnedAssetKeys,
  learnedErc721sToHints
} from '../../libs/portfolio/helpers'
import {
  CollectionResult,
  Hints,
  LearnedAssets,
  PortfolioGasTankResult,
  PreviousHintsStorage
} from '../../libs/portfolio/interfaces'
import { getRpcProvider } from '../../services/provider'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { BannerController } from '../banner/banner'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { PortfolioController } from './portfolio'

const EMPTY_ACCOUNT_ADDR = '0xA098B9BccaDd9BAEc311c07433e94C9d260CbC07'

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.chainId.toString()] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.chainId.toString()].isWorking = true
})

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) =>
      getAccountState(providers[network.chainId.toString()], network, accounts)
    )
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: Network, netIndex: number) => {
          return [network.chainId, result[netIndex][accIndex]]
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

const account3 = {
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

const account4 = {
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

const ambireV2Account = {
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
    return hints.reduce((acc, addr) => {
      acc[addr] = Date.now()

      return acc
    }, {} as LearnedAssets['erc20s'][string])
  }

  const turnCollectionsToLearnedAssetKeys = (
    collections: [string, bigint[]][]
  ): LearnedAssets['erc721s'][string] => {
    return collections.reduce((acc, nft) => {
      erc721CollectionToLearnedAssetKeys(nft).forEach((key) => {
        acc[key] = Date.now()
      })

      return acc
    }, {} as LearnedAssets['erc721s'][string])
  }

  return {
    erc20s: {
      [`${1}:${account.addr}`]: turnHintsToLearnedAssets(tokenHints1),
      [`${1}:${account2.addr}`]: turnHintsToLearnedAssets(tokenHints2)
    },
    erc721s: {
      [`${1}:${account.addr}`]: turnCollectionsToLearnedAssetKeys([
        [tokenHints1[0], [1n, 2n, 3n]],
        [tokenHints1[1], [4n, 5n, 6n]],
        [tokenHints1[2], [7n, 8n, 9n]]
      ]),
      [`${1}:${account2.addr}`]: turnCollectionsToLearnedAssetKeys([
        // Collision with account 1 (on purpose)
        [tokenHints1[0], [10n, 11n, 12n]],
        [tokenHints2[5], [13n, 14n, 15n]]
      ])
    }
  }
}

const getKeystoreKeys = (): StoredKey[] => {
  return [
    {
      privKey: '0',
      dedicatedToOneSA: false,
      addr: account.associatedKeys[0],
      type: 'internal',
      label: 'key 1',
      meta: {} as any
    },
    {
      privKey: '0',
      dedicatedToOneSA: false,
      addr: account2.associatedKeys[0],
      type: 'internal',
      label: 'key 2',
      meta: {} as any
    }
  ]
}

const { uiManager } = mockUiManager()
const uiCtrl = new UiController({ uiManager })
const prepareTest = async (
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
) => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  await storageCtrl.set('accounts', [
    account,
    account2,
    account3,
    account4,
    emptyAccount,
    ambireV2Account,
    accountWithManyAssets
  ])
  if (initialSetStorage) await initialSetStorage(storageCtrl)

  const keystore = new KeystoreController('default', storageCtrl, {}, uiCtrl)
  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    onAddOrUpdateNetworks: (nets) => {
      nets.forEach((n) => {
        providersCtrl.setProvider(n)
      })
    },
    onRemoveNetwork: (id) => {
      providersCtrl.removeProvider(id)
    }
  })
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers
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
  const controller = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    keystore,
    relayerUrl,
    velcroUrl,
    new BannerController(storageCtrl)
  )

  if (initialSetStorage) {
    // The initial load promise is not exposed so we wait 500ms for the storage to be set
    await wait(500)
  }

  return { storageCtrl, controller }
}

describe('Portfolio Controller ', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })
  async function getAccountOp() {
    const ABI = ['function transferFrom(address from, address to, uint256 tokenId)']
    const iface = new ethers.Interface(ABI)
    const data = iface.encodeFunctionData('transferFrom', [
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      137
    ])

    const nonce = await getNonce('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5', providers['1'])
    const calls = [{ to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0', value: BigInt(0), data }]

    return {
      '1': [
        {
          accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          chainId: 1n,
          nonce,
          signature: '0x',
          calls
        } as AccountOp
      ]
    }
  }

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
      // @ts-ignore
      .spyOn(controller, 'updatePortfolioState')
      .mockImplementationOnce(
        () =>
          // @ts-ignore
          new Promise((resolve) => {
            setTimeout(() => {
              queueOrder.push('updatePortfolioState - #1 call')
              resolve(true)
            }, 2000)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #2 call')
            resolve(true)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #3 call')
            resolve(true)
          })
      )

    controller.updateSelectedAccount(account.addr, ethereum ? [ethereum] : undefined, undefined)

    controller.updateSelectedAccount(account.addr, ethereum ? [ethereum] : undefined, undefined)

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
      const { controller } = await prepareTest()
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]
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
      const { controller } = await prepareTest()
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
        states: accountStates[account.addr]
      })
      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]
      })

      expect(done).toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched if AccountOp is changed (omitted, i.e. undefined)', async () => {
      const { controller } = await prepareTest()
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]
      })
      const state1 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]
      })
      const state2 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      expect(state2.result?.updateStarted).toBeGreaterThan(state1.result?.updateStarted!)
    })

    test('Pending tokens are re-fetched if AccountOp is changed', async () => {
      const { controller } = await prepareTest()
      const accountOp = await getAccountOp()
      const accountStates = await getAccountsInfo([account])

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp,
        states: accountStates[account.addr]
      })
      const state1 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      const accountOp2 = await getAccountOp()
      // Change the address
      accountOp2['1'][0]!.accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA4'

      await controller.updateSelectedAccount(account.addr, undefined, {
        accountOps: accountOp2,
        states: accountStates[account.addr]
      })
      const state2 = controller.getAccountPortfolioState(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )['1']!

      expect(state2.result?.updateStarted).toBeGreaterThan(state1.result?.updateStarted!)
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

      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})
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
      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})
      const key = `${1}:${account2.addr}`

      expect(learnedAssets.erc721s[key]).not.toHaveProperty(SMART_CONTRACT_ADDR)
      // Note: The nft must be owned in order to appear in learned
      expect(learnedAssets.erc721s[key]).toHaveProperty(`${NFT_ADDR}:2647`)
    })
    test('Not owned ERC721 NFT in toBeLearned is added to specialErc721Hints.learn', async () => {
      const NFT_ADDR = getAddress('0x026224a2940bfe258d0dbe947919b62fe321f042')
      const { controller } = await prepareTest()

      controller.addErc721sToBeLearned([[NFT_ADDR, [1n]]], account2.addr, 1n)

      // @ts-ignore
      const allHints = controller.getAllHints(account2.addr, 1n)

      expect(allHints.specialErc721Hints.learn[NFT_ADDR]).toContain(1n)
    })

    test('Portfolio should filter out ER20 tokens that mimic native tokens (same symbol and amount)', async () => {
      const ERC_20_MATIC_ADDR = '0x0000000000000000000000000000000000001010'
      const { controller } = await prepareTest()

      // @ts-ignore
      await controller.learnTokens([ERC_20_MATIC_ADDR], `${137}:${account.addr}`, 137n)

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
          [`${1}:${account.addr}`]: firstBatchOf50.reduce((acc, addr, index) => {
            // First 20 are still owned, last 30 are no longer owned
            acc[addr] = index <= 20 ? Date.now() : Date.now() - 24 * 60 * 60 * 1000

            return acc
          }, {} as LearnedAssets['erc20s'][string])
        },
        erc721s: {}
      }

      const { controller, storageCtrl } = await prepareTest((storageC) =>
        storageC.set('learnedAssets', startingLearnedAssets)
      )

      const nextBatchOf30 = generateRandomAddresses(30)
      const allCurrentlyOwned = [...firstBatchOf50.slice(0, 20), ...nextBatchOf30]

      // @ts-ignore
      await controller.learnTokens(allCurrentlyOwned, `${1}:${account.addr}`, 1n)

      // Expect the oldest 10 to be removed
      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})
      const learnedErc20s = learnedAssets.erc20s?.[`${1}:${account.addr}`]

      expect(Object.keys(learnedErc20s).length).toBe(70)
    })

    test('To be learned erc721 cleanup mechanism works', async () => {
      // A total of 80 collections are added. 30 of them are "no longer owned"
      // but only 10 of them should be removed as the threshold of unowned is 20
      const firstRandomCollections = generateRandomAddresses(50).reduce((acc, addr, index) => {
        acc.push([addr, Math.random() < 0.2 ? [] : [BigInt(index)]] as [string, bigint[]])

        return acc
      }, [] as [string, bigint[]][])

      const keys = firstRandomCollections.map((c) => erc721CollectionToLearnedAssetKeys(c)).flat()

      const startingLearnedAssets: LearnedAssets = {
        erc20s: {},
        erc721s: {
          [`${1}:${account.addr}`]: keys.reduce((acc, key, index) => {
            // First 20 are still owned, last 30 are no longer owned
            acc[key] = index <= 20 ? Date.now() : Date.now() - 24 * 60 * 60 * 1000

            return acc
          }, {} as LearnedAssets['erc721s'][string])
        }
      }

      const { controller, storageCtrl } = await prepareTest((storageC) =>
        storageC.set('learnedAssets', startingLearnedAssets)
      )

      const nextRandomCollections = generateRandomAddresses(30).reduce((acc, addr, index) => {
        acc.push([addr, Math.random() < 0.2 ? [] : [BigInt(index)]] as [string, bigint[]])

        return acc
      }, [] as [string, bigint[]][])

      const allCurrentlyOwnedCollections = [
        ...firstRandomCollections.slice(0, 20),
        ...nextRandomCollections
      ]

      // @ts-ignore
      await controller.learnNfts(allCurrentlyOwnedCollections, account.addr, 1n)

      // Expect the oldest 10 to be removed
      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})

      const learnedErc721s = learnedAssets.erc721s?.[`${1}:${account.addr}`]

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

      // @ts-ignore
      const allHints = controller.getAllHints(account.addr, 1n)

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
      expect(allHints.specialErc721Hints.learn[DUPLICATE_COLLECTION[0]].length).toBe(2)
    })

    test('Add the same learned asset twice', async () => {
      const { controller, storageCtrl } = await prepareTest()

      const DUPLICATE_TOKEN_ADDR = getAddress('0xae7ab96520de3a18e5e111b5eaab095312d7fe84')
      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      // @ts-ignore
      await controller.learnTokens(
        [
          DUPLICATE_TOKEN_ADDR,
          '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
          '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee'
        ],
        `${1}:${account.addr}`,
        1n
      )

      // @ts-ignore
      await controller.learnTokens(
        [
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
          DUPLICATE_TOKEN_ADDR,
          '0x8d010bf9c26881788b4e6bf5fd1bdc358c8f90b8'
        ],
        `${1}:${account.addr}`,
        1n
      )

      // @ts-ignore
      await controller.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      // @ts-ignore
      await controller.learnNfts(
        [
          [DUPLICATE_COLLECTION[0], [1n, 2n]],
          ['0x0a1bbd57033f57e7b6743621b79fcb9eb2ce3676', [1n, 2n]]
        ],
        account.addr,
        1n
      )

      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})

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

      // @ts-ignore
      await controller.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      // @ts-ignore
      await controller.learnNfts(
        [
          // Empty array makes it enumerable
          [DUPLICATE_COLLECTION[0], []]
        ],
        account.addr,
        1n
      )

      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})

      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:1`
      )
      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:enumerable`
      )

      // @ts-ignore
      const { additionalErc721Hints } = controller.getAllHints(account.addr, 1n)

      // Enumerable is with priority
      expect(additionalErc721Hints[DUPLICATE_COLLECTION[0]]).toEqual([])
    })

    test('Learn an enumerable collection, then learn a collectible from it (enumerable is with priority)', async () => {
      const { controller, storageCtrl } = await prepareTest()

      const DUPLICATE_COLLECTION: [string, bigint[]] = [
        getAddress('0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'),
        [1n]
      ]

      // @ts-ignore
      await controller.learnNfts(
        [
          // Empty array makes it enumerable
          [DUPLICATE_COLLECTION[0], []]
        ],
        account.addr,
        1n
      )

      // @ts-ignore
      await controller.learnNfts([DUPLICATE_COLLECTION], account.addr, 1n)

      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})

      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:1`
      )
      expect(learnedAssets.erc721s[`${1}:${account.addr}`]).toHaveProperty(
        `${DUPLICATE_COLLECTION[0]}:enumerable`
      )

      // @ts-ignore
      const { additionalErc721Hints } = controller.getAllHints(account.addr, 1n)

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
        ['1']?.result?.tokens.find(
          (token) => token.address === '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b'
        )

      expect(toBeLearnedToken).toBeTruthy()

      const previousHintsStorage = await storageCtrl.get('previousHints', {})
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

      // @ts-ignore
      jest.spyOn(Portfolio.prototype, 'externalHintsAPIDiscovery').mockImplementationOnce(() =>
        // @ts-ignore
        Promise.resolve({
          hints
        })
      )

      controller.addTokensToBeLearned(['0xc2132D05D31c914a87C6611C10748AEb04B58e8F'], 137n)

      await controller.updateSelectedAccount(account2.addr, [polygon], undefined)

      const toBeLearnedToken = controller
        .getAccountPortfolioState(account2.addr)
        ['137']?.result?.tokens.find(
          (token) =>
            token.address === '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' && token.amount > 0n
        )
      expect(toBeLearnedToken).toBeTruthy()

      const key = `${137}:${account2.addr}`

      const previousHintsStorage: LearnedAssets = await storageCtrl.get('learnedAssets', {})
      const tokenInLearnedTokens = previousHintsStorage.erc20s?.[key][toBeLearnedToken!.address]

      expect(tokenInLearnedTokens).toBeTruthy()
    })

    test('Native tokens are fetched for all networks', async () => {
      const { controller } = await prepareTest()

      await controller.updateSelectedAccount(account.addr)

      networks.forEach((network) => {
        const nativeToken = controller
          .getAccountPortfolioState(account.addr)
          [network.chainId.toString()]?.result?.tokens.find(
            (token) => token.address === ZeroAddress
          )

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
      const LILPUDGIS_COLLECTION = '0x524cab2ec69124574082676e6f654a18df49a048'
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
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('learnedAssets', initialLearnedAssets)
      })

      // @ts-ignore
      const allHints = controller.getAllHints(account.addr, 1n)

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

      // @ts-ignore
      await controller.learnNfts([[LILPUDGIS_COLLECTION, [1n, 2n, 3n]]], account.addr, 1n)

      await controller.updateSelectedAccount(account.addr, [ethereum])

      const state2 = controller.getAccountPortfolioState(account.addr)?.['1']!

      expect(
        state2.result?.collections?.find(({ address }) => address === LILPUDGIS_COLLECTION)
      ).toBeDefined()

      const learnedInStorage: LearnedAssets = await storageCtrl.get('learnedAssets', {})

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
      // @ts-ignore
      const { specialErc721Hints } = controller.getAllHints(account.addr, 1n)

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
      // @ts-ignore
      const { specialErc721Hints: specialErc721Hints2 } = controller.getAllHints(account.addr, 1n)

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
      ).flatMap((res) => res?.result?.tokens || [])

      const latestHintsUpdate = controller.getAccountPortfolioState(account.addr)['1']?.result
        ?.lastExternalApiUpdateData?.lastUpdate

      expect(latestHintsUpdate).toBeDefined()
      expect(tokens1.length).toBeGreaterThan(0)

      await controller.updateSelectedAccount(account.addr)

      const tokens2 = Object.values(
        controller.getAccountPortfolioState(account.addr) || {}
      ).flatMap((res) => res?.result?.tokens || [])

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
      const learnedAssets: LearnedAssets = await storageCtrl.get('learnedAssets', {})
      const key = `1:${accountWithManyAssets.addr}`
      const { tokens, collections } = state1.result || {}

      expect(tokens?.length).toBeGreaterThan(0)
      expect(collections?.length).toBeGreaterThan(0)

      tokens
        ?.filter(({ amount }) => amount > 0)
        .forEach(({ address }) => {
          if (address === ZeroAddress) return
          expect(learnedAssets.erc20s[key]).toHaveProperty(address)
          // Has a timestamp
          expect(learnedAssets.erc20s[key][address]).toBeDefined()
        })

      collections?.forEach(({ address, collectibles }) => {
        // Return if the user has no collectibles from this collection as they are not learned
        if (!collectibles.length) return

        collectibles.forEach((id) => {
          const collectibleKey = `${address}:${id.toString()}`

          expect(learnedAssets.erc721s[key]).toHaveProperty(collectibleKey)
          expect(learnedAssets.erc721s[key][collectibleKey]).toBeGreaterThan(0)
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
      const { controller, storageCtrl } = await prepareTest((storage) =>
        storage.set('previousHints', previousHints)
      )

      const learnedAssets = await storageCtrl.get('learnedAssets', null)
      expect(learnedAssets).toBe(null)

      // @ts-ignore
      const allHints = controller.getAllHints(account.addr, 1n)

      Object.keys(previousHints.learnedTokens['1']).forEach((addr) => {
        expect(allHints.specialErc20Hints.learn.find((toBeLearned) => addr === toBeLearned))
      })
      Object.keys(previousHints.learnedNfts['1']).forEach((addr) => {
        expect(allHints.specialErc721Hints.learn).toHaveProperty(addr)
      })

      // Update the portfolio so the assets with balance are learned and
      // expect allHints to no longer return zero balance asset hints
      await controller.updateSelectedAccount(account.addr)

      // @ts-ignore
      const allHints2 = controller.getAllHints(account.addr, 1n)

      expect(allHints2.specialErc20Hints.learn.length).toBe(0)
      expect(Object.keys(allHints2.specialErc721Hints.learn).length).toBe(0)
    })
    test('Learned assets from view-only account are not returned', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest(async (storageController) => {
        await storageController.set('learnedAssets', learnedAssets)
        // Get rid of the second account's key (to make it view-only)
        await storageController.set('keystoreKeys', getKeystoreKeys().slice(0, 1))
      })

      // @ts-ignore
      const hints = controller.getAllHints(account.addr, 1n, true)
      const key = `${1n}:${account.addr}`

      expect(hints.additionalErc20Hints).toEqual(Object.keys(learnedAssets.erc20s[key]))
      expect(hints.additionalErc721Hints).toEqual(
        learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {}))
      )
    })
    test('Learned assets from other imported accounts are not returned if the update is not manual', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest(async (storageController) => {
        await storageController.set('learnedAssets', learnedAssets)
        // Get rid of the second account's key (to make it view-only)
        await storageController.set('keystoreKeys', getKeystoreKeys())
      })

      // @ts-ignore
      const hints = controller.getAllHints(account.addr, 1n)
      const key = `${1n}:${account.addr}`

      expect(hints.additionalErc20Hints).toEqual(Object.keys(learnedAssets.erc20s[key]))
      expect(hints.additionalErc721Hints).toEqual(
        learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {}))
      )
    })
    test('Learned assets are added from other imported accounts on a manual update', async () => {
      const learnedAssets = getMultipleAccountsLearnedAssets()

      const { controller } = await prepareTest(async (storageController) => {
        await storageController.set('learnedAssets', learnedAssets)
        // Get rid of the second account's key (to make it view-only)
        await storageController.set('keystoreKeys', getKeystoreKeys())
      })

      // @ts-ignore
      const hints = controller.getAllHints(account.addr, 1n, true)
      const key = `${1n}:${account.addr}`
      const key2 = `${1n}:${account2.addr}`

      expect(hints.additionalErc20Hints).toEqual([
        ...Object.keys(learnedAssets.erc20s[key]),
        ...Object.keys(learnedAssets.erc20s[key2])
      ])
      const firstNftAddr = Object.keys(learnedAssets.erc721s[key])[0]!.split(':')[0]!      expect(hints.additionalErc721Hints).toEqual({
        ...learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key] || {})),
        ...learnedErc721sToHints(Object.keys(learnedAssets.erc721s[key2] || {})),
        [firstNftAddr]: [1n, 2n, 3n, 10n, 11n, 12n]
      })

      // Collectibles are merged correctly for the same collection
      expect(hints.additionalErc721Hints[firstNftAddr]).toHaveLength(6)
    })
  })

  test('Check Token Validity - erc20, erc1155', async () => {
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
        controller.validTokens.erc20[`${token.address}-${token.chainId}`] === true
      const tokenIsNotValid =
        controller.validTokens.erc20[`${tokenERC1155.address}-${tokenERC1155.chainId}`] === false
      expect(tokenIsNotValid).toBeFalsy()
      expect(tokenIsValid).toBeTruthy()
    })
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
        ['1']?.result?.tokens.find(
          (token) => token.address === customToken.address && token.chainId === customToken.chainId
        )
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
      ['1']?.result?.tokens.find(
        (token) =>
          token.address === preference.address &&
          token.chainId === preference.chainId &&
          token.flags.isHidden
      )
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

    const lastSuccessfulUpdate = controller.getAccountPortfolioState(account.addr)['1']?.result
      ?.lastSuccessfulUpdate

    expect(lastSuccessfulUpdate).toBeTruthy()

    jest
      // @ts-ignore
      .spyOn(Portfolio.prototype, 'get')
      // Mock an error twice
      .mockRejectedValueOnce(new Error('Simulated error'))

    await controller.updateSelectedAccount(account.addr, ethereum)
    const lastSuccessfulUpdate2 = controller.getAccountPortfolioState(account.addr)['1']?.result
      ?.lastSuccessfulUpdate

    // Last successful update should not change if the update fails
    expect(lastSuccessfulUpdate2).toEqual(lastSuccessfulUpdate)

    jest
      // @ts-ignore
      .spyOn(Portfolio.prototype, 'get')
      // Mock an error twice
      .mockRejectedValueOnce(new Error('Simulated error'))

    // Set maxDataAgeMs to 0 (simulate a manual update), which should reset lastSuccessfulUpdate to 0
    await controller.updateSelectedAccount(account.addr, ethereum, undefined, {
      isManualUpdate: true
    })

    const lastSuccessfulUpdate3 = controller.getAccountPortfolioState(account.addr)['1']?.result
      ?.lastSuccessfulUpdate
    // Last successful update should reset on a manual update (passing maxDataAgeMs: 0)
    expect(lastSuccessfulUpdate2).not.toEqual(lastSuccessfulUpdate3)
    expect(lastSuccessfulUpdate3).toBe(0)

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
    expect(controller.getNetworksWithAssets(account.addr).length).toEqual(0)
  })
})
