import { clearErc7730RegistryCache } from '@/libs/humanizer'
import { ERC7730_DESCRIPTOR_WAIT_MS } from '@/libs/humanizer/erc7730/consts'
import { describe, expect, jest, test } from '@jest/globals'

import {
  blacklistedDapp,
  customDapp,
  failedDapp,
  getDappRequestData,
  getDappVerificationTestDapps,
  loadingDapp,
  suspiciousHostingDapp,
  verifiedDapp
} from '../../../test/helpers/dapps'
import { makeMainController } from '../../../test/helpers/mainController'
import { InternalSigner } from '../../../test/keystore'
import { Session } from '../../classes/session'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { SAFE_API_TIMEOUT_MS } from '../../consts/safe'
import { Account, IAccountsController } from '../../interfaces/account'
import { DAPP_VERIFICATION_BANNER_IDS, IDappsController } from '../../interfaces/dapp'
import { Hex } from '../../interfaces/hex'
import { IInviteController } from '../../interfaces/invite'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISignMessageController } from '../../interfaces/signMessage'
import { Message } from '../../interfaces/userRequest'
import * as safeLib from '../../libs/safe/safe'
import { SignMessageController } from './signMessage'

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

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const createPermitTypedMessage = (): Message => ({
  fromRequestId: 2,
  accountAddr: account.addr,
  chainId: 1n,
  signature: null,
  content: {
    kind: 'typedMessage',
    domain: {
      name: 'USD Coin',
      chainId: 1,
      verifyingContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      version: '2'
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    },
    primaryType: 'Permit',
    message: {
      owner: account.addr,
      spender: '0x0000000000000000000000000000000000000000',
      value: '133700',
      nonce: '0',
      deadline: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    }
  }
})

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

  beforeEach(() => {
    clearErc7730RegistryCache()
  })
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

  test('should resolve when adding a message to Safe Global times out', async () => {
    const accountsController = {
      initialLoadPromise: Promise.resolve(),
      accounts: [account],
      getOrFetchAccountOnChainState: jest.fn().mockResolvedValue({
        importedAccountKeys: []
      })
    } as unknown as IAccountsController
    const controller = new SignMessageController(
      keystoreCtrl,
      providersCtrl,
      networksCtrl,
      accountsController,
      {},
      inviteCtrl
    )
    await controller.init({ messageToSign })
    jest.useFakeTimers()
    const addMessageSpy = jest
      .spyOn(safeLib, 'addMessage')
      .mockImplementation(() => new Promise(() => undefined))
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      const addMessagePromise = controller.addMsgToSafeGlobal('0xsignature', 'message')

      await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS)

      await expect(addMessagePromise).resolves.toBeUndefined()
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'failed to send message to Safe Global: ',
        new Error(`Safe API: add message timed out after ${SAFE_API_TIMEOUT_MS}ms`)
      )
    } finally {
      addMessageSpy.mockRestore()
      consoleLogSpy.mockRestore()
      jest.useRealTimers()
    }
  })

  test('should expose Safe EIP-712 data when initializing a Safe message', async () => {
    const safeAccount: Account = {
      ...account,
      safeCreation: {
        factoryAddr: account.addr as Hex,
        singleton: account.addr as Hex,
        saltNonce: '0x00',
        setupData: '0x',
        version: '1.4.1'
      }
    }
    const safeAccountsCtrl = {
      initialLoadPromise: Promise.resolve(),
      accounts: [safeAccount],
      getOrFetchAccountOnChainState: jest.fn().mockResolvedValue({
        importedAccountKeys: []
      })
    } as unknown as IAccountsController
    const safeSignMessageController = new SignMessageController(
      keystoreCtrl,
      providersCtrl,
      networksCtrl,
      safeAccountsCtrl,
      {},
      inviteCtrl
    )

    await safeSignMessageController.init({
      messageToSign: { ...messageToSign, accountAddr: safeAccount.addr }
    })

    expect(safeSignMessageController.safeEip712Data).toMatchObject({
      primaryType: 'SafeMessage',
      safeMessageHash: expect.stringMatching(/^0x/),
      domainHash: expect.stringMatching(/^0x/),
      messageHash: expect.stringMatching(/^0x/)
    })

    safeSignMessageController.reset()
    expect(safeSignMessageController.safeEip712Data).toBeNull()
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

  test('fetches ERC-7730 EIP-712 descriptors through the relayer', async () => {
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const registryPath = 'registry/permit/eip712-permit-ethereum-usdc.json'
    const typedMessageToSign = createPermitTypedMessage()
    const descriptorResponse = createDeferred<any>()
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${usdc}`]: {
              Permit: [{ path: registryPath }]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return descriptorResponse.promise
      }

      throw new Error(`Unexpected relayer call: ${path}`)
    })

    signMessageController = new SignMessageController(
      keystoreCtrl,
      providersCtrl,
      networksCtrl,
      accountsCtrl,
      {},
      inviteCtrl,
      undefined,
      dappsCtrl,
      callRelayer
    )

    await signMessageController.init({ messageToSign: typedMessageToSign })

    expect(signMessageController.isHumanizing).toBe(true)
    expect(signMessageController.humanizedMessage).toBeUndefined()

    descriptorResponse.resolve({
      success: true,
      display: {
        formats: {
          'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)': {
            intent: 'Authorize spending of tokens',
            fields: [
              {
                path: 'spender',
                label: 'Spender',
                format: 'addressName',
                visible: 'always'
              },
              {
                path: 'value',
                label: 'Max spending amount',
                format: 'tokenAmount',
                params: { tokenPath: '@.to' },
                visible: 'always'
              }
            ]
          }
        }
      }
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(signMessageController.isHumanizing).toBe(false)
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/eip-712',
      'GET',
      undefined,
      undefined,
      ERC7730_DESCRIPTOR_WAIT_MS
    )
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/fetch-descriptor',
      'POST',
      {
        descriptorPath: `/${registryPath}`
      },
      undefined,
      ERC7730_DESCRIPTOR_WAIT_MS
    )
    expect(signMessageController.humanizedMessage?.fullVisualization?.[0]).toMatchObject({
      type: 'erc7730',
      title: 'Authorize spending of tokens',
      rows: [
        {
          label: 'Spender',
          value: [{ type: 'address', address: '0x0000000000000000000000000000000000000000' }]
        },
        {
          label: 'Max spending amount',
          value: [{ type: 'token', address: usdc, value: 133700n, chainId: 1n }]
        }
      ]
    })

    callRelayer.mockClear()
    signMessageController.reset()
    await signMessageController.init({ messageToSign: typedMessageToSign })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(callRelayer).not.toHaveBeenCalled()
    expect(signMessageController.humanizedMessage?.fullVisualization?.[0]).toMatchObject({
      type: 'erc7730',
      title: 'Authorize spending of tokens'
    })
  })

  test('humanizes a 1inch Order EIP-712 descriptor served as raw relayer JSON', async () => {
    const aggregationRouter = '0x111111125421ca6dc452d289314280a0f8842a65'
    const registryPath = 'registry/1inch/eip712-AggregationRouterV6.json'
    const typedMessageToSign: Message = {
      fromRequestId: 3,
      accountAddr: account.addr,
      chainId: 10n,
      signature: null,
      content: {
        kind: 'typedMessage',
        types: {
          Order: [
            { name: 'salt', type: 'uint256' },
            { name: 'maker', type: 'address' },
            { name: 'receiver', type: 'address' },
            { name: 'makerAsset', type: 'address' },
            { name: 'takerAsset', type: 'address' },
            { name: 'makingAmount', type: 'uint256' },
            { name: 'takingAmount', type: 'uint256' },
            { name: 'makerTraits', type: 'uint256' }
          ],
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ]
        },
        domain: {
          name: '1inch Aggregation Router',
          version: '6',
          chainId: '0xa',
          verifyingContract: aggregationRouter
        },
        message: {
          salt: '77345521712855512255420844903274714029333070352494440782855394858654424276150',
          maker: '0xd8293ad21678c6f09da139b4b62d38e514a03b78',
          receiver: '0x0000000000000000000000000000000000000000',
          makerAsset: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6',
          takerAsset: '0x76fb31fb4af56892a25e32cfc43de717950c9278',
          makingAmount: '366891214241290415',
          takingAmount: '39061263450812873',
          makerTraits:
            '62419173104490761595518734106350460423656760415424099978067514748855868456960'
        },
        primaryType: 'Order'
      }
    }
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:10:${aggregationRouter}`]: {
              Order: [
                {
                  path: registryPath,
                  encodeTypeHashes: [
                    '0x3af21ec5a20011b88d3b7b4ed7c806cef05a5980cf34974bcd53566a131f7e4c'
                  ]
                }
              ]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          $schema: '../../specs/erc7730-v2.schema.json',
          context: {
            eip712: {
              deployments: [{ chainId: 10, address: aggregationRouter }],
              domain: { name: '1inch Aggregation Router', version: '6' }
            }
          },
          metadata: { owner: '1inch AggregationRouterV6' },
          display: {
            formats: {
              'Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)':
                {
                  intent: '1inch Order',
                  fields: [
                    { path: 'maker', label: 'From', format: 'raw' },
                    {
                      path: 'makingAmount',
                      label: 'Send',
                      format: 'tokenAmount',
                      params: { tokenPath: 'makerAsset' }
                    },
                    {
                      path: 'takingAmount',
                      label: 'Receive minimum',
                      format: 'tokenAmount',
                      params: { tokenPath: 'takerAsset' }
                    },
                    { path: 'receiver', label: 'To', format: 'raw' },
                    { label: 'Salt', path: 'salt', visible: 'never' },
                    { label: 'Maker Traits', path: 'makerTraits', visible: 'never' }
                  ]
                }
            }
          }
        }
      }

      throw new Error(`Unexpected relayer call: ${path}`)
    })

    signMessageController = new SignMessageController(
      keystoreCtrl,
      providersCtrl,
      networksCtrl,
      accountsCtrl,
      {},
      inviteCtrl,
      undefined,
      dappsCtrl,
      callRelayer
    )

    await signMessageController.init({ messageToSign: typedMessageToSign })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/eip-712',
      'GET',
      undefined,
      undefined,
      ERC7730_DESCRIPTOR_WAIT_MS
    )
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/fetch-descriptor',
      'POST',
      {
        descriptorPath: `/${registryPath}`
      },
      undefined,
      ERC7730_DESCRIPTOR_WAIT_MS
    )
    expect(signMessageController.humanizedMessage?.fullVisualization?.[0]).toMatchObject({
      type: 'erc7730',
      title: '1inch Order'
    })
    const visualization = signMessageController.humanizedMessage?.fullVisualization?.[0] as any

    expect(visualization.rows.map((row: any) => row.label)).toEqual([
      'From',
      'Send',
      'Receive minimum'
    ])
    expect(visualization.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'To'
        })
      ])
    )
    expect(visualization.rows[1].value[0]).toMatchObject({
      type: 'token',
      address: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6',
      value: 366891214241290415n,
      chainId: 10n
    })
    expect(visualization.rows[2].value[0]).toMatchObject({
      type: 'token',
      address: '0x76fb31fb4af56892a25e32cfc43de717950c9278',
      value: 39061263450812873n,
      chainId: 10n
    })
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

  // Regression: a same-kind request replacing the installed message via init()
  // while signing awaits getSigner() must NOT be signed under the previous approval.
  test('does not sign a replacement request installed mid-signing', async () => {
    const signingKeyAddr = account.addr
    const dummySignature =
      '0x5b2dce98c7179051d21407be04bcd088243cd388ed51c4c64ccae115ca8787d85cff933dcde45220c3adfcc40f7958305e195dbd4c54580dfbf61e43438cbe9a1c'

    const r1 = messageToSign
    const r2: Message = {
      ...messageToSign,
      fromRequestId: 99,
      content: { kind: 'message', message: '0x6576696c' } // "evil"
    }

    const mockSigner = {
      // @ts-expect-error for mocking purposes only
      signMessage: jest.fn().mockResolvedValue(dummySignature),
      key: { addr: signingKeyAddr, type: 'internal', dedicatedToOneSA: true, meta: {} }
    }

    // Pause getSigner() so the replacement can be installed during its await - this is
    // the exact async boundary the exploit relies on.
    let releaseGetSigner!: () => void
    const getSignerGate = new Promise<void>((resolve) => {
      releaseGetSigner = resolve
    })
    const getSignerSpy = jest
      .spyOn(keystoreCtrl, 'getSigner')
      // @ts-expect-error mocked signer shape
      .mockImplementation(async () => {
        await getSignerGate
        return mockSigner
      })

    await accountsCtrl.updateAccountState(r1.accountAddr, 'latest')
    await signMessageController.init({ messageToSign: r1 })
    signMessageController.setSigners([{ addr: signingKeyAddr, type: 'internal' }])

    // Approval for R1 starts and blocks inside getSigner().
    const signPromise = signMessageController.sign()

    // Attacker races R2 onto the same controller before getSigner() resolves.
    await signMessageController.init({ messageToSign: r2 })

    releaseGetSigner()
    await signPromise

    // The stale R1 operation must abort: nothing signed, no message resolved.
    expect(mockSigner.signMessage).not.toHaveBeenCalled()
    expect(signMessageController.signedMessage).toBeNull()

    getSignerSpy.mockRestore()
  })

  test('should expose hardware wallet EIP-712 data while signing a typed message', async () => {
    const signingKeyAddr = account.addr
    const dummySignature =
      '0x5b2dce98c7179051d21407be04bcd088243cd388ed51c4c64ccae115ca8787d85cff933dcde45220c3adfcc40f7958305e195dbd4c54580dfbf61e43438cbe9a1c'
    const typedMessageToSign: Message = {
      fromRequestId: 3,
      accountAddr: account.addr,
      chainId: 1n,
      signature: null,
      content: {
        kind: 'typedMessage',
        domain: {
          chainId: 1,
          verifyingContract: account.addr
        },
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          Message: [{ name: 'contents', type: 'string' }]
        },
        primaryType: 'Message',
        message: {
          contents: 'Sign me'
        }
      }
    }
    let resolveSignature!: (signature: string) => void
    let notifySigningStarted!: () => void
    const signingStarted = new Promise<void>((resolve) => {
      notifySigningStarted = resolve
    })
    const mockSigner = {
      signTypedData: jest.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveSignature = resolve
            notifySigningStarted()
          })
      ),
      key: { addr: signingKeyAddr, type: 'internal', dedicatedToOneSA: true, meta: {} }
    }

    // @ts-expect-error spy on the getSigner method and mock its implementation
    const getSignerSpy = jest.spyOn(keystoreCtrl, 'getSigner').mockResolvedValue(mockSigner)

    await signMessageController.init({ messageToSign: typedMessageToSign })
    signMessageController.setSigners([{ addr: signingKeyAddr, type: 'internal' }])

    const signPromise = signMessageController.sign()
    await signingStarted

    expect(signMessageController.hardwareWalletSigningRequest).toMatchObject({
      type: 'eip-712',
      data: {
        primaryType: 'Message',
        domainHash: expect.stringMatching(/^0x/),
        messageHash: expect.stringMatching(/^0x/)
      }
    })

    resolveSignature(dummySignature)
    await signPromise

    expect(signMessageController.hardwareWalletSigningRequest).toBeNull()

    getSignerSpy.mockRestore()
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

    // Scenario: dApp's own domain is in SUSPICIOUS_HOSTING_DOMAINS (e.g. my-dapp.vercel.app)
    // intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING warning banner
    test('should return SUSPICIOUS_HOSTING warning banner for dapps on suspicious hosting platforms', () => {
      signMessageController.dapp = getDappRequestData(suspiciousHostingDapp)

      expect(signMessageController.banners).toEqual([
        {
          id: DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING,
          type: 'warning',
          text: 'This app is hosted on a shared platform commonly used for phishing. Be careful - do not sign unless you are certain you trust it.'
        }
      ])
    })

    // Scenario: VERIFIED dApp loaded as iframe inside a sites.google.com tab
    // intrinsic=VERIFIED, context=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING warning banner
    test('should return SUSPICIOUS_HOSTING banner from session context when dApp is an iframe in a suspicious hosting tab', () => {
      const verifiedDappSession = new Session({ tabId: 200, windowId: 1, url: verifiedDapp.url })
      const googleSession = new Session({
        tabId: 200,
        windowId: 1,
        url: 'https://sites.google.com'
      })
      dappsCtrl.dappSessions[verifiedDappSession.sessionId] = verifiedDappSession
      dappsCtrl.dappSessions[googleSession.sessionId] = googleSession

      signMessageController.dapp = {
        ...getDappRequestData(verifiedDapp),
        sessionId: verifiedDappSession.sessionId
      }

      try {
        expect(signMessageController.banners[0]?.id).toBe(
          DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING
        )
        expect(signMessageController.banners[0]?.type).toBe('warning')
      } finally {
        delete dappsCtrl.dappSessions[verifiedDappSession.sessionId]
        delete dappsCtrl.dappSessions[googleSession.sessionId]
      }
    })

    test('shows the loading banner while the dapps controller is still loading and clears it once resolved', async () => {
      const signMessageCtrl = new SignMessageController(
        keystoreCtrl,
        providersCtrl,
        networksCtrl,
        accountsCtrl,
        {},
        inviteCtrl,
        undefined,
        dappsCtrl
      )

      // Until the dapps controller finishes its initial storage load (e.g. right after a service
      // worker restart), verification is unknown and must be reported as in progress, never as
      // failed. A never-resolving promise holds it in that pending state.
      dappsCtrl.initialLoadPromise = new Promise<void>(() => {})

      try {
        await signMessageCtrl.init({ messageToSign, dapp: getDappRequestData(verifiedDapp) })
        // Flush the background humanization so its emit can't be mistaken for the one we assert on
        await new Promise((resolve) => {
          setTimeout(resolve, 0)
        })
        expect(signMessageCtrl.banners).toEqual([
          {
            id: DAPP_VERIFICATION_BANNER_IDS.LOADING,
            type: 'warning',
            text: "We're still verifying the app. Please wait, or make sure you trust it before signing requests."
          }
        ])

        let emitsCount = 0
        const unsubscribe = signMessageCtrl.onUpdate(() => {
          emitsCount++
        })

        // The load completes and the dapps controller emits; the controller must re-emit so the
        // loading banner is replaced by the resolved state (verified dapp in catalog → no banner).
        dappsCtrl.initialLoadPromise = undefined
        await dappsCtrl.forceEmitUpdate()

        expect(emitsCount).toBeGreaterThan(0)
        expect(signMessageCtrl.banners).toEqual([])

        unsubscribe()
      } finally {
        dappsCtrl.initialLoadPromise = undefined
      }
    })
  })
})
