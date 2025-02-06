import EventEmitter from 'events'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { Calls, DappUserRequest, SignUserRequest } from '../../interfaces/userRequest'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { AccountOpAction, ActionsController, BenzinAction, DappRequestAction } from './actions'

const DAPP_CONNECT_REQUEST: DappUserRequest = {
  id: 1,
  action: { kind: 'dappConnect', params: {} },
  meta: { isSignAction: false },
  session: { name: '', icon: '', origin: '' },
  dappPromise: {
    resolve: () => {},
    reject: () => {},
    session: { name: 'Test dApp', origin: 'https://test-dApp.com', icon: '' }
  }
}
const SIGN_ACCOUNT_OP_REQUEST: SignUserRequest = {
  id: 2,
  action: {
    kind: 'calls',
    calls: [
      {
        data: '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        id: '1738852044828-0',
        to: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        value: 0n
      },
      {
        data: '0x095fffffffffffffffff',
        id: '173828-0',
        to: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        value: 0n
      }
    ]
  } as Calls,
  meta: {
    accountAddr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
    isSignAction: true,
    isWalletSendCalls: false,
    networkId: 'optimism',
    paymasterService: undefined
  },
  session: { name: '', icon: '', origin: '' },
  dappPromise: {
    resolve: () => {},
    reject: () => {},
    session: { name: 'Test dApp', origin: 'https://test-dApp.com', icon: '' }
  }
}

const DAPP_CONNECT_ACTION: DappRequestAction = {
  id: DAPP_CONNECT_REQUEST.id,
  type: 'dappRequest',
  userRequest: DAPP_CONNECT_REQUEST
}
const SIGN_ACCOUNT_OP_ACTION: AccountOpAction = {
  id: SIGN_ACCOUNT_OP_REQUEST.id,
  type: 'accountOp',
  accountOp: {
    accountAddr: SIGN_ACCOUNT_OP_REQUEST.meta.accountAddr,
    accountOpToExecuteBefore: null,
    calls: [
      {
        ...(SIGN_ACCOUNT_OP_REQUEST.action as Calls).calls[0],
        fromUserRequestId: SIGN_ACCOUNT_OP_REQUEST.id
      },
      {
        ...(SIGN_ACCOUNT_OP_REQUEST.action as Calls).calls[1],
        fromUserRequestId: SIGN_ACCOUNT_OP_REQUEST.id
      }
    ],
    gasFeePayment: {
      amount: 7936n,
      feeTokenNetworkId: SIGN_ACCOUNT_OP_REQUEST.meta.networkId,
      gasPrice: 1101515n,
      inToken: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      isERC4337: true,
      isGasTank: false,
      maxPriorityFeePerGas: 1100000n,
      paidBy: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
      simulatedGasLimit: 2580640n
    },
    gasLimit: null,
    meta: {},
    networkId: SIGN_ACCOUNT_OP_REQUEST.meta.networkId,
    nonce: 2n,
    signature: '',
    signingKeyAddr: '',
    signingKeyType: 'internal'
  }
}

describe('Actions Controller', () => {
  const event = new EventEmitter()
  let windowId = 0
  const windowManager = {
    event,
    focus: () => Promise.resolve(),
    open: () => {
      windowId++
      return Promise.resolve({
        id: windowId,
        top: 0,
        left: 0,
        width: 100,
        height: 100,
        focused: true
      })
    },
    remove: () => {
      event.emit('windowRemoved', windowId)
      return Promise.resolve()
    },
    sendWindowToastMessage: () => {},
    sendWindowUiMessage: () => {}
  }

  const notificationManager = {
    create: () => Promise.resolve()
  }

  const storage: Storage = produceMemoryStore()
  const accounts = [
    {
      addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
      associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
      }
    },
    {
      addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
      associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae'
      }
    }
  ]
  const providers = Object.fromEntries(
    networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
  )

  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController(
    storage,
    fetch,
    (net) => {
      providersCtrl.setProvider(net)
    },
    (id) => {
      providersCtrl.removeProvider(id)
    }
  )
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers

  let accountsCtrl: AccountsController
  let selectedAccountCtrl: SelectedAccountController
  let actionsCtrl: ActionsController
  test('should init ActionsController', async () => {
    await storage.set('accounts', accounts)
    accountsCtrl = new AccountsController(
      storage,
      providersCtrl,
      networksCtrl,
      () => {},
      () => {},
      () => {}
    )
    selectedAccountCtrl = new SelectedAccountController({ storage, accounts: accountsCtrl })
    await accountsCtrl.initialLoadPromise
    await networksCtrl.initialLoadPromise
    await providersCtrl.initialLoadPromise
    await selectedAccountCtrl.initialLoadPromise
    await selectedAccountCtrl.setAccount(accounts[0])

    actionsCtrl = new ActionsController({
      selectedAccount: selectedAccountCtrl,
      windowManager,
      notificationManager,
      onActionWindowClose: () => {}
    })
    expect(actionsCtrl).toBeDefined()
  })
  test('should add a dappConnect action to actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(1)
        expect(actionsCtrl.currentAction).toEqual(DAPP_CONNECT_ACTION)
      }

      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(DAPP_CONNECT_ACTION, 'last', 'open-action-window')
  })
  test('should add an accountOp action to actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction).toEqual(SIGN_ACCOUNT_OP_ACTION)
        expect((actionsCtrl.currentAction as AccountOpAction).accountOp.calls).toHaveLength(2)
      }

      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(SIGN_ACCOUNT_OP_ACTION, 'last', 'open-action-window')
  })
  test('should update the existing accountOp action by removing a call', (done) => {
    let emitCounter = 0

    const UPDATED_SIGN_ACCOUNT_OP_ACTION: AccountOpAction = {
      ...SIGN_ACCOUNT_OP_ACTION,
      accountOp: {
        ...SIGN_ACCOUNT_OP_ACTION.accountOp,
        calls: [SIGN_ACCOUNT_OP_ACTION.accountOp.calls[0]]
      }
    }

    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 2) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction).toEqual(UPDATED_SIGN_ACCOUNT_OP_ACTION)
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        expect((actionsCtrl.currentAction as AccountOpAction).accountOp.calls).toHaveLength(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(UPDATED_SIGN_ACCOUNT_OP_ACTION, 'first', 'open-action-window')
  })
  test('should add an action with priority', (done) => {
    const BINZIN_ACTION: SignUserRequest = {
      id: 3,
      action: { kind: 'benzin' },
      meta: {
        isSignAction: true,
        networkId: '',
        accountAddr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
        chainId: 1n
      }
    }
    const BENZIN_ACTION: BenzinAction = {
      id: BINZIN_ACTION.id,
      type: 'benzin',
      userRequest: BINZIN_ACTION
    }

    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(3)
        expect(actionsCtrl.currentAction).toEqual(BENZIN_ACTION)
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(BENZIN_ACTION, 'first')
  })
  test('should have banners', () => {
    // one banner for all pending requests: "You have X pending app request(s)"
    expect(actionsCtrl.banners).toHaveLength(1)
  })
  test('on selectedAccount change', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(1) // the BENZIN_ACTION and the SIGN_ACCOUNT_OP_ACTION are for the prev acc
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)

        await selectedAccountCtrl.setAccount(accounts[0])
        await actionsCtrl.forceEmitUpdate()
        unsubscribe()
        done()
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      await selectedAccountCtrl.setAccount(accounts[1])
      await actionsCtrl.forceEmitUpdate()
    })()
  })
  // test('on window close', (done) => {
  //   let emitCounter = 0
  //   const unsubscribe = actionsCtrl.onUpdate(async () => {
  //     emitCounter++

  //     if (emitCounter === 1) {
  //       expect(actionsCtrl.actionWindow.windowProps).toBe(null)
  //       expect(actionsCtrl.actionsQueue).toHaveLength(0)
  //       expect(actionsCtrl.currentAction).toEqual(null)

  //       unsubscribe()
  //       done()
  //     }
  //   })

  //   event.emit('windowRemoved', windowId)
  // })
  // test('should select action by id', (done) => {
  //   let emitCounter = 0
  //   const unsubscribe = actionsCtrl.onUpdate(async () => {
  //     emitCounter++
  //     if (emitCounter === 5) {
  //       expect(actionsCtrl.currentAction?.id).toEqual(1)
  //       unsubscribe()
  //       done()
  //     }
  //     if (emitCounter === 4) {
  //       expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(3)
  //       actionsCtrl.setCurrentActionById(1)
  //     }
  //     if (emitCounter === 3) {
  //       expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(2)
  //     }
  //     if (emitCounter === 2) {
  //       expect(actionsCtrl.currentAction?.id).toEqual(2)
  //       expect(actionsCtrl.actionsQueue).toHaveLength(2)
  //     }

  //     if (emitCounter === 1) {
  //       expect(actionsCtrl.currentAction?.id).toEqual(1)
  //       expect(actionsCtrl.actionsQueue).toHaveLength(1)
  //     }
  //   })

  //   // Add actions to the queue
  //   actionsCtrl.addOrUpdateAction(ACTION_1)
  //   actionsCtrl.addOrUpdateAction(ACTION_2)
  // })
  // test('should remove actions from actionsQueue', (done) => {
  //   let emitCounter = 0
  //   const unsubscribe = actionsCtrl.onUpdate(async () => {
  //     emitCounter++
  //     if (emitCounter === 2) {
  //       expect(actionsCtrl.actionWindow.windowProps).toBe(null)
  //       expect(actionsCtrl.actionsQueue).toHaveLength(0)
  //       expect(actionsCtrl.currentAction).toBe(null)
  //       unsubscribe()
  //       done()
  //     }
  //     if (emitCounter === 1) {
  //       expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(3)
  //       expect(actionsCtrl.actionsQueue).toHaveLength(1)
  //       expect(actionsCtrl.currentAction?.id).toBe(2)
  //       actionsCtrl.removeAction(2)
  //     }
  //   })

  //   actionsCtrl.removeAction(1)
  // })
  // test('removeAccountData', async () => {
  //   // Add actions to the queue
  //   actionsCtrl.addOrUpdateAction(ACTION_1)
  //   actionsCtrl.addOrUpdateAction(ACTION_2)

  //   expect(actionsCtrl.actionsQueue.length).toBeGreaterThanOrEqual(2)

  //   // Remove account data
  //   actionsCtrl.removeAccountData('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')

  //   const globalActions = actionsCtrl.actionsQueue.filter(
  //     (a) => !['accountOp', 'signMessage', 'benzin'].includes(a?.type)
  //   )

  //   expect(actionsCtrl.actionsQueue).toHaveLength(globalActions.length)
  // })
})
