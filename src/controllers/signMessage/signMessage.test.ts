import { expect, jest } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Message } from '../../interfaces/userRequest'
import { Keystore } from '../../libs/keystore/keystore'
import { InternalSigner } from '../keystore/keystore.test'
import { SignMessageController } from './signMessage'

describe('SignMessageController', () => {
  let signMessageController: SignMessageController
  let keystoreLib: Keystore

  beforeEach(() => {
    const keystoreSigners = { internal: InternalSigner }
    keystoreLib = new Keystore(produceMemoryStore(), keystoreSigners)

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

  test('should sign a message', (done) => {
    const messageToSign: Message = {
      id: BigInt('1'),
      content: {
        kind: 'message',
        message: 'Hello'
      },
      signature: null
    }
    const signingKeyAddr = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
    const dummySignature =
      '0x26b2078e3bd9b2c8a2a9fa1b1d41acf99e2d9590d69c7d585ce05b3b5f33110e1b4d7d4b7e8f7ffd6f9c52e1e5f9b252d8a7a11a13e36c3b0454b7ffe9cb55f1c'

    // @ts-ignore for mocking purposes only
    const mockSigner = { signMessage: jest.fn().mockResolvedValue(dummySignature) }

    // @ts-ignore spy on the getSigner method and mock its implementation
    const getSignerSpy = jest.spyOn(keystoreLib, 'getSigner').mockResolvedValue(mockSigner)

    let emitCounter = 0
    signMessageController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 3) {
        expect(signMessageController.status).toBe('LOADING')
      }

      // 1 - init, 2 - setSigningKeyAddr, 3 - sign loading starts, 4 - sign completes
      if (emitCounter === 4) {
        expect(signMessageController.status).toBe('DONE')
        expect(mockSigner.signMessage).toHaveBeenCalledWith(messageToSign.content.message)
        expect(signMessageController.signature).toBe(dummySignature)
        expect(signMessageController.signedMessage).toEqual({
          ...messageToSign,
          signature: dummySignature
        })

        getSignerSpy.mockRestore() // cleans up the spy
        done()
      }
    })

    signMessageController.init(messageToSign)
    signMessageController.setSigningKeyAddr(signingKeyAddr)
    signMessageController.sign()
  })
})
