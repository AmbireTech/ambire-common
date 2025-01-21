import fetch from 'node-fetch'
import { EventEmitter } from 'stream'

import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { Message } from '../../interfaces/userRequest'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { KeystoreController } from '../keystore/keystore'
import { InternalSigner } from '../keystore/keystore.test'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SignMessageController } from './signMessage'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

const account: Account = {
  addr: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
  associatedKeys: ['0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'],
  initialPrivileges: [
    [
      '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7',
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]
  ],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
  }
}

const windowManager = {
  event: new EventEmitter(),
  focus: () => Promise.resolve(),
  open: () => Promise.resolve({ id: 0, top: 0, left: 0, width: 100, height: 100 }),
  remove: () => Promise.resolve(),
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

const messageToSign: Message = {
  fromActionId: 1,
  content: { kind: 'message', message: '0x74657374' },
  accountAddr: account.addr,
  signature: null,
  networkId: 'ethereum'
}

describe('SignMessageController', () => {
  let signMessageController: SignMessageController
  let keystore: KeystoreController
  let accountsCtrl: AccountsController

  beforeEach(async () => {
    const storage = produceMemoryStore()
    await storage.set('accounts', JSON.stringify([account]))
    await storage.set('selectedAccount', JSON.stringify(account.addr))

    keystore = new KeystoreController(storage, { internal: InternalSigner }, windowManager)
    let providersCtrl: ProvidersController
    const networksCtrl = new NetworksController(
      storage,
      fetch,
      (net) => {
        providersCtrl.setProvider(net)
      },
      (id) => providersCtrl.removeProvider(id)
    )
    providersCtrl = new ProvidersController(networksCtrl)
    providersCtrl.providers = providers

    accountsCtrl = new AccountsController(
      storage,
      providersCtrl,
      networksCtrl,
      () => {},
      () => {}
    )

    signMessageController = new SignMessageController(
      keystore,
      providersCtrl,
      networksCtrl,
      accountsCtrl,
      {}
    )
  })

  test('should initialize with a valid message and then - reset', async () => {
    await signMessageController.init({ messageToSign })
    expect(signMessageController.isInitialized).toBeTruthy()
    expect(signMessageController.messageToSign).toEqual(messageToSign)

    signMessageController.reset()
    expect(signMessageController.isInitialized).toBeFalsy()
    expect(signMessageController.messageToSign).toBeNull()
    expect(signMessageController.signedMessage).toBeNull()
    expect(signMessageController.signingKeyAddr).toBeNull()
    expect(signMessageController.signingKeyType).toBeNull()
  })

  test('should not initialize with an invalid message kind', async () => {
    const invalidMessageToSign: Message = {
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

    await signMessageController.init({ messageToSign: invalidMessageToSign })

    expect(signMessageController.isInitialized).toBeFalsy()
    expect(mockEmitError).toHaveBeenCalled()
  })

  test('should set signing key address', async () => {
    const signingKeyAddr = account.addr

    await signMessageController.init({ messageToSign })
    signMessageController.setSigningKey(signingKeyAddr, 'internal')

    expect(signMessageController.signingKeyAddr).toBe(signingKeyAddr)
    expect(signMessageController.signingKeyType).toBe('internal')
  })

  // TODO: Would be better to test the signing via the Main controller -> handleSignMessage instead
  test('should sign a message', async () => {
    const signingKeyAddr = account.addr
    const dummySignature =
      '0x5b2dce98c7179051d21407be04bcd088243cd388ed51c4c64ccae115ca8787d85cff933dcde45220c3adfcc40f7958305e195dbd4c54580dfbf61e43438cbe9a1c'

    const mockSigner = {
      // @ts-ignore for mocking purposes only
      signMessage: jest.fn().mockResolvedValue(dummySignature),
      key: { addr: signingKeyAddr, type: 'internal', dedicatedToOneSA: true, meta: {} }
    }

    // @ts-ignore spy on the getSigner method and mock its implementation
    const getSignerSpy = jest.spyOn(keystore, 'getSigner').mockResolvedValue(mockSigner)

    await signMessageController.init({ messageToSign })
    signMessageController.setSigningKey(signingKeyAddr, 'internal')

    await accountsCtrl.updateAccountState(messageToSign.accountAddr, 'latest', [
      messageToSign.networkId
    ])

    await signMessageController.sign()

    // expect(mockSigner.signMessage).toHaveBeenCalledWith(messageToSign.content.message)
    expect(signMessageController.signedMessage?.signature).toBe(dummySignature)

    getSignerSpy.mockRestore() // cleans up the spy
  })
  test('removeAccountData', async () => {
    await signMessageController.init({ messageToSign })
    expect(signMessageController.isInitialized).toBeTruthy()

    signMessageController.removeAccountData(account.addr)
    expect(signMessageController.isInitialized).toBeFalsy()
  })
})
