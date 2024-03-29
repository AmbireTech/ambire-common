import { ethers, JsonRpcProvider, ZeroAddress } from 'ethers'
import { CollectionResult } from 'libs/portfolio/interfaces'

import { describe, expect, jest } from '@jest/globals'

import { getNonce, produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account } from '../../interfaces/account'
import { RPCProviders } from '../../interfaces/settings'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { SettingsController } from '../settings/settings'
import { PortfolioController } from './portfolio'

const relayerUrl = 'https://staging-relayer.ambire.com'

const EMPTY_ACCOUNT_ADDR = '0xA098B9BccaDd9BAEc311c07433e94C9d260CbC07'

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.id] = new JsonRpcProvider(network.rpcUrl)
  providers[network.id].isWorking = true
})

const ethereum = networks.find((network) => network.id === 'ethereum')!

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
  describe('first', () => {
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
        }
      }

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)
      await controller.updateSelectedAccount([account2], [ethereum], account2.addr)

      const storagePreviousHints = await storage.get('previousHints', {})
      const storageErc20s = storagePreviousHints[`ethereum:${account2.addr}`].erc20s

      // Controller persists tokens having balance for the current account.
      // @TODO - here we can enhance the test to cover two more scenarios:
      //  #1) Does the account really have amount for the persisted tokens.
      //  #2) Currently, the tests covers only erc20s tokens. We should do the same check for erc721s too.
      //  The current account2, doesn't have erc721s.
      expect(storageErc20s.length).toBeGreaterThan(0)
    })
  })

  describe('Latest tokens', () => {
    test('Latest tokens are fetched and kept in the controller, while the pending should not be fetched (no AccountOp passed)', (done) => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      controller.onUpdate(() => {
        const latestState =
          controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum!
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        if (latestState && latestState.isReady) {
          expect(latestState.isReady).toEqual(true)
          expect(latestState.result?.tokens.length).toBeGreaterThan(0)
          expect(latestState.result?.collections.length).toBeGreaterThan(0)
          expect(latestState.result?.hints).toBeTruthy()
          expect(latestState.result?.total.usd).toBeGreaterThan(1000)
          expect(pendingState).toBeFalsy()
          done()
        }
      })

      controller.updateSelectedAccount([account], [ethereum], account.addr)
    })

    // @TODO redo this test
    test('Latest tokens are fetched only once in a short period of time (controller.minUpdateInterval)', async () => {
      const done = jest.fn(() => null)

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)
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
      await controller.updateSelectedAccount([account], [ethereum], account.addr)
      await controller.updateSelectedAccount([account], [ethereum], account.addr)

      expect(done).not.toHaveBeenCalled()
    })

    test('Latest and Pending are fetched, because `forceUpdate` flag is set', (done) => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      controller.onUpdate(() => {
        const latestState =
          controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']?.ethereum
        if (latestState?.isReady && pendingState?.isReady) {
          expect(latestState.isReady).toEqual(true)
          expect(latestState.result?.tokens.length).toBeGreaterThan(0)
          expect(latestState.result?.collections.length).toBeGreaterThan(0)
          expect(latestState.result?.hints).toBeTruthy()
          expect(latestState.result?.total.usd).toBeGreaterThan(1000)

          expect(pendingState.isReady).toEqual(true)
          expect(pendingState.result?.tokens.length).toBeGreaterThan(0)
          expect(pendingState.result?.collections.length).toBeGreaterThan(0)
          expect(pendingState.result?.hints).toBeTruthy()
          expect(pendingState.result?.total.usd).toBeGreaterThan(1000)
          done()
        }
      })

      controller.updateSelectedAccount([account], [ethereum], account.addr, undefined, {
        forceUpdate: true
      })
    })
  })

  describe('Pending tokens', () => {
    test('Pending tokens + simulation are fetched and kept in the controller', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)
      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp)

      controller.onUpdate(() => {
        const pendingState =
          controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!
        const collection = pendingState.result?.collections.find(
          (c: CollectionResult) => c.symbol === 'NFT Fiesta'
        )
        expect(pendingState.isLoading).toEqual(false)

        expect(pendingState.result?.tokens.length).toBeGreaterThan(0)
        expect(pendingState.result?.collections.length).toBeGreaterThan(0)
        expect(pendingState.result?.hints).toBeTruthy()
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
    //   await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
    //   await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
    //
    //   expect(done).not.toHaveBeenCalled()
    // })

    test('Pending tokens are re-fetched, if `forceUpdate` flag is set, no matter if AccountOp is the same or changer', async () => {
      const done = jest.fn(() => null)
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)
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
      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp)
      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp, {
        forceUpdate: true
      })

      expect(done).toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched if AccountOp is changed (omitted, i.e. undefined)', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp, {
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

      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      const accountOp2 = await getAccountOp()
      // Change the address
      accountOp2.ethereum[0].accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA4'

      await controller.updateSelectedAccount([account], [ethereum], account.addr, accountOp2)
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState2.result?.updateStarted).toBeGreaterThan(
        pendingState1.result?.updateStarted!
      )
    })
  })

  describe('Pinned tokens', () => {
    test('Pinned tokens are set in an account with no tokens', async () => {
      const storage = produceMemoryStore()

      const emptyAccount: Account = {
        addr: EMPTY_ACCOUNT_ADDR,
        initialPrivileges: [],
        associatedKeys: [],
        creation: null
      }
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      await controller.updateSelectedAccount(
        [emptyAccount],
        [ethereum],
        emptyAccount.addr,
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
        }
      }
      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      await controller.updateSelectedAccount(
        [emptyAccount],
        [ethereum],
        emptyAccount.addr,
        undefined
      )
      await controller.getAdditionalPortfolio(emptyAccount.addr)

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

      const settings = new SettingsController(storage)
      settings.providers = providers
      const controller = new PortfolioController(storage, settings, relayerUrl)

      await controller.updateSelectedAccount([account], [ethereum], account.addr, undefined)

      await controller.getAdditionalPortfolio(account.addr)

      controller.latest[account.addr].ethereum?.result?.tokens.forEach((token) => {
        expect(token.amount > 0)
      })
      controller.latest[account.addr].gasTank?.result?.tokens.forEach((token) => {
        expect(token.amount > 0)
      })
    })
  })

  test('Additional hints', async () => {
    const storage = produceMemoryStore()
    const BANANA_TOKEN_ADDR = '0x94e496474F1725f1c1824cB5BDb92d7691A4F03a'

    const settings = new SettingsController(storage)
    settings.providers = providers
    const controller = new PortfolioController(storage, settings, relayerUrl)

    await controller.updateSelectedAccount([account], networks, account.addr, undefined, {
      additionalHints: [BANANA_TOKEN_ADDR],
      forceUpdate: true
    })

    const token = controller.latest[account.addr].ethereum?.result?.tokens.find(
      (tk) => tk.address === BANANA_TOKEN_ADDR
    )

    expect(token).toBeTruthy()

    controller.resetAdditionalHints()

    await controller.updateSelectedAccount([account], networks, account.addr, undefined, {
      forceUpdate: true
    })

    // we're chaging how the portfolio fetches tokens
    // now, even though we're resetting additionalHints, we want the
    // token to be available once fetched from the simulation.
    // if we get close to the limit, all tokens with 0 balance will
    // get flushed
    const tokenAgain = controller.latest[account.addr].ethereum?.result?.tokens.find(
      (tk) => tk.address === BANANA_TOKEN_ADDR
    )
    expect(tokenAgain).toBeTruthy()
  })

  test('Native tokens are fetched for all networks', async () => {
    const storage = produceMemoryStore()

    const settings = new SettingsController(storage)
    settings.providers = providers
    const controller = new PortfolioController(storage, settings, relayerUrl)

    await controller.updateSelectedAccount([account], networks, account.addr, undefined)

    networks.forEach((network) => {
      const nativeToken = controller.latest[account.addr][network.id]?.result?.tokens.find(
        (token) => token.address === ZeroAddress
      )

      expect(nativeToken).toBeTruthy()
    })
  })

  // test('token icons are fetched', (done) => {
  //   const storage = produceMemoryStore()

  //   const settings = new SettingsController(storage)
  //   settings.providers = providers
  //   const controller = new PortfolioController(storage, settings, relayerUrl)

  //   controller.updateSelectedAccount([account], networks, account.addr, undefined).catch(() => {
  //     throw new Error('update failed')
  //   })

  //   controller.onUpdate(() => {
  //     if (Object.values(controller.tokenIcons).length) {
  //       console.log(controller.tokenIcons)
  //       done()
  //     }
  //   })
  // })
})
