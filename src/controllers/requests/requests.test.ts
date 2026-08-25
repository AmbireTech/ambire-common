import { Wallet, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { makeDapp } from '../../../test/helpers/dapps'
import { makeMainController } from '../../../test/helpers/mainController'
import { Session } from '../../classes/session'
import { Hex } from '../../interfaces/hex'
import {
  BenzinUserRequest,
  CallsUserRequest,
  DappConnectRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { generateUuid } from '../../utils/uuid'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'

import type { SafeMultisigConfirmationResponse } from '@safe-global/types-kit'

import type { AccountOp } from '../../libs/accountOp/accountOp'
import type { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'

const MOCK_SESSION = new Session({ tabId: 1, url: 'https://test-dApp.com' })
const SAFE_TX_HASH = `0x${'1'.repeat(64)}` as Hex
const SAFE_SIGNATURE =
  '0x05404ea5dfa13ddd921cda3f587af6927cc127ee174b57c9891491bfc1f0d3d005f649f8a1fc9147405f064507bae08816638cfc441c4d0dc4eb6640e16621991b'
const SAFE_OWNER = '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'
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

const updateAccountOp = (request: CallsUserRequest, accountOpData: Partial<AccountOp>) => {
  request.signAccountOp.update({ accountOpData })
}

const getActivityAccountOp = (
  accountAddr: string,
  chainId: bigint,
  nonce: bigint,
  timestamp = Date.now()
): SubmittedAccountOp => ({
  id: `activity-account-op-${nonce.toString()}`,
  accountAddr,
  chainId,
  nonce,
  signingKeyAddr: null,
  signingKeyType: null,
  gasLimit: null,
  gasFeePayment: null,
  signature: null,
  calls: [],
  identifiedBy: {
    type: 'Transaction',
    identifier: `activity-account-op-${nonce.toString()}`
  },
  timestamp
})

const prepareTest = async (seedTestDapp = false, isSelectedAccountSafe = false) => {
  const { mainCtrl, eventEmitterRegistry, getWindowId, eventEmitter } = await makeMainController(
    async (storageCtrl) => {
      await storageCtrl.set('accounts', accounts)
      await storageCtrl.set('selectedAccount', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
      if (seedTestDapp) await storageCtrl.set('dappsV2', [TEST_DAPP])
    }
  )

  if (isSelectedAccountSafe) {
    const selectedAccount = mainCtrl.accounts.accounts.find(
      (account) => account.addr === '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    )!
    selectedAccount.creation = null
    selectedAccount.safeCreation = {
      factoryAddr: selectedAccount.addr as Hex,
      singleton: selectedAccount.addr as Hex,
      saltNonce: '0x00',
      setupData: '0x',
      version: '1.4.1'
    }
  }

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
    accountsCtrl: mainCtrl.accounts,
    portfolioCtrl: mainCtrl.portfolio,
    storageCtrl: mainCtrl.storage,
    safeCtrl: mainCtrl.safe,
    activityCtrl: mainCtrl.activity,
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

  test('emits the updated calls when adding another request to a queued batch', async () => {
    const { controller } = await prepareTest()
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    let emittedCallsCount = 0
    const buildRequest = () =>
      controller.build({
        type: 'calls',
        params: {
          executionType: 'queue',
          userRequestParams: {
            calls: [
              {
                to: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
                value: 1n,
                data: '0x'
              }
            ],
            meta: {
              accountAddr,
              chainId: 1n
            }
          }
        }
      })

    const unsubscribe = controller.onUpdate(() => {
      const request = controller.userRequests[0]
      emittedCallsCount =
        request?.kind === 'calls' ? request.signAccountOp.accountOp.calls.length : 0
    })

    await buildRequest()
    expect(emittedCallsCount).toBe(1)

    await buildRequest()
    unsubscribe()
    expect(controller.userRequests).toHaveLength(1)
    expect(emittedCallsCount).toBe(2)
  })

  test('emits refreshed Safe confirmations for a transaction already in the queue', async () => {
    const { accountsCtrl, controller } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const chainId = 1n
    const accountState = accountsCtrl.accountStates[accountAddr]![chainId.toString()]!
    accountState.threshold = 2
    jest.spyOn(accountsCtrl, 'forceFetchPendingState').mockResolvedValue(accountState)
    const txnId = SAFE_TX_HASH
    const firstSigner = new Wallet(`0x${'1'.repeat(64)}`)
    const secondSigner = new Wallet(`0x${'2'.repeat(64)}`)
    const firstSignature = firstSigner.signingKey.sign(txnId).serialized
    const secondSignature = secondSigner.signingKey.sign(txnId).serialized
    const buildSafeRequest = (confirmations: SafeMultisigConfirmationResponse[]) =>
      controller.build({
        type: 'calls',
        params: {
          executionType: 'queue',
          userRequestParams: {
            calls: [
              {
                to: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
                value: 1n,
                data: '0x'
              }
            ],
            meta: {
              accountAddr,
              chainId,
              safeTxnProps: {
                txnId,
                signature: `0x${confirmations.map(({ signature }) => signature.slice(2)).join('')}`,
                nonce: 0n
              },
              safeTx: {
                safe: accountAddr,
                to: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
                value: '1',
                data: '0x',
                operation: 0,
                gasToken: ZeroAddress,
                safeTxGas: '0',
                baseGas: '0',
                gasPrice: '0',
                nonce: '0',
                executionDate: null,
                submissionDate: '2026-08-18T00:00:00Z',
                modified: '2026-08-18T00:00:00Z',
                blockNumber: null,
                transactionHash: null,
                safeTxHash: txnId,
                executor: null,
                proposer: null,
                proposedByDelegate: null,
                isExecuted: false,
                isSuccessful: null,
                ethGasPrice: null,
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
                gasUsed: null,
                fee: null,
                origin: '',
                confirmationsRequired: 2,
                confirmations,
                trusted: true,
                signatures: null
              }
            }
          }
        }
      })
    const firstConfirmation: SafeMultisigConfirmationResponse = {
      owner: firstSigner.address,
      signature: firstSignature,
      signatureType: 'EOA',
      submissionDate: '2026-08-18T00:00:00Z'
    }
    const secondConfirmation: SafeMultisigConfirmationResponse = {
      owner: secondSigner.address,
      signature: secondSignature,
      signatureType: 'EOA',
      submissionDate: '2026-08-18T00:00:00Z'
    }

    await buildSafeRequest([firstConfirmation])

    const emittedConfirmationCounts: number[] = []
    const unsubscribe = controller.onUpdate(() => {
      const request = controller.userRequests[0]
      if (request?.kind === 'calls') {
        emittedConfirmationCounts.push(
          request.signAccountOp.accountOp.safeTx?.confirmations?.length || 0
        )
      }
    })

    await buildSafeRequest([firstConfirmation])
    expect(emittedConfirmationCounts).toEqual([])

    await buildSafeRequest([firstConfirmation, secondConfirmation])
    expect(emittedConfirmationCounts).toEqual([2])

    await buildSafeRequest([firstConfirmation, secondConfirmation])
    unsubscribe()
    expect(emittedConfirmationCounts).toEqual([2])

    controller.userRequests.forEach((request) => {
      if (request.kind === 'calls') request.signAccountOp.destroy()
    })
  })

  test('emits completed humanization for a Safe transaction already in the queue', async () => {
    const { controller } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

    await controller.build({
      type: 'calls',
      params: {
        executionType: 'queue',
        userRequestParams: {
          calls: [{ to: ZeroAddress, value: 0n, data: '0x' }],
          meta: { accountAddr, chainId: 1n }
        }
      }
    })

    const request = controller.userRequests[0]
    expect(request?.kind).toBe('calls')
    if (request?.kind !== 'calls') throw new Error('Expected calls request')

    const waitForHumanization = async () => {
      if (!request.signAccountOp.isHumanizing) return

      await new Promise<void>((resolve) => {
        const unsubscribeFromHumanization = request.signAccountOp.onUpdate(() => {
          if (request.signAccountOp.isHumanizing) return

          unsubscribeFromHumanization()
          resolve()
        })
      })
    }

    await waitForHumanization()
    await request.signAccountOp.forceEmitUpdate()

    const emittedHumanizationLabels: (string | undefined)[] = []
    const unsubscribe = controller.onUpdate(() => {
      emittedHumanizationLabels.push(
        request.signAccountOp.humanization[0]?.fullVisualization?.[0]?.content
      )
    })

    request.signAccountOp.humanize()
    await waitForHumanization()
    await request.signAccountOp.forceEmitUpdate()
    await request.signAccountOp.forceEmitUpdate()
    unsubscribe()

    // an empty, 0-value call to the zero address is the exact shape of a Safe{WALLET}
    // cancellation, so it's humanized as one regardless of how the request was built
    expect(emittedHumanizationLabels).toEqual(['Cancel'])
    request.signAccountOp.destroy()
  })

  test('assigns the first free nonce to each new Safe request', async () => {
    const { controller, accountsCtrl, activityCtrl } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const chainId = 1n
    accountsCtrl.accountStates[accountAddr]![chainId.toString()]!.nonce = 119n
    await activityCtrl.addAccountOp(getActivityAccountOp(accountAddr, chainId, 117n))
    const buildRequest = () =>
      controller.build({
        type: 'calls',
        params: {
          executionType: 'queue',
          userRequestParams: {
            calls: [
              {
                to: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
                value: 1n,
                data: '0x'
              }
            ],
            meta: {
              accountAddr,
              chainId
            }
          }
        }
      })

    await buildRequest()
    const nonce119Request = controller.userRequests[0] as CallsUserRequest
    nonce119Request.signAccountOp.update({
      accountOpData: {
        signed: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
        txnId: `0x${'1'.repeat(64)}`
      }
    })

    await buildRequest()
    const secondRequest = controller.userRequests.find(
      (request) => request !== nonce119Request
    ) as CallsUserRequest
    expect(secondRequest.signAccountOp.accountOp.nonce).toBe(120n)
    secondRequest.signAccountOp.setSafeNonce(121n)
    secondRequest.signAccountOp.update({
      accountOpData: {
        signed: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
        txnId: `0x${'2'.repeat(64)}`
      }
    })

    await buildRequest()
    const gapRequest = controller.userRequests.find(
      (request) => request !== nonce119Request && request !== secondRequest
    ) as CallsUserRequest

    expect(controller.userRequests).toHaveLength(3)
    expect(controller.userRequests).toContain(nonce119Request)
    expect(controller.userRequests).toContain(secondRequest)
    expect(nonce119Request.signAccountOp.accountOp.nonce).toBe(119n)
    expect(secondRequest.signAccountOp.accountOp.nonce).toBe(121n)
    expect(gapRequest.signAccountOp.accountOp.nonce).toBe(120n)
    expect(new Set(controller.userRequests.map((request) => request.id)).size).toBe(3)

    controller.userRequests.forEach((request) => {
      if (request.kind === 'calls') request.signAccountOp.destroy()
    })
  })
  test('uses the latest activity nonce when the account state is stale', async () => {
    const { controller, accountsCtrl, activityCtrl } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const chainId = 1n
    accountsCtrl.accountStates[accountAddr]![chainId.toString()]!.nonce = 119n
    await activityCtrl.addAccountOp(getActivityAccountOp(accountAddr, chainId, 118n, 1))
    await activityCtrl.addAccountOp(getActivityAccountOp(accountAddr, chainId, 120n, 2))
    await activityCtrl.addAccountOp(getActivityAccountOp(accountAddr, 10n, 999n, 3))

    await controller.build({
      type: 'calls',
      params: {
        executionType: 'queue',
        userRequestParams: {
          calls: [{ to: ZeroAddress, value: 1n, data: '0x' }],
          meta: { accountAddr, chainId }
        }
      }
    })

    const request = controller.userRequests[0]
    expect(request?.kind).toBe('calls')
    if (request?.kind !== 'calls') throw new Error('Expected calls request')
    expect(request.signAccountOp.accountOp.nonce).toBe(121n)
    request.signAccountOp.destroy()
  })
  test('keeps the nonce when adding calls to an existing Safe request', async () => {
    const { controller, accountsCtrl } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const chainId = 1n
    accountsCtrl.accountStates[accountAddr]![chainId.toString()]!.nonce = 119n
    const buildRequest = () =>
      controller.build({
        type: 'calls',
        params: {
          executionType: 'queue',
          userRequestParams: {
            calls: [{ to: ZeroAddress, value: 1n, data: '0x' }],
            meta: { accountAddr, chainId }
          }
        }
      })

    await buildRequest()
    await buildRequest()

    expect(controller.userRequests).toHaveLength(1)
    const request = controller.userRequests[0]
    expect(request?.kind).toBe('calls')
    if (request?.kind !== 'calls') throw new Error('Expected calls request')
    expect(request.signAccountOp.accountOp.nonce).toBe(119n)
    expect(request.signAccountOp.accountOp.calls).toHaveLength(2)
    request.signAccountOp.destroy()
  })
  test('builds an onchain Safe rejection as the current request at the same nonce', async () => {
    const { accountsCtrl, controller, getCallsRequest, portfolioCtrl } = await prepareTest(
      false,
      true
    )
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    accountsCtrl.accountStates[accountAddr]![1]!.threshold = 2
    const request = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    controller.userRequests = [request]
    await controller.setCurrentUserRequestById(request.id)
    updateAccountOp(request, {
      nonce: 99n,
      safeTx: { nonce: '0x07' } as any,
      signed: [SAFE_OWNER],
      txnId: SAFE_TX_HASH
    })
    updateAccountOp(request, { signature: SAFE_SIGNATURE })
    const pauseSpy = jest.spyOn(request.signAccountOp, 'pause')
    const overrideSimulationSpy = jest
      .spyOn(portfolioCtrl, 'overrideSimulationResults')
      .mockResolvedValue()
    const setSafeNonceSpy = jest.spyOn(SignAccountOpController.prototype, 'setSafeNonce')

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })

    expect(controller.userRequests).toHaveLength(2)
    expect(controller.currentUserRequest).not.toBe(request)
    expect(controller.currentUserRequest?.kind).toBe('calls')
    if (controller.currentUserRequest?.kind !== 'calls') throw new Error('Expected calls request')

    expect(controller.currentUserRequest.signAccountOp.accountOp).toMatchObject({
      accountAddr,
      chainId: 1n,
      nonce: 7n,
      signature: null,
      calls: [{ to: ZeroAddress, value: 0n, data: '0x' }]
    })
    expect(request.signAccountOp.accountOp.signature).toBe(SAFE_SIGNATURE)
    expect(request.signAccountOp.accountOp.nonce).toBe(99n)
    expect(pauseSpy).toHaveBeenCalled()
    expect(overrideSimulationSpy).toHaveBeenCalledWith(request.signAccountOp.accountOp)
    expect(setSafeNonceSpy).toHaveBeenCalledWith(7n)

    controller.userRequests.forEach((userRequest) => {
      if (userRequest.kind === 'calls') userRequest.signAccountOp.destroy()
    })
  })
  test('focuses an existing onchain Safe rejection at the same nonce', async () => {
    const { accountsCtrl, controller, getCallsRequest, portfolioCtrl } = await prepareTest(
      false,
      true
    )
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    accountsCtrl.accountStates[accountAddr]![1]!.threshold = 2
    jest.spyOn(portfolioCtrl, 'overrideSimulationResults').mockResolvedValue()
    const request = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    updateAccountOp(request, { nonce: 7n, signed: [SAFE_OWNER] })
    controller.userRequests = [request]
    await controller.setCurrentUserRequestById(request.id)

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })
    const rejectionRequest = controller.userRequests.find(
      (userRequest) => userRequest.id !== request.id
    )
    expect(rejectionRequest?.kind).toBe('calls')
    if (rejectionRequest?.kind !== 'calls') throw new Error('Expected calls request')
    expect(rejectionRequest.signAccountOp.accountOp.calls).toHaveLength(1)

    await controller.setCurrentUserRequestById(request.id)
    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })

    expect(controller.userRequests).toHaveLength(2)
    expect(controller.currentUserRequest).toBe(rejectionRequest)
    expect(rejectionRequest.signAccountOp.accountOp.nonce).toBe(7n)
    expect(rejectionRequest.signAccountOp.accountOp.calls).toHaveLength(1)
    expect(
      rejectionRequest.signAccountOp.accountOp.calls.every(
        (call) => call.to === ZeroAddress && call.value === 0n && call.data === '0x'
      )
    ).toBe(true)
    expect(request.signAccountOp.accountOp.calls).toHaveLength(1)
    expect(request.signAccountOp.accountOp.signed).toEqual([SAFE_OWNER])

    controller.userRequests.forEach((userRequest) => {
      if (userRequest.kind === 'calls') userRequest.signAccountOp.destroy()
    })
  })
  test('focuses an imported Safe cancellation at the same nonce', async () => {
    const { controller, getCallsRequest, portfolioCtrl } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    jest.spyOn(portfolioCtrl, 'overrideSimulationResults').mockResolvedValue()
    const regularRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const cancellationRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    regularRequest.id = 'regular-safe-api-request'
    cancellationRequest.id = 'safe-api-cancellation-request'
    updateAccountOp(regularRequest, { nonce: 7n, signed: [SAFE_OWNER] })
    // this is what actually makes it a cancellation - a single empty call to the account
    // itself - rather than any meta flag
    updateAccountOp(cancellationRequest, {
      nonce: 7n,
      calls: [
        {
          ...cancellationRequest.signAccountOp.accountOp.calls[0]!,
          to: accountAddr,
          value: 0n,
          data: '0x'
        }
      ]
    })
    controller.userRequests = [regularRequest, cancellationRequest]
    await controller.setCurrentUserRequestById(regularRequest.id)

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: regularRequest.id }
    })

    expect(controller.userRequests).toHaveLength(2)
    expect(controller.currentUserRequest).toBe(cancellationRequest)

    controller.userRequests.forEach((userRequest) => {
      if (userRequest.kind === 'calls') userRequest.signAccountOp.destroy()
    })
  })
  test('does not reuse an onchain Safe rejection at a different nonce', async () => {
    const { accountsCtrl, controller, getCallsRequest, portfolioCtrl } = await prepareTest(
      false,
      true
    )
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    accountsCtrl.accountStates[accountAddr]![1]!.threshold = 2
    jest.spyOn(portfolioCtrl, 'overrideSimulationResults').mockResolvedValue()
    const request = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    updateAccountOp(request, { nonce: 7n, signed: [SAFE_OWNER] })
    controller.userRequests = [request]
    await controller.setCurrentUserRequestById(request.id)

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })
    const firstRejectionRequest = controller.currentUserRequest
    expect(firstRejectionRequest?.kind).toBe('calls')
    if (firstRejectionRequest?.kind !== 'calls') throw new Error('Expected calls request')
    firstRejectionRequest.signAccountOp.setSafeNonce(8n)

    await controller.setCurrentUserRequestById(request.id)
    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })

    expect(controller.userRequests).toHaveLength(3)
    expect(controller.currentUserRequest).not.toBe(firstRejectionRequest)
    expect(controller.currentUserRequest?.kind).toBe('calls')
    if (controller.currentUserRequest?.kind !== 'calls') throw new Error('Expected calls request')
    expect(controller.currentUserRequest.signAccountOp.accountOp.nonce).toBe(7n)
    expect(firstRejectionRequest.signAccountOp.accountOp.nonce).toBe(8n)

    controller.userRequests.forEach((userRequest) => {
      if (userRequest.kind === 'calls') userRequest.signAccountOp.destroy()
    })
  })
  test('builds an onchain Safe rejection when one does not already exist', async () => {
    const { controller, getCallsRequest, portfolioCtrl } = await prepareTest(false, true)
    const request = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })
    controller.userRequests = [request]
    jest.spyOn(portfolioCtrl, 'overrideSimulationResults').mockResolvedValue()

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })

    expect(controller.userRequests).toHaveLength(2)
    expect(controller.currentUserRequest?.kind).toBe('calls')
    if (controller.currentUserRequest?.kind !== 'calls') throw new Error('Expected calls request')
    expect(controller.currentUserRequest.signAccountOp.accountOp).toMatchObject({
      nonce: 0n,
      calls: [{ to: ZeroAddress, value: 0n, data: '0x' }]
    })

    controller.userRequests.forEach((userRequest) => {
      if (userRequest.kind === 'calls') userRequest.signAccountOp.destroy()
    })
  })
  test('does not build an onchain Safe rejection for a non-Safe account', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const request = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })
    controller.userRequests = [request]

    await controller.build({
      type: 'onchainSafeRejection',
      params: { requestId: request.id }
    })

    expect(controller.userRequests).toEqual([request])
    request.signAccountOp.destroy()
  })
  test('BUG: does not build expired Safe requests, including nonce zero', async () => {
    const { controller, accountsCtrl } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const chainId = 1n
    const accountState = accountsCtrl.accountStates[accountAddr]![chainId.toString()]!
    jest.spyOn(accountsCtrl, 'forceFetchPendingState').mockResolvedValue({
      ...accountState,
      nonce: 1n
    })
    const buildSafeRequest = (nonce: bigint, txnId: Hex) =>
      controller.build({
        type: 'calls',
        params: {
          executionType: 'queue',
          userRequestParams: {
            calls: [
              {
                to: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
                value: 1n,
                data: '0x'
              }
            ],
            meta: {
              accountAddr,
              chainId,
              safeTxnProps: { txnId, signature: '0x', nonce }
            }
          }
        }
      })

    await buildSafeRequest(0n, '0x00')
    await buildSafeRequest(1n, '0x01')
    await buildSafeRequest(5n, '0x05')

    const safeRequests = controller.userRequests.filter(
      (request): request is CallsUserRequest => request.kind === 'calls'
    )
    expect(safeRequests.map((request) => request.signAccountOp.accountOp.nonce)).toEqual([1n, 5n])

    safeRequests.forEach((request) => request.signAccountOp.destroy())
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
  test('finds same-nonce Safe alternatives by their immutable Safe nonce and scope', async () => {
    const { controller, getCallsRequest } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const broadcastRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const sameNonceRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const nextNonceRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const otherNetworkRequest = await getCallsRequest({ addr: accountAddr, chainId: 10n })

    broadcastRequest.id = 'broadcast-request'
    sameNonceRequest.id = 'same-nonce-request'
    nextNonceRequest.id = 'next-nonce-request'
    otherNetworkRequest.id = 'other-network-request'

    updateAccountOp(broadcastRequest, { nonce: 8n, safeTx: { nonce: 7 } as any })
    updateAccountOp(sameNonceRequest, { nonce: 8n, safeTx: { nonce: '7' } as any })
    updateAccountOp(nextNonceRequest, { nonce: 8n, safeTx: { nonce: 8 } as any })
    updateAccountOp(otherNetworkRequest, { nonce: 8n, safeTx: { nonce: 7 } as any })
    controller.userRequests = [
      broadcastRequest,
      sameNonceRequest,
      nextNonceRequest,
      otherNetworkRequest
    ]

    expect(controller.getSameNonceSafeRequests(broadcastRequest.id)).toEqual([sameNonceRequest])

    controller.userRequests.forEach((request) => {
      if (request.kind === 'calls') request.signAccountOp.destroy()
    })
  })
  test('silently retires all same-nonce Safe alternatives with their immutable nonce', async () => {
    const { controller, getCallsRequest } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const broadcastRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const sameNonceRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })
    const nextNonceRequest = await getCallsRequest({ addr: accountAddr, chainId: 1n })

    broadcastRequest.id = 'broadcast-request'
    sameNonceRequest.id = 'same-nonce-request'
    nextNonceRequest.id = 'next-nonce-request'
    updateAccountOp(broadcastRequest, {
      txnId: '0xbroadcast',
      nonce: 8n,
      safeTx: { nonce: 7 } as any
    })
    updateAccountOp(sameNonceRequest, {
      txnId: '0xalternative',
      nonce: 8n,
      safeTx: { nonce: 7 } as any
    })
    updateAccountOp(nextNonceRequest, {
      txnId: '0xnext',
      nonce: 8n,
      safeTx: { nonce: 8 } as any
    })
    controller.userRequests = [broadcastRequest, sameNonceRequest, nextNonceRequest]
    await controller.setCurrentUserRequestById(broadcastRequest.id)
    const broadcastDestroySpy = jest.spyOn(broadcastRequest.signAccountOp, 'destroy')
    const sameNonceDestroySpy = jest.spyOn(sameNonceRequest.signAccountOp, 'destroy')
    const nextNonceDestroySpy = jest.spyOn(nextNonceRequest.signAccountOp, 'destroy')

    await controller.removeUserRequests([broadcastRequest.id, sameNonceRequest.id], {
      shouldOpenNextRequest: false
    })

    expect(controller.userRequests).toEqual([nextNonceRequest])
    expect(controller.currentUserRequest).toBe(null)
    expect(broadcastDestroySpy).toHaveBeenCalledTimes(1)
    expect(sameNonceDestroySpy).toHaveBeenCalledTimes(1)
    expect(nextNonceDestroySpy).not.toHaveBeenCalled()

    nextNonceRequest.signAccountOp.destroy()
  })
  test('silently retires a signed Safe transaction with nonce zero', async () => {
    const { controller, getCallsRequest } = await prepareTest(false, true)
    const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const request = await getCallsRequest({ addr: accountAddr, chainId: 1n })

    updateAccountOp(request, { txnId: '0xzero', nonce: 0n, safeTx: { nonce: 0 } as any })
    controller.userRequests = [request]
    const destroySpy = jest.spyOn(request.signAccountOp, 'destroy')

    await controller.removeUserRequests([request.id], {
      shouldOpenNextRequest: false
    })

    expect(destroySpy).toHaveBeenCalledTimes(1)
  })

  test('rejecting an account switch removes the pending request and its simulation', async () => {
    const { controller, getCallsRequest, portfolioCtrl, selectedAccountCtrl } = await prepareTest()
    const req = await getCallsRequest({
      addr: accounts[0]!.addr,
      chainId: 1n
    })
    const rejectMock = jest.fn()
    req.dappPromises = [
      {
        id: 'account-switch-request',
        resolve: jest.fn(),
        reject: rejectMock,
        session: MOCK_SESSION,
        meta: {}
      }
    ]
    const destroySpy = jest.spyOn(req.signAccountOp, 'destroy')
    const overrideSimulationResultsSpy = jest.spyOn(portfolioCtrl, 'overrideSimulationResults')

    await controller.addUserRequests([req], { allowAccountSwitch: true })

    const switchAccountRequest = controller.userRequests[0]!
    expect(switchAccountRequest.kind).toBe('switchAccount')
    expect(controller.userRequestsWaitingAccountSwitch).toStrictEqual([req])

    await controller.rejectUserRequests('User rejected', [switchAccountRequest.id])
    await selectedAccountCtrl.setAccount(accounts[0]!)

    expect(rejectMock).toHaveBeenCalledTimes(1)
    expect(overrideSimulationResultsSpy).toHaveBeenCalledWith(req.signAccountOp.accountOp)
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(controller.userRequestsWaitingAccountSwitch).toHaveLength(0)
    expect(controller.userRequests).toHaveLength(0)
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
    controller.banners.forEach((banner) => {
      expect(banner.meta?.accountAddr).toEqual('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    })
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
  test('should not open a request window while the panel is open', async () => {
    const { controller, uiCtrl } = await prepareTest()
    uiCtrl.panel = { isOpen: () => true }

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])

    expect(controller.currentUserRequest).toBe(DAPP_CONNECT_REQUEST)
    expect(controller.requestWindow.windowProps).toBe(null)
  })
  test('should reject the active request on close when there is no request window', async () => {
    const { controller, uiCtrl } = await prepareTest()
    uiCtrl.panel = { isOpen: () => true }

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.closeRequestWindow()

    expect(controller.currentUserRequest).toBe(null)
    expect(controller.userRequests.length).toBe(0)
  })
  test('should keep transaction requests queued on close when there is no request window', async () => {
    const { controller, uiCtrl, getCallsRequest } = await prepareTest()
    uiCtrl.panel = { isOpen: () => true }
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])
    await controller.closeRequestWindow()

    expect(controller.currentUserRequest).toBe(null)
    expect(controller.userRequests.length).toBe(1)
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
      typedData: object,
      signerAddress: string = FROM
    ) =>
      controller.build({
        type: 'dappRequest',
        params: {
          request: {
            method: 'eth_signTypedData_v4',
            params: [signerAddress, JSON.stringify(typedData)],
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

    const SELECTED_ACCOUNT = FROM
    const OTHER_ACCOUNT = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'

    const AMBIRE_OPERATION_TYPED_DATA = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
          { name: 'salt', type: 'bytes32' }
        ],
        AmbireOperation: [
          { name: 'account', type: 'address' },
          { name: 'hash', type: 'bytes32' }
        ]
      },
      primaryType: 'AmbireOperation',
      domain: {
        name: 'Ambire',
        version: '1',
        chainId: 1,
        verifyingContract: SELECTED_ACCOUNT,
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
      },
      message: {
        account: SELECTED_ACCOUNT,
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      }
    }

    test('rejects AmbireOperation typed data for the selected account', async () => {
      const { controller } = await prepareTest(true)
      await expect(
        buildSignTypedDataRequest(controller, AMBIRE_OPERATION_TYPED_DATA, SELECTED_ACCOUNT)
      ).rejects.toThrow('Signing an AmbireOperation is not allowed')
      expect(controller.userRequests.length).toBe(0)
    })

    test('rejects AmbireOperation typed data for a non-selected account', async () => {
      const { controller } = await prepareTest(true)
      const otherAccountTypedData = {
        ...AMBIRE_OPERATION_TYPED_DATA,
        domain: {
          ...AMBIRE_OPERATION_TYPED_DATA.domain,
          verifyingContract: OTHER_ACCOUNT
        },
        message: {
          account: OTHER_ACCOUNT,
          hash: '0x1111111111111111111111111111111111111111111111111111111111111111'
        }
      }

      await expect(
        buildSignTypedDataRequest(controller, otherAccountTypedData, OTHER_ACCOUNT)
      ).rejects.toThrow('Signing an AmbireOperation is not allowed')
      expect(controller.userRequests.length).toBe(0)
      expect(controller.userRequestsWaitingAccountSwitch.length).toBe(0)
    })
  })
})
