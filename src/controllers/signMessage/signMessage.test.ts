import { expect, jest } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Message } from '../../interfaces/userRequest'
import { Keystore } from '../../libs/keystore/keystore'
import { InternalSigner } from '../keystore/keystore.test'
import { SignMessageController } from './signMessage'

describe('SignMessageController', () => {
  let signMessageController: SignMessageController

  beforeEach(() => {
    const keystoreSigners = { internal: InternalSigner }
    const keystoreLib = new Keystore(produceMemoryStore(), keystoreSigners)

    signMessageController = new SignMessageController(keystoreLib)
  })

  test('should initialize with a valid message', (done) => {
    const messageToSign: Message = {
      id: BigInt(1),
      content: {
        kind: 'message',
        message: 'Hello'
      },
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

    signMessageController.init(messageToSign)
  })

  test('should not initialize with an invalid message kind', () => {
    const messageToSign: Message = {
      id: BigInt(1),
      content: {
        // @ts-ignore that's on purpose, for the test
        kind: 'unsupportedKind',
        message: 'Hello'
      }
    }

    // Mock the emitError method to capture the emitted error
    const mockEmitError = jest.fn()
    // 'any' is on purpose, to override 'emitError' prop (which is protected)
    ;(signMessageController as any).emitError = mockEmitError

    signMessageController.init(messageToSign)

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
        expect(signMessageController.signature).toBeNull()
        expect(signMessageController.signedMessage).toBeNull()
        expect(signMessageController.signingKeyAddr).toBeNull()
        expect(signMessageController.status).toBe('INITIAL')
        done()
      }
    })

    signMessageController.reset()
  })

  test('should set signing key address', () => {
    const signingKeyAddr = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
    signMessageController.setSigningKeyAddr(signingKeyAddr)

    expect(signMessageController.signingKeyAddr).toBe(signingKeyAddr)
  })
})
