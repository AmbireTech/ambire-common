import { ethers } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { UserRequest } from '../../interfaces/userRequest'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { getBytecode } from '../../libs/proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../../libs/proxyDeploy/getAmbireAddressTwo'
import { MainController } from './main'

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
  const relayerUrl = 'https://staging-relayer.ambire.com'
  const email = 'unufri@ambire.com'
  storage.set('accounts', accounts)
  let controller: MainController
  test('Init controller', async () => {
    controller = new MainController({
      storage,
      fetch,
      relayerUrl,
      keystoreSigners: { internal: KeystoreSigner },
      externalSignerControllers: {},
      onResolveDappRequest: () => {},
      onRejectDappRequest: () => {},
      onUpdateDappSelectedAccount: () => {},
      pinned: []
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
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      networkId: 'ethereum',
      forceNonce: null,
      action: {
        kind: 'call',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: BigInt(0),
        data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
      }
    }
    await controller.addUserRequest(req)
    expect(Object.keys(controller.accountOpsToBeSigned).length).toBe(1)
    // console.dir(controller.accountOpsToBeSigned, { depth: null })
    // @TODO test if nonce is correctly set
  })
  test('Remove a user request', async () => {
    const req: UserRequest = {
      id: 1,
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      networkId: 'ethereum',
      forceNonce: null,
      action: {
        kind: 'call',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: BigInt(0),
        data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
      }
    }
    await controller.removeUserRequest(req.id)
    expect(Object.keys(controller.accountOpsToBeSigned).length).toBe(0)
    // console.dir(controller.accountOpsToBeSigned, { depth: null })
    // @TODO test if nonce is correctly set
  })

  test('login with emailVault', async () => {
    controller.emailVault.login(email)
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
    // console.log(controller.emailVault.emailVaultStates)
  })

  test('beckup keyStore secret emailVault', async () => {
    // console.log(
    //   JSON.stringify(controller.emailVault.emailVaultStates[email].availableSecrets, null, 2)
    // )
    controller.emailVault.backupRecoveryKeyStoreSecret(email)
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
    // console.log(
    //   JSON.stringify(controller.emailVault.emailVaultStates[email].availableSecrets, null, 2)
    // )
  })

  test('unlock keyStore with recovery secret emailVault', async () => {
    async function wait(ms: number) {
      // eslint-disable-next-line no-promise-executor-return
      return new Promise((resolve) => setTimeout(() => resolve(null), ms))
    }
    // controller.lock()
    controller.emailVault.recoverKeyStore(email)
    // console.log('isUnlock ==>', controller.isUnlock())
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
    await wait(10000)
    // console.log('isUnlock ==>', controller.isUnlock())
  })

  test('should add smart accounts', async () => {
    controller = new MainController({
      storage,
      fetch,
      relayerUrl,
      keystoreSigners: { internal: KeystoreSigner },
      externalSignerControllers: {},
      onResolveDappRequest: () => {},
      onRejectDappRequest: () => {},
      onUpdateDappSelectedAccount: () => {},
      pinned: []
    })

    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const priv = { addr: signerAddr, hash: ethers.toBeHex(1, 32) }
    const bytecode = await getBytecode([priv])

    // Same mechanism to generating this one as used for the
    // `accountNotDeployed` in accountState.test.ts
    const accountPendingCreation = {
      account: {
        addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
        associatedKeys: [signerAddr],
        creation: {
          factoryAddr: AMBIRE_ACCOUNT_FACTORY,
          bytecode,
          salt: ethers.toBeHex(0, 32)
        }
      },
      accountKeyAddr: signerAddr,
      slot: 1,
      index: 0,
      isLinked: false
    }

    const addAccounts = () => {
      const keyIterator = new KeyIterator(
        '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
      )
      controller.accountAdder.init({
        keyIterator,
        preselectedAccounts: [],
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      controller.accountAdder.addAccounts([accountPendingCreation]).catch(console.error)
    }

    let emitCounter = 0
    // The `isReady` flag on the MainController gets set in async manner.
    // If the property of the main controller `isReady` becomes true before
    // reaching await new Promise..., the code inside the onUpdate won't run,
    // because there is nothing that will trigger an update. To prevent this,
    // check if the controller is ready outside of the onUpdate first and add the accounts.
    if (controller.isReady && emitCounter === 0) {
      emitCounter++
      addAccounts()
    }
    await new Promise((resolve) => {
      const unsubscribe = controller.onUpdate(() => {
        emitCounter++

        if (emitCounter === 1 && controller.isReady) addAccounts()

        if (
          controller.status === 'SUCCESS' &&
          controller.latestMethodCall === 'onAccountAdderSuccess'
        ) {
          expect(controller.accounts).toContainEqual(accountPendingCreation.account)
          unsubscribe()
          resolve(true)
        }
      })
    })
  })
})
