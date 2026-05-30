import { hexlify, randomBytes } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import {
  blacklistedDapp,
  customDapp,
  failedDapp,
  getDappRequestData,
  getDappVerificationTestDapps,
  loadingDapp,
  verifiedDapp
} from '../../../test/helpers/dapps'
import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { Account, IAccountsController } from '../../interfaces/account'
import { DAPP_VERIFICATION_BANNER_IDS, IDappsController } from '../../interfaces/dapp'
import { Hex } from '../../interfaces/hex'
import { IInviteController } from '../../interfaces/invite'
import { IKeystoreController, Key, KeystoreSignerInterface } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISignMessageController } from '../../interfaces/signMessage'
import { Message } from '../../interfaces/userRequest'
import { SignMessageController } from './signMessage'

class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    s
  ) => '0x'
}

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

const messageToSign: Message = {
  fromRequestId: 1,
  content: { kind: 'message', message: '0x74657374' },
  accountAddr: account.addr,
  chainId: 1n,
  signature: null
}

const dapp = {
  name: 'Test Dapp',
  icon: 'https://test-dapp.com/icon.png',
  url: 'https://Test-Dapp.com'
}

describe('SignMessageController', () => {
  let signMessageController: ISignMessageController
  let keystoreCtrl: IKeystoreController
  let accountsCtrl: IAccountsController
  let networksCtrl: INetworksController
  let providersCtrl: IProvidersController
  let inviteCtrl: IInviteController
  let dappsCtrl: IDappsController

  beforeAll(async () => {
    const { mainCtrl } = await makeMainController(
      async (storageCtrl) => {
        await storageCtrl.set('accounts', [account])
        await storageCtrl.set('selectedAccount', account.addr)
        await storageCtrl.set('dappsV2', getDappVerificationTestDapps())
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      },
      { skipAccountStateLoad: false, overrides: { keystoreSigners: { internal: InternalSigner } } }
    )
    keystoreCtrl = mainCtrl.keystore
    networksCtrl = mainCtrl.networks
    providersCtrl = mainCtrl.providers
    accountsCtrl = mainCtrl.accounts
    inviteCtrl = mainCtrl.invite
    dappsCtrl = mainCtrl.dapps
  })

  beforeEach(async () => {
    signMessageController = new SignMessageController(
      keystoreCtrl,
      providersCtrl,
      networksCtrl,
      accountsCtrl,
      {},
      inviteCtrl,
      undefined,
      dappsCtrl
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
    expect(signMessageController.signer).toBeUndefined()
  })

  test('should not initialize with an invalid message kind', async () => {
    const invalidMessageToSign: Message = {
      id: 1,
      content: {
        // @ts-expect-error that's on purpose, for the test
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
    signMessageController.setSigners([{ addr: signingKeyAddr, type: 'internal' }])

    expect(signMessageController.signers).not.toBe(undefined)
    expect(signMessageController.signers?.length).toBe(1)
    expect(signMessageController.signers![0]!.addr).toBe(signingKeyAddr)
    expect(signMessageController.signers![0]!.type).toBe('internal')
  })

  // TODO: Would be better to test the signing via the Main controller -> handleSignMessage instead
  test('should sign a message', async () => {
    const signingKeyAddr = account.addr
    const dummySignature =
      '0x5b2dce98c7179051d21407be04bcd088243cd388ed51c4c64ccae115ca8787d85cff933dcde45220c3adfcc40f7958305e195dbd4c54580dfbf61e43438cbe9a1c'

    const mockSigner = {
      // @ts-expect-error for mocking purposes only
      signMessage: jest.fn().mockResolvedValue(dummySignature),
      key: { addr: signingKeyAddr, type: 'internal', dedicatedToOneSA: true, meta: {} }
    }

    // @ts-expect-error spy on the getSigner method and mock its implementation
    const getSignerSpy = jest.spyOn(keystoreCtrl, 'getSigner').mockResolvedValue(mockSigner)

    await signMessageController.init({ messageToSign })
    signMessageController.setSigners([{ addr: signingKeyAddr, type: 'internal' }])

    await accountsCtrl.updateAccountState(messageToSign.accountAddr, 'latest')

    await signMessageController.sign()

    expect(signMessageController.signedMessage?.signature).toBe(dummySignature)

    getSignerSpy.mockRestore() // cleans up the spy
  })
  test('removeAccountData', async () => {
    await signMessageController.init({ messageToSign })
    expect(signMessageController.isInitialized).toBeTruthy()

    signMessageController.removeAccountData(account.addr)
    expect(signMessageController.isInitialized).toBeFalsy()
  })

  describe('dapp verification banners', () => {
    test('should return loading banners', () => {
      signMessageController.dapp = getDappRequestData(loadingDapp)

      expect(signMessageController.banners).toEqual([
        {
          id: DAPP_VERIFICATION_BANNER_IDS.LOADING,
          type: 'warning',
          text: "We're still verifying the app. Please wait, or make sure you trust it before signing requests."
        }
      ])
    })

    test('should return failed verification banners', () => {
      signMessageController.dapp = getDappRequestData(failedDapp)

      expect(signMessageController.banners).toEqual([
        {
          id: DAPP_VERIFICATION_BANNER_IDS.FAILED_TO_GET_OR_UNKNOWN,
          type: 'warning',
          text: "We couldn't verify the app. Make sure you trust it before signing requests."
        }
      ])
    })

    test('should return blacklisted banners', () => {
      signMessageController.dapp = getDappRequestData(blacklistedDapp)

      expect(signMessageController.banners).toEqual([
        {
          id: DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED,
          type: 'error',
          text: "This app didn't pass our safety check. Proceed at your own risk."
        }
      ])
    })

    test('should not return not-in-catalog banners', () => {
      signMessageController.dapp = getDappRequestData(customDapp)

      expect(signMessageController.banners).toEqual([])
    })

    test('should not return banners when the dapp is verified and in the default catalog', () => {
      signMessageController.dapp = getDappRequestData(verifiedDapp)

      expect(signMessageController.banners).toEqual([])
    })
  })
})
