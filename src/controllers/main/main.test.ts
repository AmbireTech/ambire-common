import { ethers } from 'ethers'
import EventEmitter from 'events'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { SelectedAccountForImport } from '../../interfaces/account'
import { UserRequest } from '../../interfaces/userRequest'
import { InnerCallFailureError } from '../../libs/errorDecoder/customErrors'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { getBytecode } from '../../libs/proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../../libs/proxyDeploy/getAmbireAddressTwo'
import { RelayerError } from '../../libs/relayerCall/relayerCall'
import { MainController } from './main'

// Public API key, shared by Socket, for testing purposes only
const socketApiKey = '72a5b4b0-e727-48be-8aa1-5da9d62fe635'

const windowManager = {
  event: new EventEmitter(),
  focus: () => Promise.resolve(),
  open: () => Promise.resolve({ id: 0, top: 0, left: 0, width: 100, height: 100, focused: true }),
  remove: () => Promise.resolve(),
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

const notificationManager = {
  create: () => Promise.resolve()
}

describe('Main Controller ', () => {
  const accounts = [
    {
      addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
      associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    },
    {
      addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
      associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    },
    {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      associatedKeys: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      }
    }
  ]

  const storage = produceMemoryStore()
  const email = 'unufri@ambire.com'
  storage.set('accounts', accounts)
  let controller: MainController
  test('Init controller', async () => {
    controller = new MainController({
      storage,
      fetch,
      relayerUrl,
      socketApiKey,
      keystoreSigners: { internal: KeystoreSigner },
      externalSignerControllers: {},
      windowManager,
      notificationManager,
      velcroUrl
    })
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => {
      const unsubscribe = controller.onUpdate(() => {
        unsubscribe()
        resolve(null)
      })
    })
    // console.dir(controller.accountStates, { depth: null })
    // @TODO
    // expect(states).to
  })

  test('Add a user request', async () => {
    const req: UserRequest = {
      id: 1,
      action: {
        kind: 'calls',
        calls: [
          {
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            value: BigInt(0),
            data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
          }
        ]
      },
      meta: {
        isSignAction: true,
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        chainId: 1n
      }
    }
    // @TODO test if nonce is correctly set
    controller.accounts.onUpdate(async () => {
      // The main controller doesn't wait for account state. This is not a problem in the
      // real world because users can't interact with a network without state.
      // Even if someone manages to open a user request without having state for that network
      // (for example through a dApp) it will be handled in the UI
      if ('ethereum' in Object.keys(controller.accounts.accountStates)) {
        await controller.addUserRequest(req)
        expect(controller.actions.actionsQueue.length).toBe(1)
      }
    })
  })
  test('Remove a user request', async () => {
    const req: UserRequest = {
      id: 1,
      action: {
        kind: 'calls',
        calls: [
          {
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            value: BigInt(0),
            data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
          }
        ]
      },
      meta: {
        isSignAction: true,
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        chainId: 1n
      }
    }
    await controller.removeUserRequest(req.id)
    expect(controller.actions.actionsQueue.length).toBe(0)
    // console.dir(controller.accountOpsToBeSigned, { depth: null })
    // @TODO test if nonce is correctly set
  })

  // @TODO: We should pass `autoConfirmMagicLink` to emailVault controller initialization
  // test('login with emailVault', async () => {
  //   // eslint-disable-next-line no-promise-executor-return
  //   const promise = new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
  //   await controller.emailVault.getEmailVaultInfo(email)
  //   await promise
  //
  //   expect(controller.emailVault.emailVaultStates).toMatchObject({
  //     email: {
  //       [email]: {
  //         email,
  //         recoveryKey: expect.anything(),
  //         availableSecrets: expect.anything(),
  //         availableAccounts: {},
  //         operations: []
  //       }
  //     }
  //   })
  // })

  test('backup keyStore secret emailVault', async () => {
    // console.log(
    //   JSON.stringify(controller.emailVault.emailVaultStates[email].availableSecrets, null, 2)
    // )
    controller.emailVault.uploadKeyStoreSecret(email)
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => {
      const unsubscribe = controller.emailVault.onUpdate(() => {
        unsubscribe()
        resolve(null)
      })
    })
    // console.log(JSON.stringify(controller.emailVault, null, 2))
  })

  // @TODO - have to rewrite this test and it should be part of email vault tests.
  // test('unlock keyStore with recovery secret emailVault', async () => {
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   async function wait(ms: number) {
  //     // eslint-disable-next-line no-promise-executor-return
  //     return new Promise((resolve) => setTimeout(() => resolve(null), ms))
  //   }
  //   // controller.lock()
  //   await controller.emailVault.recoverKeyStore(email)
  //   // console.log('isUnlock ==>', controller.isUnlock())
  //   // eslint-disable-next-line no-promise-executor-return
  //   // await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
  //   // await wait(10000)
  //   // console.log('isUnlock ==>', controller.isUnlock())
  // })

  test('should add smart accounts', async () => {
    controller = new MainController({
      storage,
      fetch,
      relayerUrl,
      socketApiKey,
      windowManager,
      notificationManager,
      keystoreSigners: { internal: KeystoreSigner },
      externalSignerControllers: {},
      velcroUrl
    })

    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const priv = { addr: signerAddr, hash: ethers.toBeHex(1, 32) }
    const bytecode = await getBytecode([priv])

    // Same mechanism to generating this one as used for the
    // `accountNotDeployed` in accountState.test.ts
    const addr = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
    const accountPendingCreation: SelectedAccountForImport = {
      account: {
        addr,
        associatedKeys: [signerAddr],
        creation: {
          factoryAddr: AMBIRE_ACCOUNT_FACTORY,
          bytecode,
          salt: ethers.toBeHex(0, 32)
        },
        initialPrivileges: [
          [
            '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
            '0x0000000000000000000000000000000000000000000000000000000000000001'
          ]
        ],
        preferences: {
          label: 'Account 4', // because there are 3 in the storage before this one
          pfp: addr
        }
      },
      accountKeys: [{ addr: signerAddr, index: 0, slot: 1 }],
      isLinked: false
    }

    const addAccounts = async () => {
      const keyIterator = new KeyIterator(
        '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
      )
      await controller.accountAdder.init({
        keyIterator,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      await controller.accountAdder.addAccounts([accountPendingCreation]).catch(console.error)
    }

    let emitCounter = 0
    // The `isReady` flag on the MainController gets set in async manner.
    // If the property of the main controller `isReady` becomes true before
    // reaching await new Promise..., the code inside the onUpdate won't run,
    // because there is nothing that will trigger an update. To prevent this,
    // check if the controller is ready outside of the onUpdate first and add the accounts.
    if (controller.isReady && emitCounter === 0) {
      emitCounter++
      await addAccounts()
    }

    return new Promise((resolve) => {
      const unsubscribe = controller.onUpdate(async () => {
        emitCounter++
        if (emitCounter === 2 && controller.isReady) await addAccounts()

        if (controller.statuses.onAccountAdderSuccess === 'SUCCESS') {
          expect(controller.accounts.accounts).toContainEqual({
            ...accountPendingCreation.account,
            newlyAdded: true,
            newlyCreated: false
          })
          unsubscribe()
          resolve(null)
        }
      })
    })
  })

  // FIXME: This test works when fired standalone, but it throws an error when
  // run with the rest of the tests. Figure out wtf.
  test.skip('should add accounts and merge the associated keys of the already added accounts', (done) => {
    const mainCtrl = new MainController({
      storage,
      fetch,
      relayerUrl,
      socketApiKey,
      windowManager,
      notificationManager,
      keystoreSigners: { internal: KeystoreSigner },
      externalSignerControllers: {},
      velcroUrl
    })

    mainCtrl.accounts.accounts = [
      {
        addr: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033',
        associatedKeys: ['0x699380c785819B2f400cb646b12C4C60b4dc7fcA'],
        initialPrivileges: [
          [
            '0x699380c785819B2f400cb646b12C4C60b4dc7fcA',
            '0x0000000000000000000000000000000000000000000000000000000000000001'
          ]
        ],
        creation: accounts[0].creation,
        preferences: {
          label: DEFAULT_ACCOUNT_LABEL,
          pfp: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033'
        }
      }
    ]

    let emitCounter = 0
    const unsubscribe = mainCtrl.onUpdate(() => {
      emitCounter++
      if (emitCounter === 3) {
        expect(mainCtrl.accounts.accounts[0].associatedKeys.length).toEqual(2)
        expect(mainCtrl.accounts.accounts[0].associatedKeys).toContain(
          '0x699380c785819B2f400cb646b12C4C60b4dc7fcA'
        )
        expect(mainCtrl.accounts.accounts[0].associatedKeys).toContain(
          '0xb1b2d032AA2F52347fbcfd08E5C3Cc55216E8404'
        )
        unsubscribe()
        done()
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    mainCtrl.accounts.addAccounts([
      {
        addr: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033',
        associatedKeys: ['0xb1b2d032AA2F52347fbcfd08E5C3Cc55216E8404'],
        initialPrivileges: [
          [
            '0x699380c785819B2f400cb646b12C4C60b4dc7fcA',
            '0x0000000000000000000000000000000000000000000000000000000000000001'
          ]
        ],
        creation: accounts[0].creation,
        preferences: {
          label: DEFAULT_ACCOUNT_LABEL,
          pfp: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033'
        }
      }
    ])
  })

  test('should check if network features get displayed correctly for ethereum', async () => {
    const eth = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth?.features.length).toBe(3)

    const saSupport = eth?.features.find((feat) => feat.id === 'saSupport')!
    expect(saSupport).not.toBe(null)
    expect(saSupport).not.toBe(undefined)
    expect(saSupport!.level).toBe('success')
    expect(saSupport!.title).toBe('Ambire Smart Accounts')

    const simulation = eth?.features.find((feat) => feat.id === 'simulation')
    expect(simulation).not.toBe(null)
    expect(simulation).not.toBe(undefined)
    expect(simulation!.level).toBe('success')

    const prices = eth?.features.find((feat) => feat.id === 'prices')
    expect(prices).not.toBe(null)
    expect(prices).not.toBe(undefined)
    expect(prices!.level).toBe('success')

    // set first to false so we could test setContractsDeployedToTrueIfDeployed
    await controller.networks.updateNetwork({ areContractsDeployed: false }, 1n)

    const eth2 = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth2.areContractsDeployed).toEqual(false)
    await controller.setContractsDeployedToTrueIfDeployed(eth2)

    const eth3 = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth3.areContractsDeployed).toEqual(true)
  })
  describe('throwBroadcastAccountOp', () => {
    suppressConsoleBeforeEach()

    const prepareTest = () => {
      const controllerAnyType = controller as any
      return {
        controllerAnyType
      }
    }

    it('Should prefer message to error', async () => {
      const { controllerAnyType } = prepareTest()
      try {
        await controllerAnyType.throwBroadcastAccountOp({
          message: 'message',
          error: new Error('error')
        })
      } catch (e: any) {
        expect(e.message).toBe('message')
      }
    })
    it('pimlico_getUserOperationGasPrice', async () => {
      const { controllerAnyType } = prepareTest()
      try {
        await controllerAnyType.throwBroadcastAccountOp({
          error: new Error(
            "pimlico_getUserOperationGasPrice some information we don't care about 0x2314214"
          )
        })
      } catch (e: any) {
        expect(e.message).toBe(
          'The transaction cannot be broadcast because the selected fee is too low. Please select a higher transaction speed and try again.'
        )
      }
    })
    it('Error that should be humanized by getHumanReadableBroadcastError', async () => {
      const { controllerAnyType } = prepareTest()
      const error = new InnerCallFailureError(
        '   transfer amount exceeds balance   ',
        [],
        networks.find((n) => n.chainId === 8453n)!
      )

      try {
        await controllerAnyType.throwBroadcastAccountOp({
          error
        })
      } catch (e: any) {
        expect(e.message).toBe(
          'The transaction cannot be broadcast because the transfer amount exceeds your account balance. Please check your balance or adjust the transfer amount.'
        )
      }
    })
    it('Unknown error that should be humanized by getHumanReadableBroadcastError', async () => {
      const { controllerAnyType } = prepareTest()
      const error = new Error("I'm a teapot")

      try {
        await controllerAnyType.throwBroadcastAccountOp({
          error
        })
      } catch (e: any) {
        expect(e.message).toBe(
          'The transaction cannot be broadcast because of an unknown error.\nPlease try again or contact Ambire support for assistance.'
        )
      }
    })
    it('replacement fee too low', async () => {
      const { controllerAnyType } = prepareTest()
      const error = new Error('replacement fee too low')

      try {
        await controllerAnyType.throwBroadcastAccountOp({
          error
        })
      } catch (e: any) {
        expect(e.message).toBe(
          'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.'
        )
      }
    })
    it('Relayer broadcast swap expired', async () => {
      const { controllerAnyType } = prepareTest()

      const error = new RelayerError(
        '"Transaction too old" (action="estimateGas", data="0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135472616e73616374696f6e20746f6f206f6c6400000000000000000000000000", reason="Transaction too old", transaction={ "data": "0x6171d1c9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000032000000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc450000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002445ae401dc00000000000000000000000000000000000000000000000000000000673b3e25000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000c35000000000000000000000000000000000000000000000000001af5cbb4b149c38000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001af5cbb4b149c380000000000000000000000007544127fce3dd39a15b719abb93ca765d91ead6d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e6802303480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000074f0dfef4cd1f200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000767617354616e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006574d4154494300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042b1f9d3975aecfa6e646bef006f2ab88a131775543cb0321360633cef30dcce5b1c78936706c50fdb17469b8d8e546f22d68ab5c7a7d1e73649cd3ca8d9d3a1f81c01000000000000000000000000000000000000000000000000000000000000", "to": "0x7544127fCe3dd39A15b719abB93Ca765D91EAD6d" }, invocation=null, revert={ "args": [ "Transaction too old" ], "name": "Error", "signature": "Error(string)" }, code=CALL_EXCEPTION, version=6.7.1)',
        {},
        {}
      )
      try {
        await controllerAnyType.throwBroadcastAccountOp({
          error
        })
      } catch (e: any) {
        expect(e.message).toBe(
          'The transaction cannot be broadcast because the swap has expired. Return to the app and reinitiate the swap if you wish to proceed.'
        )
      }
    })
  })
})
