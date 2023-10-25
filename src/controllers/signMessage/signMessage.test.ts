import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { Message } from '../../interfaces/userRequest'
import { KeystoreController } from '../keystore/keystore'
import { InternalSigner } from '../keystore/keystore.test'
import { SignMessageController } from './signMessage'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const account: Account = {
  addr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
  label: '',
  pfp: '',
  associatedKeys: ['0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'],
  creation: null
}

describe('SignMessageController', () => {
  let signMessageController: SignMessageController
  let keystore: KeystoreController

  beforeEach(() => {
    const keystoreSigners = { internal: InternalSigner }
    keystore = new KeystoreController(produceMemoryStore(), keystoreSigners)

    signMessageController = new SignMessageController(
      keystore,
      providers,
      produceMemoryStore(),
      fetch
    )
  })

  test('should initialize with a valid message', (done) => {
    const messageToSign: Message = {
      id: 1,
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      accountAddr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
      signature: null
    }

    let emitCounter = 0
    signMessageController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(signMessageController.isInitialized).toBeTruthy()
        expect(signMessageController.messageToSign).toEqual(messageToSign)
        done()
      }
    })

    signMessageController.init({ messageToSign, accounts: [account], accountStates: {} })
  })

  test('should not initialize with an invalid message kind', () => {
    const messageToSign: Message = {
      id: 1,
      content: {
        // @ts-ignore that's on purpose, for the test
        kind: 'unsupportedKind',
        message: '0x74657374'
      }
    }

    // Mock the emitError method to capture the emitted error
    const mockEmitError = jest.fn()
    // 'any' is on purpose, to override 'emitError' prop (which is protected)
    ;(signMessageController as any).emitError = mockEmitError

    signMessageController.init({ messageToSign, accounts: [account], accountStates: {} })

    expect(signMessageController.isInitialized).toBeFalsy()
    expect(mockEmitError).toHaveBeenCalled()
  })

  test('should reset the controller', (done) => {
    let emitCounter = 0
    signMessageController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(signMessageController.isInitialized).toBeFalsy()
        expect(signMessageController.messageToSign).toBeNull()
        expect(signMessageController.signedMessage).toBeNull()
        expect(signMessageController.signedMessage).toBeNull()
        expect(signMessageController.signingKeyAddr).toBeNull()
        expect(signMessageController.status).toBe('INITIAL')
        done()
      }
    })

    signMessageController.reset()
  })

  test('should set signing key address', () => {
    const messageToSign: Message = {
      id: 1,
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      accountAddr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
      signature: null
    }
    const signingKeyAddr = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

    signMessageController.init({ messageToSign, accounts: [account], accountStates: {} })
    signMessageController.setSigningKey(signingKeyAddr, 'internal')

    expect(signMessageController.signingKeyAddr).toBe(signingKeyAddr)
  })

  test('should sign a message', (done) => {
    const messageToSign: Message = {
      id: 1,
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      accountAddr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
      signature: null
    }
    const signingKeyAddr = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
    const dummySignature =
      '0x5b2dce98c7179051d21407be04bcd088243cd388ed51c4c64ccae115ca8787d85cff933dcde45220c3adfcc40f7958305e195dbd4c54580dfbf61e43438cbe9a1c'

    // @ts-ignore for mocking purposes only
    const mockSigner = { signMessage: jest.fn().mockResolvedValue(dummySignature) }

    // @ts-ignore spy on the getSigner method and mock its implementation
    const getSignerSpy = jest.spyOn(keystore, 'getSigner').mockResolvedValue(mockSigner)

    let emitCounter = 0
    signMessageController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 3) {
        expect(signMessageController.status).toBe('LOADING')
      }

      // 1 - init
      // 2 - setSigningKeyAddr
      // 3 - call sign - loading starts
      // 4 - async humanization or sign completion
      // 5 - sign completes
      if ((emitCounter === 4 && signMessageController.status === 'DONE') || emitCounter === 5) {
        expect(signMessageController.status).toBe('DONE')
        expect(mockSigner.signMessage).toHaveBeenCalledWith(messageToSign.content.message)
        expect(signMessageController.signedMessage?.signature).toBe(dummySignature)

        getSignerSpy.mockRestore() // cleans up the spy
        done()
      }
    })

    signMessageController.init({ messageToSign, accounts: [account], accountStates: {} })
    signMessageController.setSigningKey(signingKeyAddr, 'internal')
    signMessageController.sign()
  })
})
