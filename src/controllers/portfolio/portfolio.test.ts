import { AbiCoder, ethers, JsonRpcProvider } from 'ethers'
import { CollectionResult } from 'libs/portfolio/interfaces'

import { describe, expect, jest } from '@jest/globals'

import { getNonce, produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { PortfolioController } from './portfolio'

const relayerUrl = 'https://staging-relayer.ambire.com'

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
  describe('first', () => {
    test('Previous tokens are persisted in the storage', (done) => {
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
      const controller = new PortfolioController(storage, relayerUrl, [])

      const tokensHints = {
        erc20s: [
          '0x0000000000000000000000000000000000000000',
          '0xba100000625a3754423978a60c9317c58a424e3D',
          '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        ],
        erc721s: {}
      }

      controller.onUpdate(async () => {
        const storagePreviousHints = await storage.get('previousHints', {})

        if (storagePreviousHints[`ethereum:${account2.addr}`]) {
          expect(
            storagePreviousHints[`ethereum:${account2.addr}`].erc20s.filter((token: string) =>
              tokensHints.erc20s.includes(token)
            )
          ).toEqual(tokensHints.erc20s)
          done()
        }
      })
      controller.updateSelectedAccount([account2], networks, account2.addr)
    })
  })

  describe('Latest tokens', () => {
    test('Latest tokens are fetched and kept in the controller, while the pending should not be fetched (no AccountOp passed)', (done) => {
      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])

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

      controller.updateSelectedAccount([account], networks, account.addr)
    })

    // @TODO redo this test
    test('Latest tokens are fetched only once in a short period of time (controller.minUpdateInterval)', async () => {
      const done = jest.fn(() => null)

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])
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
      await controller.updateSelectedAccount([account], networks, account.addr)
      await controller.updateSelectedAccount([account], networks, account.addr)

      expect(done).not.toHaveBeenCalled()
    })

    test('Latest and Pending are fetched, because `forceUpdate` flag is set', (done) => {
      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])

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

      controller.updateSelectedAccount([account], networks, account.addr, undefined, {
        forceUpdate: true
      })
    })
  })

  describe('Pending tokens', () => {
    test('Pending tokens + simulation are fetched and kept in the controller', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)

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

    test('Pending tokens are fetched only once if AccountOp is the same during the calls', async () => {
      const done = jest.fn(() => null)
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])
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
      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)

      expect(done).not.toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched, if `forceUpdate` flag is set, no matter if AccountOp is the same or changer', async () => {
      const done = jest.fn(() => null)
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])
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
      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      await controller.updateSelectedAccount([account], networks, account.addr, accountOp, {
        forceUpdate: true
      })

      expect(done).toHaveBeenCalled()
    })

    test('Pending tokens are re-fetched if AccountOp is changed (omitted, i.e. undefined)', async () => {
      const accountOp = await getAccountOp()

      const storage = produceMemoryStore()
      const controller = new PortfolioController(storage, relayerUrl, [])

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
      const controller = new PortfolioController(storage, relayerUrl, [])

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp)
      const pendingState1 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      const accountOp2 = await getAccountOp()
      // Change the address
      accountOp2.ethereum[0].accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA4'

      await controller.updateSelectedAccount([account], networks, account.addr, accountOp2)
      const pendingState2 =
        controller.pending['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum!

      expect(pendingState2.result?.updateStarted).toBeGreaterThan(
        pendingState1.result?.updateStarted!
      )
    })
  })
})
