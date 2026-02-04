/* eslint-disable no-await-in-loop */
import fetch from 'node-fetch'

/* eslint-disable prettier/prettier */
import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { waitForFnToBeCalledAndExecuted } from '../../../test/recurringTimeout'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import * as accountStateLib from '../../libs/accountState/accountState'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { SwapProviderParallelExecutor } from '../../services/swapIntegrators/swapProviderParallelExecutor'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'
import { MainController } from '../main/main'

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

const submittedAccountOp = {
  accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
  signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
  gasLimit: null,
  gasFeePayment: {
    isGasTank: false,
    paidBy: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    inToken: '0x0000000000000000000000000000000000000000',
    amount: 1n,
    simulatedGasLimit: 1n,
    gasPrice: 1n
  },
  chainId: 1n,
  nonce: 225n,
  signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
  calls: [
    {
      to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
    }
  ],
  txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
  status: 'broadcasted-but-not-confirmed',
  identifiedBy: {
    type: 'Transaction',
    identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
  }
} as SubmittedAccountOp

const prepareTest = async () => {
  const storage = produceMemoryStore()
  await storage.set('accounts', accounts)
  await storage.set('selectedAccount', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')

  const uiManager = mockUiManager().uiManager
  jest.spyOn(accountStateLib, 'getAccountState').mockImplementation(async () => {
    return []
  })
  jest.spyOn(SwapProviderParallelExecutor.prototype, 'getSupportedChains').mockResolvedValue([])
  const mainCtrl = new MainController({
    appVersion: '5.31.0',
    platform: 'default',
    storageAPI: storage,
    fetch,
    relayerUrl,
    featureFlags: {},
    liFiApiKey: '',
    bungeeApiKey: '',
    keystoreSigners: { internal: KeystoreSigner },
    externalSignerControllers: {},
    uiManager,
    velcroUrl
  })
  mainCtrl.portfolio.updateSelectedAccount = jest.fn().mockResolvedValue(undefined)
  mainCtrl.updateSelectedAccountPortfolio = jest.fn().mockImplementation(async () => {
    await wait(500)
  })
  mainCtrl.domains.reverseLookup = jest.fn().mockResolvedValue(undefined)
  mainCtrl.accounts.updateAccountState = jest.fn().mockImplementation(async () => {
    await wait(500)
  })
  mainCtrl.updateAccountsOpsStatuses = jest.fn().mockResolvedValue({ newestOpTimestamp: 0 })

  return { mainCtrl }
}

const waitForMainCtrlReady = async (mainCtrl: MainController) => {
  await jest.advanceTimersByTimeAsync(0)

  while (!mainCtrl.isReady) {
    await jest.advanceTimersByTimeAsync(20)
  }
}

const waitForContinuousUpdatesCtrlReady = async (mainCtrl: MainController) => {
  await jest.advanceTimersByTimeAsync(0)

  while (mainCtrl.continuousUpdates.initialLoadPromise) {
    await jest.advanceTimersByTimeAsync(20)
  }
}

const waitForAccountStatesInitialLoad = async (mainCtrl: MainController) => {
  await jest.advanceTimersByTimeAsync(0)

  while (mainCtrl.accounts.accountStateInitialLoadPromise) {
    await jest.advanceTimersByTimeAsync(20)
  }
}

describe('ContinuousUpdatesController intervals', () => {
  let restoreFunc: any
  beforeEach(() => {
    jest.useFakeTimers()
    const { restore } = suppressConsole()

    restoreFunc = restore
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    restoreFunc()
  })

  test('should run updatePortfolioInterval', async () => {
    const { mainCtrl } = await prepareTest()
    await waitForContinuousUpdatesCtrlReady(mainCtrl)
    await waitForAccountStatesInitialLoad(mainCtrl)

    jest.spyOn(mainCtrl.continuousUpdates.updatePortfolioInterval, 'restart')
    mainCtrl.ui.addView({ id: '1', type: 'popup', currentRoute: 'dashboard', isReady: true })
    await jest.advanceTimersByTimeAsync(0)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.restart).toHaveBeenCalled()
    const updateSelectedAccountPortfolioSpy = jest.spyOn(mainCtrl, 'updateSelectedAccountPortfolio')
    const initialFnExecutionsCount =
      mainCtrl.continuousUpdates.updatePortfolioInterval.fnExecutionsCount
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.updatePortfolioInterval)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 1
    )
    const updateSelectedAccountCalledTimes = updateSelectedAccountPortfolioSpy.mock.calls.length
    await mainCtrl.activity.addAccountOp(submittedAccountOp)
    await jest.advanceTimersByTimeAsync(0)
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.updatePortfolioInterval)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 2
    )
    expect(updateSelectedAccountPortfolioSpy).toHaveBeenCalledTimes(
      updateSelectedAccountCalledTimes
    ) // tests the branching in the updatePortfolio func
    mainCtrl.ui.removeView('1')
    await jest.advanceTimersByTimeAsync(0)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.restart).toHaveBeenCalledTimes(2)
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.updatePortfolioInterval)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 3
    )
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.updatePortfolioInterval)
    expect(mainCtrl.continuousUpdates.updatePortfolioInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 4
    )
  })

  test('should run accountsOpsStatusesInterval', async () => {
    const { mainCtrl } = await prepareTest()
    await waitForMainCtrlReady(mainCtrl)

    jest.spyOn(mainCtrl.continuousUpdates.accountsOpsStatusesInterval, 'start')
    jest.spyOn(mainCtrl.continuousUpdates.accountsOpsStatusesInterval, 'stop')

    await mainCtrl.activity.addAccountOp(submittedAccountOp)
    await jest.advanceTimersByTimeAsync(0)

    const initialFnExecutionsCount =
      mainCtrl.continuousUpdates.accountsOpsStatusesInterval.fnExecutionsCount

    expect(mainCtrl.continuousUpdates.accountsOpsStatusesInterval.start).toHaveBeenCalled()
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.accountsOpsStatusesInterval)
    expect(mainCtrl.continuousUpdates.accountsOpsStatusesInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 1
    )
    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.accountsOpsStatusesInterval)
    expect(mainCtrl.continuousUpdates.accountsOpsStatusesInterval.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 2
    )
    jest
      .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
      .mockReturnValue(Object.fromEntries(mainCtrl.accounts.accounts.map((a) => [a.addr, []])))
    // @ts-ignore
    mainCtrl.activity.emitUpdate()
    await jest.advanceTimersByTimeAsync(0)
    expect(mainCtrl.continuousUpdates.accountsOpsStatusesInterval.stop).toHaveBeenCalled()
  })

  test('should run updateAccountStateLatest and updateAccountStatePending', async () => {
    const { mainCtrl } = await prepareTest()

    jest.spyOn(mainCtrl.continuousUpdates.accountStateLatestInterval, 'restart')

    await waitForContinuousUpdatesCtrlReady(mainCtrl)

    const initialAccountStateLatestFnExecutionsCount =
      mainCtrl.continuousUpdates.accountStateLatestInterval.fnExecutionsCount

    expect(mainCtrl.continuousUpdates.accountStateLatestInterval.running).toBe(true)

    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.accountStateLatestInterval)
    expect(mainCtrl.continuousUpdates.accountStateLatestInterval.fnExecutionsCount).toBe(
      initialAccountStateLatestFnExecutionsCount + 1
    )
    const mockAccountOp = new EventEmitter() as any
    mockAccountOp.signAndBroadcastPromise = new Promise(() => {})
    mockAccountOp.broadcastStatus = 'SUCCESS'
    ;(mainCtrl.requests.currentUserRequest as any) = {
      kind: 'calls',
      signAccountOp: mockAccountOp
    }
    ;(mainCtrl.requests as any).emitUpdate()
    ;(mockAccountOp as any).emitUpdate()
    await jest.advanceTimersByTimeAsync(0)
    expect(mainCtrl.continuousUpdates.accountStateLatestInterval.restart).toHaveBeenCalledTimes(1)
    expect(mainCtrl.continuousUpdates.accountStateLatestInterval.running).toBe(true)
  })

  test('should run fastAccountStateReFetchTimeout', async () => {
    const { mainCtrl } = await prepareTest()
    await waitForContinuousUpdatesCtrlReady(mainCtrl)
    await waitForAccountStatesInitialLoad(mainCtrl)

    jest.spyOn(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout, 'start')
    mainCtrl.continuousUpdates.accountStateLatestInterval.start = jest
      .fn()
      .mockResolvedValue(undefined)
    mainCtrl.continuousUpdates.accountStateLatestInterval.restart = jest
      .fn()
      .mockResolvedValue(undefined)

    // ensure there is at least one provider that is not working
    mainCtrl.providers.providers[1]!.isWorking = false
    mainCtrl.providers.providers[137]!.isWorking = true
    mainCtrl.ui.addView({ id: '1', type: 'popup', currentRoute: 'dashboard', isReady: true })
    const initialFnExecutionsCount =
      mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout.fnExecutionsCount
    expect(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout.start).toHaveBeenCalledTimes(1)
    expect(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout.fnExecutionsCount).toBe(
      initialFnExecutionsCount
    )
    // @ts-ignore
    mainCtrl.providers.emitUpdate()
    // @ts-ignore
    mainCtrl.providers.emitUpdate()
    // @ts-ignore
    mainCtrl.providers.emitUpdate()

    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout)
    // @ts-ignore
    mainCtrl.providers.emitUpdate()
    // @ts-ignore
    mainCtrl.providers.emitUpdate()

    expect(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 1
    )
    // @ts-ignore
    mainCtrl.providers.emitUpdate()
    // @ts-ignore
    mainCtrl.providers.emitUpdate()
    // @ts-ignore
    mainCtrl.providers.emitUpdate()

    await waitForFnToBeCalledAndExecuted(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout)
    expect(mainCtrl.continuousUpdates.fastAccountStateReFetchTimeout.fnExecutionsCount).toBe(
      initialFnExecutionsCount + 2
    )
  })
})
