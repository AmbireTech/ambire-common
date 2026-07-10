import { describe, expect, test } from '@jest/globals'

import { makeDapp } from '../../../test/helpers/dapps'
import { makeMainController } from '../../../test/helpers/mainController'
import { Session } from '../../classes/session'
import {
  BenzinUserRequest,
  CallsUserRequest,
  DappConnectRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { generateUuid } from '../../utils/uuid'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'

const MOCK_SESSION = new Session({ tabId: 1, url: 'https://test-dApp.com' })
const TEST_DAPP = makeDapp({
  id: MOCK_SESSION.id,
  name: 'Test Dapp',
  url: MOCK_SESSION.origin,
  chainId: 1,
  chainIds: [1]
})

const accounts = [
  {
    addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  },
  {
    addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
    associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  },
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: [],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  }
]

const prepareTest = async (seedTestDapp = false) => {
  const { mainCtrl, eventEmitterRegistry, getWindowId, eventEmitter } = await makeMainController(
    async (storageCtrl) => {
      await storageCtrl.set('accounts', accounts)
      await storageCtrl.set('selectedAccount', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
      if (seedTestDapp) await storageCtrl.set('dappsV2', [TEST_DAPP])
    }
  )

  // Mock account states for all accounts
  for (const account of mainCtrl.accounts.accounts) {
    mainCtrl.accounts.accountStates[account.addr] = {}
    for (const network of mainCtrl.networks.networks) {
      mainCtrl.accounts.accountStates[account.addr]![network.chainId.toString()] = {
        accountAddr: account.addr,
        isDeployed: true,
        eoaNonce: null,
        nonce: 0n,
        erc4337Nonce: 0n,
        associatedKeys: [],
        importedAccountKeys: [],
        balance: 0n,
        isEOA: false,
        isErc4337Enabled: false,
        isErc4337Nonce: false,
        isV2: true,
        currentBlock: 0n,
        isSmarterEoa: false,
        delegatedContract: null,
        delegatedContractName: null,
        threshold: 1,
        updatedAt: 0
      } as any
    }
  }

  const getSignAccountOp = async ({
    addr,
    chainId,
    requestId
  }: {
    addr: string
    chainId: bigint
    requestId: string
  }) => {
    await mainCtrl.accounts.initialLoadPromise
    await mainCtrl.networks.initialLoadPromise
    await mainCtrl.signAccountOpPreference.initialLoadPromise
    const account = mainCtrl.accounts.accounts.find((a) => a.addr === addr)!
    const network = mainCtrl.networks.networks.find((n) => n.chainId === chainId)!

    const signAccountOp = new SignAccountOpController({
      type: 'default',
      callRelayer: mainCtrl.callRelayer,
      accounts: mainCtrl.accounts,
      networks: mainCtrl.networks,
      keystore: mainCtrl.keystore,
      portfolio: mainCtrl.portfolio,
      featureFlags: mainCtrl.featureFlags,
      signAccountOpPreference: mainCtrl.signAccountOpPreference,
      externalSignerControllers: {},
      activity: mainCtrl.activity,
      account,
      network,
      eventEmitterRegistry,
      provider: mainCtrl.providers.providers[network.chainId.toString()]!,
      phishing: mainCtrl.phishing,
      dapps: mainCtrl.dapps,
      fromRequestId: requestId,
      accountOp: {
        id: generateUuid(),
        accountAddr: addr,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId,
        nonce: 0n, // does not matter when estimating
        calls: [
          {
            id: 'testID',
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            value: BigInt(0),
            data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
          }
        ],
        signature: null
      },
      shouldSimulate: false,
      onUpdateAfterTraceCallSuccess: async () => {},
      onBroadcastSuccess: async () => {},
      onBroadcastFailed: () => {}
    })
    // Prevent the recurring estimation timer from reaching V1.getAvailableFeeOptions
    // (which throws for accounts with no ETH on the test networks).
    jest.spyOn(signAccountOp.estimation, 'estimate').mockResolvedValue(undefined)
    return signAccountOp
  }

  const getCallsRequest = async ({ addr, chainId }: { addr: string; chainId: bigint }) => {
    const requestId = `${addr}-${chainId}`
    return {
      id: requestId,
      kind: 'calls',
      signAccountOp: await getSignAccountOp({ addr, chainId, requestId }),
      meta: {
        accountAddr: addr,
        isWalletSendCalls: false,
        chainId,
        paymasterService: undefined
      },
      dappPromises: [
        {
          id: 'testID',
          resolve: () => {},
          reject: () => {},
          session: MOCK_SESSION,
          meta: {}
        }
      ]
    } as CallsUserRequest
  }

  return {
    selectedAccountCtrl: mainCtrl.selectedAccount,
    controller: mainCtrl.requests,
    getSignAccountOp,
    getCallsRequest,
    event: eventEmitter,
    getWindowId,
    uiCtrl: mainCtrl.ui
  }
}

const DAPP_CONNECT_REQUEST: DappConnectRequest = {
  id: 1,
  kind: 'dappConnect',
  meta: {},
  dappPromises: [
    {
      id: 'testID',
      resolve: () => {},
      reject: () => {},
      session: MOCK_SESSION,
      meta: {}
    }
  ]
}

describe('RequestsController ', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('Add and then remove a user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.removeUserRequests([req.id])
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
  })
  test('build dapp request', async () => {
    const { controller } = await prepareTest()

    await controller.build({
      type: 'dappRequest',
      params: {
        request: {
          method: 'dapp_connect',
          params: {},
          session: MOCK_SESSION
        },
        dappPromise: { id: 'testID', resolve: () => {}, reject: () => {}, session: MOCK_SESSION }
      }
    })

    expect(controller.userRequests.length).toBe(1)
    expect(controller.userRequests[0]!.kind).toBe('dappConnect')
  })
  test('build transfer request', async () => {
    const { controller } = await prepareTest()

    await controller.build({
      type: 'transferRequest',
      params: {
        selectedToken: {
          marketDataIn: [],
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        },
        amount: '1',
        amountInFiat: 100000n,
        executionType: 'open-request-window',
        recipientAddress: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        recipientDomain: undefined
      }
    })

    expect(controller.userRequests.length).toBe(1)
    expect(controller.userRequests[0]!.kind).toBe('calls')
  })
  test('build contract deployment dapp request', async () => {
    const { controller } = await prepareTest(true)

    await expect(
      controller.build({
        type: 'dappRequest',
        params: {
          request: {
            method: 'eth_sendTransaction',
            params: [
              {
                from: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
                value: '0x0',
                data: '0x6080604052348015600e575f5ffd5b50600080fd'
              }
            ],
            session: MOCK_SESSION
          },
          dappPromise: {
            id: 'testID',
            resolve: () => {},
            reject: () => {},
            session: MOCK_SESSION
          }
        }
      })
    ).resolves.toBeUndefined()

    expect(controller.userRequests.length).toBe(1)
    expect(controller.userRequests[0]!.kind).toBe('calls')
    expect(
      (controller.userRequests[0] as CallsUserRequest).signAccountOp.accountOp.calls[0]!.to
    ).toBeUndefined()
  })
  test('resolve user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()

    const resolveMock = jest.fn()
    const rejectMock = jest.fn()
    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    req.dappPromises = [
      { id: 'testID', resolve: resolveMock, reject: rejectMock, session: MOCK_SESSION, meta: {} }
    ]

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.resolveUserRequest(null, req.id)
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
    expect(resolveMock).toHaveBeenCalled()
    expect(rejectMock).not.toHaveBeenCalled()
  })
  test('reject user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()

    const resolveMock = jest.fn()
    const rejectMock = jest.fn()

    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    req.dappPromises = [
      { id: 'testID', resolve: resolveMock, reject: rejectMock, session: MOCK_SESSION, meta: {} }
    ]

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.rejectUserRequests('User rejected', [req.id])
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
    expect(rejectMock).toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
  })
  test('add multiple user requests', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })
    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])
    expect(controller.userRequests.length).toBe(2)
    expect(controller.visibleUserRequests.length).toBe(2)
    expect(controller.currentUserRequest).not.toBe(null)
    expect(controller.currentUserRequest!.kind).toBe(SIGN_ACCOUNT_OP_REQUEST.kind)
  })
  test('should set window loaded', async () => {
    const { controller } = await prepareTest()
    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    expect(controller.currentUserRequest).not.toBe(null)
    controller.setWindowLoaded()
    expect(controller.requestWindow.loaded).toEqual(true)
  })
  test('should reject calls and remove the user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])
    expect(controller.currentUserRequest).not.toBe(null)
    expect(
      (controller.currentUserRequest as CallsUserRequest).signAccountOp.accountOp.calls.length
    ).toBe(1)
    await controller.rejectCalls({ callIds: ['testID'] })
    expect(controller.currentUserRequest).toBe(null)
    expect(controller.userRequests.length).toBe(0)
  })
  test('should add request with priority', async () => {
    const { controller } = await prepareTest()
    const BENZIN_REQUEST: BenzinUserRequest = {
      id: 'test',
      kind: 'benzin',
      meta: {
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        chainId: 10n,
        txnId: 'id',
        userOpHash: 'hash'
      },
      dappPromises: []
    }

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([BENZIN_REQUEST], { position: 'first' })
    expect(controller.visibleUserRequests[0]).not.toBe(null)
    expect(controller.visibleUserRequests[0]!.kind).toBe('benzin')
  })
  test('should have banners', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.banners).toHaveLength(2)
  })
  test('should update visible requests on account change', async () => {
    const { controller, selectedAccountCtrl, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.visibleUserRequests).toHaveLength(2)
    await selectedAccountCtrl.setAccount(accounts[0]! as any)
    expect(controller.visibleUserRequests).toHaveLength(1)
  })
  test('should select request by id', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.currentUserRequest).toBe(SIGN_ACCOUNT_OP_REQUEST)
    await controller.setCurrentUserRequestById(DAPP_CONNECT_REQUEST.id)
    expect(controller.currentUserRequest).toBe(DAPP_CONNECT_REQUEST)
  })
  test('should select request by index', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.currentUserRequest).toBe(SIGN_ACCOUNT_OP_REQUEST)
    await controller.setCurrentUserRequestByIndex(0)
    expect(controller.currentUserRequest).toBe(DAPP_CONNECT_REQUEST)
  })
  test('should focus out and then focus on the current request window', async () => {
    const { controller, event, getWindowId } = await prepareTest()

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    event.emit('windowFocusChange', 'random-window-id')
    let emitCounter = 0
    const finishPromise = new Promise((resolve) => {
      emitCounter++

      if (emitCounter === 1) {
        expect(controller.requestWindow.windowProps).not.toBe(null)
        expect(controller.requestWindow.windowProps?.focused).toEqual(false)
        event.emit('windowFocusChange', getWindowId())
      }
      if (emitCounter === 1) {
        expect(controller.requestWindow.windowProps).not.toBe(null)
        expect(controller.requestWindow.windowProps?.focused).toEqual(true)
        resolve(null)
      }
    })
    await finishPromise
  })
  test('should close the request window', async () => {
    const { controller } = await prepareTest()

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])

    expect(controller.requestWindow.windowProps).not.toBe(null)
    await controller.closeRequestWindow()
    expect(controller.requestWindow.windowProps).toBe(null)
  })
  test('removeAccountData', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST], {
      position: 'last',
      executionType: 'queue'
    })
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST], {
      position: 'last',
      executionType: 'open-request-window'
    })

    expect(controller.userRequests.length).toBeGreaterThanOrEqual(2)

    // Remove account data
    controller.removeAccountData('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')

    const globalActions = controller.userRequests.filter((a) => !['calls'].includes(a?.kind))

    expect(controller.userRequests).toHaveLength(globalActions.length)
  })
  test('should toJSON()', async () => {
    const { controller } = await prepareTest()

    expect(controller.toJSON()).toBeDefined()
  })

  describe('call data and "to" field validation', () => {
    const FROM = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const VALID_TO = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    const buildEthSendTx = (
      controller: Awaited<ReturnType<typeof prepareTest>>['controller'],
      txParams: { from: string; to?: string; value?: string; data?: string }
    ) =>
      controller.build({
        type: 'dappRequest',
        params: {
          request: {
            method: 'eth_sendTransaction',
            params: [txParams],
            session: MOCK_SESSION
          },
          dappPromise: {
            id: 'testID',
            resolve: () => {},
            reject: () => {},
            session: MOCK_SESSION
          }
        }
      })

    const buildWalletSendCalls = (
      controller: Awaited<ReturnType<typeof prepareTest>>['controller'],
      calls: { to?: string; value?: string; data?: string }[]
    ) =>
      controller.build({
        type: 'dappRequest',
        params: {
          request: {
            method: 'wallet_sendCalls',
            params: [{ from: FROM, chainId: '0x1', calls }],
            session: MOCK_SESSION
          },
          dappPromise: {
            id: 'testID',
            resolve: () => {},
            reject: () => {},
            session: MOCK_SESSION
          }
        }
      })

    test('rejects eth_sendTransaction with odd-length hex data', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildEthSendTx(controller, { from: FROM, to: VALID_TO, value: '0x0', data: '0x1' })
      ).rejects.toThrow('A call has uneven number of character in the hex data.')
    })

    test('rejects eth_sendTransaction with non-hex data (even length, no 0x prefix)', async () => {
      const { controller } = await prepareTest(true)

      // Even length so it passes the odd-length check; no 0x prefix so isHex returns false
      await expect(
        buildEthSendTx(controller, { from: FROM, to: VALID_TO, value: '0x0', data: 'aabbccdd' })
      ).rejects.toThrow('A call has invalid data.')
    })

    test('rejects eth_sendTransaction with invalid "to" address', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildEthSendTx(controller, { from: FROM, to: 'not-an-address', value: '0x0' })
      ).rejects.toThrow('A call has invalid "to" field ')
    })

    test('accepts eth_sendTransaction without a "to" field (contract deployment)', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildEthSendTx(controller, { from: FROM, value: '0x0', data: '0x6080604052' })
      ).resolves.toBeUndefined()
    })

    test('accepts eth_sendTransaction without a data field', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildEthSendTx(controller, { from: FROM, to: VALID_TO, value: '0x0' })
      ).resolves.toBeUndefined()
    })

    test('rejects wallet_sendCalls when any call has odd-length hex data', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildWalletSendCalls(controller, [
          { to: VALID_TO, value: '0x0', data: '0x1234' },
          { to: VALID_TO, value: '0x0', data: '0x1' }
        ])
      ).rejects.toThrow('A call has uneven number of character in the hex data.')
    })

    test('rejects wallet_sendCalls when any call has an invalid "to" address', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildWalletSendCalls(controller, [
          { to: VALID_TO, value: '0x0' },
          { to: 'bad-address', value: '0x0' }
        ])
      ).rejects.toThrow('A call has invalid "to" field ')
    })

    test('accepts wallet_sendCalls where a call omits "to" (contract deployment within batch)', async () => {
      const { controller } = await prepareTest(true)

      await expect(
        buildWalletSendCalls(controller, [
          { to: VALID_TO, value: '0x0' },
          { value: '0x0', data: '0x6080604052' }
        ])
      ).resolves.toBeUndefined()
    })
  })

  describe('eth_signTypedData_v4 typed data validation', () => {
    const FROM = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

    const VALID_TYPED_DATA = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' }
        ],
        Mail: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'contents', type: 'string' }
        ]
      },
      primaryType: 'Mail',
      domain: { name: 'Test Mail', version: '1', chainId: 1 },
      message: {
        from: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        to: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
        contents: 'Hello!'
      }
    }

    const buildSignTypedDataRequest = (
      controller: Awaited<ReturnType<typeof prepareTest>>['controller'],
      typedData: object
    ) =>
      controller.build({
        type: 'dappRequest',
        params: {
          request: {
            method: 'eth_signTypedData_v4',
            params: [FROM, JSON.stringify(typedData)],
            session: MOCK_SESSION
          },
          dappPromise: {
            id: 'testID',
            resolve: () => {},
            reject: () => {},
            session: MOCK_SESSION
          }
        }
      })

    test('rejects when primaryType is missing from types', async () => {
      const { controller } = await prepareTest(true)
      const typedData = {
        ...VALID_TYPED_DATA,
        types: { EIP712Domain: VALID_TYPED_DATA.types.EIP712Domain }
      }
      await expect(buildSignTypedDataRequest(controller, typedData)).rejects.toThrow(
        'The primary data type is missing from the provided types'
      )
    })

    test('rejects when message contents do not match the declared types', async () => {
      const { controller } = await prepareTest(true)
      const typedData = {
        ...VALID_TYPED_DATA,
        message: {
          from: 'not-a-valid-address',
          to: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
          contents: 'Hello!'
        }
      }
      await expect(buildSignTypedDataRequest(controller, typedData)).rejects.toThrow(
        'The message contents did not match the provided types.'
      )
    })

    test('accepts valid typed data and creates a typedMessage user request', async () => {
      const { controller } = await prepareTest(true)
      await expect(buildSignTypedDataRequest(controller, VALID_TYPED_DATA)).resolves.toBeUndefined()
      expect(controller.userRequests.length).toBe(1)
      expect(controller.userRequests[0]!.kind).toBe('typedMessage')
    })

    test('rejects when domain.chainId does not match the current network chainId', async () => {
      const { controller } = await prepareTest(true)
      const typedData = {
        ...VALID_TYPED_DATA,
        domain: { ...VALID_TYPED_DATA.domain, chainId: 999 }
      }
      await expect(buildSignTypedDataRequest(controller, typedData)).rejects.toThrow(
        'The domain chainId (999) does not match the current network chainId (1)'
      )
    })

    test('replaces domain.chainId with current network chainId when domain.chainId is 0', async () => {
      const { controller } = await prepareTest(true)
      const typedData = {
        ...VALID_TYPED_DATA,
        domain: { ...VALID_TYPED_DATA.domain, chainId: 0 }
      }
      await expect(buildSignTypedDataRequest(controller, typedData)).resolves.toBeUndefined()
      expect(controller.userRequests.length).toBe(1)
      const req = controller.userRequests[0]! as any
      expect(req.meta.params.domain.chainId).toBe(1n)
    })

    test('accepts typed data with no domain.chainId regardless of current network', async () => {
      const { controller } = await prepareTest(true)
      const typedData = {
        ...VALID_TYPED_DATA,
        types: {
          ...VALID_TYPED_DATA.types,
          EIP712Domain: VALID_TYPED_DATA.types.EIP712Domain.filter((f) => f.name !== 'chainId')
        },
        domain: { name: VALID_TYPED_DATA.domain.name, version: VALID_TYPED_DATA.domain.version }
      }
      await expect(buildSignTypedDataRequest(controller, typedData)).resolves.toBeUndefined()
      expect(controller.userRequests.length).toBe(1)
      const req = controller.userRequests[0]! as any
      expect(req.kind).toBe('typedMessage')
      expect(req.meta.params.domain.chainId).toBe(1n)
    })
  })
})
