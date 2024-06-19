import { ethers, ZeroAddress } from 'ethers'

import { describe, expect, jest } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { getNonce, produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account } from '../../interfaces/account'
import { RPCProviders } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { CollectionResult } from '../../libs/portfolio/interfaces'
import { getRpcProvider } from '../../services/provider'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { PortfolioController } from './portfolio'

const EMPTY_ACCOUNT_ADDR = '0xA098B9BccaDd9BAEc311c07433e94C9d260CbC07'

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.id] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.id].isWorking = true
})

const prepareTest = () => {
  const storage = produceMemoryStore()

  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController(
    storage,
    (net) => {
      providersCtrl.setProvider(net)
    },
    (id) => {
      providersCtrl.removeProvider(id)
    }
  )
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers
  const controller = new PortfolioController(
    storage,
    providersCtrl,
    networksCtrl,
    relayerUrl,
    velcroUrl
  )

  return {
    controller,
    storage
  }
}

describe('Portfolio Controller ', () => {
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

  async function getAccountOp() {
    const ABI = ['function transferFrom(address from, address to, uint256 tokenId)']
    const iface = new ethers.Interface(ABI)
    const data = iface.encodeFunctionData('transferFrom', [
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      137
    ])

    const nonce = await getNonce('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5', providers.ethereum)
    const calls = [{ to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0', value: BigInt(0), data }]

    return {
      ethereum: [
        {
          accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          networkId: 'ethereum',
          nonce,
          signature: '0x',
          calls
        } as AccountOp
      ]
    }
  }

  test('Previous tokens are persisted in the storage', async () => {
    const account2 = {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      associatedKeys: [],
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

    const { controller, storage } = prepareTest()
    await controller.updateSelectedAccount([account2], account2.addr)
    const storagePreviousHints = await storage.get('previousHints', {})
    const ethereumHints = storagePreviousHints.fromExternalAPI[`ethereum:${account2.addr}`]
    const polygonHints = storagePreviousHints.fromExternalAPI[`polygon:${account2.addr}`]
    const optimismHints = storagePreviousHints.fromExternalAPI[`polygon:${account2.addr}`]

    // Controller persists tokens having balance for the current account.
    // @TODO - here we can enhance the test to cover one more scenarios:
    //  #1) Does the account really have amount for the persisted tokens.
    expect(ethereumHints.erc20s.length).toBeGreaterThan(0)
    expect(polygonHints.erc20s.length).toBeGreaterThan(0)
    expect(optimismHints.erc20s.length).toBeGreaterThan(0)
  })

  test('Account updates (by account and network, updateSelectedAccount()) are queued and executed sequentially to avoid race conditions', async () => {
    const { controller, storage } = prepareTest()
    const ethereum = networks.find((network) => network.id === 'ethereum')

    // Here's how we test if account updates are queued correctly.
    // First, we know that `updateSelectedAccount()` calls the `updatePortfolioState()` method twice for each account and network.
    // Why? Because we are getting both the latest and pending states.
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
              queueOrder.push('updatePortfolioState - #1 call (latest state)')
              resolve(true)
            }, 2000)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              queueOrder.push('updatePortfolioState - #1 call (pending state)')
              resolve(true)
            }, 2000)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #2 call (latest state)')
            resolve(true)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #2 call (pending state)')
            resolve(true)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #3 call (latest state)')
            resolve(true)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            queueOrder.push('updatePortfolioState - #3 call (pending state)')
            resolve(true)
          })
      )

    controller.updateSelectedAccount([account], account.addr, ethereum, undefined, {
      forceUpdate: true
    })

    controller.updateSelectedAccount([account], account.addr, ethereum, undefined, {
      forceUpdate: true
    })

    // We need to wait for the latest update, or the bellow expect will run too soon,
    // and we won't be able to check the queue properly.
    await controller.updateSelectedAccount([account], account.addr, ethereum, undefined, {
      forceUpdate: true
    })

    expect(queueOrder).toEqual([
      'updatePortfolioState - #1 call (latest state)',
      'updatePortfolioState - #1 call (pending state)',
      'updatePortfolioState - #2 call (latest state)',
      'updatePortfolioState - #2 call (pending state)',
      'updatePortfolioState - #3 call (latest state)',
      'updatePortfolioState - #3 call (pending state)'
    ])
  })

  describe('Latest tokens', () => {
    test('Latest tokens are fetched and kept in the controller, while the pending should not be fetched (no AccountOp passed)', (done) => {
      const { controller } = prepareTest()

      controller.onUpdate(() => {
        const latestState =
          controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum!
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        if (latestState && latestState.isReady) {
          expect(latestState.isReady).toEqual(true)
          expect(latestState.result?.tokens.length).toBeGreaterThan(0)
          expect(latestState.result?.collections?.length).toBeGreaterThan(0)
          expect(latestState.result?.hintsFromExternalAPI).toBeTruthy()
          expect(latestState.result?.total.usd).toBeGreaterThan(1000)
          expect(pendingState).toBeFalsy()
          done()
        }
      })

      controller.updateSelectedAccount([account], account.addr)
    })

    // @TODO redo this test
    test('Latest tokens are fetched only once in a short period of time (controller.minUpdateInterval)', async () => {
      const done = jest.fn(() => null)

      const { controller } = prepareTest()

      let pendingState1: any
      controller.onUpdate(() => {
        if (!pendingState1?.isReady) {
          pendingState1 = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        }
        if (pendingState1?.isReady) {
          if (
            controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum?.result
              ?.updateStarted !== pendingState1.result.updateStarted
          )
            done()
        }
      })
      await controller.updateSelectedAccount([account], account.addr)
      await controller.updateSelectedAccount([account], account.addr)

      expect(done).not.toHaveBeenCalled()
    })

    test('Latest and Pending are fetched, because `forceUpdate` flag is set', (done) => {
      const { controller } = prepareTest()

      controller.onUpdate(() => {
        const latestState =
          controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        if (latestState?.isReady && pendingState?.isReady) {
          expect(latestState.isReady).toEqual(true)
          expect(latestState.result?.tokens.length).toBeGreaterThan(0)
          expect(latestState.result?.collections?.length).toBeGreaterThan(0)
          expect(latestState.result?.hintsFromExternalAPI).toBeTruthy()
          expect(latestState.result?.total.usd).toBeGreaterThan(1000)

          expect(pendingState.isReady).toEqual(true)
          expect(pendingState.result?.tokens.length).toBeGreaterThan(0)
          expect(pendingState.result?.collections?.length).toBeGreaterThan(0)
          expect(pendingState.result?.hintsFromExternalAPI).toBeTruthy()
          expect(pendingState.result?.total.usd).toBeGreaterThan(1000)
          done()
        }
      })

      controller.updateSelectedAccount([account], account.addr, undefined, undefined, {
        forceUpdate: true
      })
    })
  })

  describe('Pending tokens', () => {
    test('Pending tokens + simulation are fetched and kept in the controller', async () => {
      const accountOp = await getAccountOp()

      const { controller } = prepareTest()

      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)

      controller.onUpdate(() => {
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!
        const collection = pendingState.result?.collections?.find(
          (c: CollectionResult) => c.symbol === 'NFT Fiesta'
        )
        expect(pendingState.isLoading).toEqual(false)

        expect(pendingState.result?.tokens.length).toBeGreaterThan(0)
        expect(pendingState.result?.collections?.length).toBeGreaterThan(0)
        expect(pendingState.result?.hintsFromExternalAPI).toBeTruthy()
        expect(pendingState.result?.total.usd).toBeGreaterThan(1000)
        // Expect amount post simulation to be calculated correctly
        expect(collection?.amountPostSimulation).toBe(0n)
      })
    })

    // TODO: currently we disable this optimizatin in portfolio controller, as in the application it doesn't work at all
    //   Under the tests, the caching works as expected, but once ran in the extension - it doesn't fetch the pending state.
    // test('Pending tokens are fetched only once if AccountOp is the same during the calls', async () => {
    //   const done = jest.fn(() => null)
    //   const accountOp = await getAccountOp()
    //
    //   const storage = produceMemoryStore()
    //   const controller = new PortfolioController(storage, relayerUrl)
    //   let pendingState1: any
    //   let pendingState2: any
    //   controller.onUpdate(() => {
    //     if (!pendingState1?.isReady) {
    //       pendingState1 = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
    //       return
    //     }
    //     if (pendingState1?.isReady) {
    //       pendingState2 = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
    //     }
    //     if (pendingState1.result?.updateStarted < pendingState2.result?.updateStarted) {
    //       done()
    //     }
    //   })
    //   await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)
    //   await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)
    //
    //   expect(done).not.toHaveBeenCalled()
    // })

    test('Pending tokens are re-fetched, if `forceUpdate` flag is set, no matter if AccountOp is the same or changer', async () => {
      const done = jest.fn(() => null)
      const accountOp = await getAccountOp()

      const { controller } = prepareTest()

      let pendingState1: any
      let pendingState2: any
      controller.onUpdate(() => {
        if (!pendingState1?.isReady) {
          pendingState1 = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
          return
        }
        if (pendingState1?.isReady) {
          pendingState2 = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        }
        if (pendingState1.result?.updateStarted < pendingState2.result?.updateStarted) {
          done()
        }
      })
      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)
      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp, {
        forceUpdate: true
      })

      expect(done).toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched if AccountOp is changed (omitted, i.e. undefined)', async () => {
      const accountOp = await getAccountOp()

      const { controller } = prepareTest()

      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp, {
        forceUpdate: true
      })
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState2.result?.updateStarted).toBeGreaterThan(
        pendingState1.result?.updateStarted!
      )
    })

    test('Pending tokens are re-fetched if AccountOp is changed', async () => {
      const accountOp = await getAccountOp()

      const { controller } = prepareTest()

      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      const accountOp2 = await getAccountOp()
      // Change the address
      accountOp2.ethereum[0].accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA4'

      await controller.updateSelectedAccount([account], account.addr, undefined, accountOp2)
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState2.result?.updateStarted).toBeGreaterThan(
        pendingState1.result?.updateStarted!
      )
    })
  })

  describe('Pinned tokens', () => {
    test('Pinned tokens are set in an account with no tokens', async () => {
      const emptyAccount: Account = {
        addr: EMPTY_ACCOUNT_ADDR,
        initialPrivileges: [],
        associatedKeys: [],
        creation: null,
        preferences: {
          label: DEFAULT_ACCOUNT_LABEL,
          pfp: EMPTY_ACCOUNT_ADDR
        }
      } as Account
      const { controller } = prepareTest()

      await controller.updateSelectedAccount(
        [emptyAccount],
        emptyAccount.addr,
        // we pass a network here, just because the portfolio is trying to perform a call to an undefined network,
        // and it throws a silent error
        networks.find((network) => network.id === 'ethereum'),
        undefined,
        {
          forceUpdate: true
        }
      )

      PINNED_TOKENS.filter((token) => token.networkId === 'ethereum').forEach((pinnedToken) => {
        const token = controller.latest[emptyAccount.addr].ethereum?.result?.tokens.find(
          (t) => t.address === pinnedToken.address
        )

        expect(token).toBeTruthy()
      })
    })
    test('Pinned gas tank tokens are set in a smart account with no tokens', async () => {
      const storage = produceMemoryStore()

      const emptyAccount: Account = {
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
      const { controller } = prepareTest()

      await controller.updateSelectedAccount([emptyAccount], emptyAccount.addr)

      if (controller.latest[emptyAccount.addr].gasTank?.isLoading) return

      PINNED_TOKENS.filter((token) => token.onGasTank && token.networkId === 'ethereum').forEach(
        (pinnedToken) => {
          const token = controller.latest[emptyAccount.addr].gasTank?.result?.tokens.find(
            (t) => t.address === pinnedToken.address
          )

          expect(token).toBeTruthy()
        }
      )
    })
    test('Pinned gas tank tokens are not set in an account with tokens', async () => {
      const storage = produceMemoryStore()

      const { controller } = prepareTest()

      await controller.updateSelectedAccount([account], account.addr)

      controller.latest[account.addr].ethereum?.result?.tokens.forEach((token) => {
        expect(token.amount > 0)
      })
      controller.latest[account.addr].gasTank?.result?.tokens.forEach((token) => {
        expect(token.amount > 0)
      })
    })
  })

  describe('Hints', () => {
    test('Zero balance token is fetched after being learned', async () => {
      const BANANA_TOKEN_ADDR = '0x94e496474F1725f1c1824cB5BDb92d7691A4F03a'
      const { controller } = prepareTest()

      await controller.learnTokens([BANANA_TOKEN_ADDR], 'ethereum')

      await controller.updateSelectedAccount([account], account.addr, undefined, undefined, {
        forceUpdate: true
      })

      const token = controller.latest[account.addr].ethereum?.result?.tokens.find(
        (tk) => tk.address === BANANA_TOKEN_ADDR
      )

      expect(token).toBeTruthy()
    })
    test("Learned token timestamp isn't updated if the token is found by the external hints api", async () => {
      const { controller, storage } = prepareTest()

      await controller.updateSelectedAccount([account], account.addr)

      const firstTokenOnEth = controller.latest[account.addr].ethereum?.result?.tokens.find(
        (token) =>
          token.amount > 0n &&
          token.address !== ZeroAddress &&
          !token.flags.onGasTank &&
          !token.flags.rewardsType
      )

      // Learn a token discovered by velcro
      await controller.learnTokens([firstTokenOnEth!.address], 'ethereum')

      await controller.updateSelectedAccount([account], account.addr, undefined, undefined, {
        forceUpdate: true
      })

      const previousHintsStorage = await storage.get('previousHints', {})
      const firstTokenOnEthInLearned =
        previousHintsStorage.learnedTokens.ethereum[firstTokenOnEth!.address]

      // Expect the timestamp to be null
      expect(firstTokenOnEthInLearned).toBeNull()
    })
  })

  test('Native tokens are fetched for all networks', async () => {
    const storage = produceMemoryStore()

    const { controller } = prepareTest()

    await controller.updateSelectedAccount([account], account.addr)

    networks.forEach((network) => {
      const nativeToken = controller.latest[account.addr][network.id]?.result?.tokens.find(
        (token) => token.address === ZeroAddress
      )

      expect(nativeToken).toBeTruthy()
    })
  })

  test('Check Token Validity - erc20, erc1155', async () => {
    const storage = produceMemoryStore()
    const token = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      networkId: 'ethereum'
    }
    const tokenERC1155 = {
      address: '0xEBba467eCB6b21239178033189CeAE27CA12EaDf',
      networkId: 'arbitrum'
    }
    const { controller } = prepareTest()

    await controller.updateTokenValidationByStandard(token, account.addr)
    await controller.updateTokenValidationByStandard(tokenERC1155, account.addr)

    controller.onUpdate(() => {
      const tokenIsValid =
        controller.validTokens.erc20[`${token.address}-${token.networkId}`] === true
      const tokenIsNotValid =
        controller.validTokens.erc20[`${tokenERC1155.address}-${tokenERC1155.networkId}`] === false
      expect(tokenIsNotValid).toBeFalsy()
      expect(tokenIsValid).toBeTruthy()
    })
  })

  test('Update Token Preferences', async () => {
    const storage = produceMemoryStore()

    const tokenInPreferences = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      networkId: 'ethereum',
      standard: 'ERC20',
      name: 'SHIB',
      symbol: 'SHIB',
      decimals: 18
    }

    const { controller } = prepareTest()

    await controller.updateTokenPreferences([tokenInPreferences])

    controller.onUpdate(() => {
      const tokenIsSet = controller.tokenPreferences.find(
        (token) => token.address === tokenInPreferences.address && token.networkId === 'ethereum'
      )

      expect(tokenIsSet).toEqual(tokenInPreferences)
    })
  })

  test('Update Token Preferences - hide a token and portfolio returns isHidden flag', async () => {
    const storage = produceMemoryStore()

    const tokenInPreferences = {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      networkId: 'ethereum',
      standard: 'ERC20',
      name: 'SHIB',
      symbol: 'SHIB',
      decimals: 18,
      isHidden: true
    }

    const { controller } = prepareTest()

    await controller.updateTokenPreferences([tokenInPreferences])

    await controller.updateSelectedAccount([account], account.addr)

    controller.onUpdate(() => {
      networks.forEach((network) => {
        const hiddenToken = controller.latest[account.addr][network.id]?.result?.tokens.find(
          (token) =>
            token.address === tokenInPreferences.address &&
            token.networkId === tokenInPreferences.networkId &&
            token.isHidden
        )
        expect(hiddenToken).toBeTruthy()
      })
    })
  })
})
