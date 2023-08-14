import { describe, expect } from '@jest/globals'
import { AbiCoder, ethers, JsonRpcProvider } from 'ethers'
import { PortfolioController } from './portfolio'
import { networks } from '../../consts/networks'
import { getNonce, produceMemoryStore } from '../../../test/helpers'
import { TokenResult } from '../../libs/portfolio'
import { AccountOp } from '../../libs/accountOp/accountOp'

describe('Portfolio Controller ', () => {
  const ethereum = networks.find((x) => x.id === 'ethereum')
  if (!ethereum) throw new Error('unable to find ethereum network in consts')
  const provider = new JsonRpcProvider(ethereum.rpcUrl)

  const account = {
    addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    label: '',
    pfp: '',
    associatedKeys: [],
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

    const SPOOF_SIGTYPE = '03'
    const spoofSig =
      new AbiCoder().encode(['address'], ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175']) +
      SPOOF_SIGTYPE

    const nonce = await getNonce('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5', provider)
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
          signature: spoofSig,
          calls
        } as AccountOp
      ]
    }
  }

  test('Previous tokens are persisted in the storage', async () => {
    const account2 = {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      label: '',
      pfp: '',
      associatedKeys: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      }
    }

    const storage = produceMemoryStore()
    const controller = new PortfolioController(storage)

    await controller.updateSelectedAccount([account2], networks, account2.addr)
    const storagePreviousHints = await storage.get('previousHints', {})

    expect(storagePreviousHints[`ethereum:${account2.addr}`]).toEqual({
      erc20s: [
        '0x0000000000000000000000000000000000000000',
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      ],
      erc721s: {}
    })
  })

  describe('Latest tokens', () => {
    test('Latest tokens are fetched and kept in the controller, while the pending should not be fetched (no AccountOp passed)', async () => {
      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)
      await controller.updateSelectedAccount([account], networks, account.addr)

      const latestState = controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!
      const pendingState = controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum

      expect(latestState.isReady).toEqual(true)
      expect(latestState.result?.tokens.length).toBeGreaterThan(0)
      expect(latestState.result?.collections.length).toBeGreaterThan(0)
      expect(latestState.result?.hints).toBeTruthy()
      expect(latestState.result?.total.usd).toBeGreaterThan(1000)
      expect(pendingState).toBeFalsy()
    })

    test('Latest tokens are fetched only once in a short period of time (controller.minUpdateInterval)', async () => {
      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)
      await controller.updateSelectedAccount([account], networks, account.addr)

      const latestState1 = controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      // @TODO - we should use fake timers.
      //   For some reason, when we enable them,
      //   all the lines after await controller.updateSelectedAccount are not being reached.
      // jest.useFakeTimers()
      // jest.runAllTimers();
      // jest.runAllTicks()
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(() => resolve(true), 1000))

      await controller.updateSelectedAccount([account], networks, account.addr)
      const latestState2 = controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(latestState1.result?.updateStarted).toEqual(latestState2.result?.updateStarted)
    })

    test('Latest and Pending are fetched, because `forceUpdate` flag is set', async () => {
      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)
      await controller.updateSelectedAccount([account], networks, account.addr, undefined, {
        forceUpdate: true
      })

      const latestState = controller.latest['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!
      const pendingState =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

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
    })
  })

  describe('Pending tokens', () => {
    test('Pending tokens + simulation are fetched and kept in the controller', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)

      const pendingState =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      const collection = pendingState.result?.collections.find(
        (c: TokenResult) => c.symbol === 'NFT Fiesta'
      )

      expect(pendingState.isReady).toEqual(true)
      expect(pendingState.result?.tokens.length).toBeGreaterThan(0)
      expect(pendingState.result?.collections.length).toBeGreaterThan(0)
      expect(pendingState.result?.hints).toBeTruthy()
      expect(pendingState.result?.total.usd).toBeGreaterThan(1000)
      // Expect amount post simulation to be calculated correctly
      expect(collection?.amountPostSimulation).toBe(0n)
    })

    test('Pending tokens are fetched only once if AccountOp is the same during the calls', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState1.result?.updateStarted).toEqual(pendingState2.result?.updateStarted)
    })

    test('Pending tokens are re-fetched, if `forceUpdate` flag is set, no matter if AccountOp is the same or changer', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage)

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp, {
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
      const controller = new PortfolioController(storage)

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      await controller.updateSelectedAccount([account], networks, account.addr)
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState2.result?.updateStarted).toBeGreaterThan(
        pendingState1.result?.updateStarted!
      )
    })
  })
})
