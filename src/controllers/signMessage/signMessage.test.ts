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

  // TODO:
  // afterEach(() => {
  // jest.clearAllMocks()
  // })

  test('should initialize with a valid message', (done) => {
    const messageToSign: Message = {
      id: BigInt(1),
      content: {
        kind: 'message',
        message: 'Hello'
      },
      signature: null
    }

    signMessageController.init(messageToSign)

    let emitCounter = 0
    signMessageController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(signMessageController.isInitialized).toBeTruthy()
        expect(signMessageController.messageToSign).toEqual(messageToSign)
        done()
      }
    })
  })
})
