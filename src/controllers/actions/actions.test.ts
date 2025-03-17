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
import { StorageController } from '../storage/storage'
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
  const storageCtrl = new StorageController(storage)
  const networksCtrl = new NetworksController(
    storageCtrl,
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
      storageCtrl,
      providersCtrl,
      networksCtrl,
      () => {},
      () => {},
      () => {}
    )
    selectedAccountCtrl = new SelectedAccountController({
      storage: storageCtrl,
      accounts: accountsCtrl
    })
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
        expect(actionsCtrl.actionWindow.loaded).toEqual(false)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(DAPP_CONNECT_ACTION, 'last', 'open-action-window')
  })
  test('should set window loaded', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.loaded).toEqual(true)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.setWindowLoaded()
  })
  test('should add an accountOp action to actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction).not.toEqual(SIGN_ACCOUNT_OP_ACTION) // 'queue-but-open-action-window' should not set SIGN_ACCOUNT_OP_ACTION as currentAction
        expect(
          (actionsCtrl.visibleActionsQueue[1] as AccountOpAction).accountOp.calls
        ).toHaveLength(2)
      }

      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(SIGN_ACCOUNT_OP_ACTION, 'last', 'queue-but-open-action-window')
  })
  test('should update a queued account op action by removing a call', (done) => {
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
        expect(actionsCtrl.currentAction).not.toEqual(UPDATED_SIGN_ACCOUNT_OP_ACTION)
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        expect(
          (actionsCtrl.visibleActionsQueue[1] as AccountOpAction).accountOp.calls
        ).toHaveLength(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(
      UPDATED_SIGN_ACCOUNT_OP_ACTION,
      'last',
      'queue-but-open-action-window'
    )
  })
  test('should update the existing accountOp action by removing a call and open it', (done) => {
    let emitCounter = 0

    const UPDATED_SIGN_ACCOUNT_OP_ACTION: AccountOpAction = {
      ...SIGN_ACCOUNT_OP_ACTION,
      accountOp: {
        ...SIGN_ACCOUNT_OP_ACTION.accountOp,
        calls: [...SIGN_ACCOUNT_OP_ACTION.accountOp.calls]
      }
    }

    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 2) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction).toEqual(UPDATED_SIGN_ACCOUNT_OP_ACTION)
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)
        expect((actionsCtrl.currentAction as AccountOpAction).accountOp.calls).toHaveLength(2)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(UPDATED_SIGN_ACCOUNT_OP_ACTION, 'last')
  })
  test('should add an action with priority', (done) => {
    const BЕNZIN_ACTION: SignUserRequest = {
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
      id: BЕNZIN_ACTION.id,
      type: 'benzin',
      userRequest: BЕNZIN_ACTION
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
  test('actions update on selecting another account', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(1) // the BENZIN_ACTION and the SIGN_ACCOUNT_OP_ACTION are for the prev acc
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(1)

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
  test('on window close', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.windowProps).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(1) // the remaining accountOp action of the accounts[0]
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(0) // accounts[1] should have no actions
        expect(actionsCtrl.currentAction).toEqual(null)

        unsubscribe()
        done()
      }
    })

    event.emit('windowRemoved', windowId)
  })
  test('select back the first account', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(1)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(1)
        expect(actionsCtrl.actionWindow.windowProps).toBe(null)

        unsubscribe()
        done()
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      await selectedAccountCtrl.setAccount(accounts[0])
      await actionsCtrl.forceEmitUpdate()
    })()
  })
  test('should select action by id', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 4) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(2)
        expect(actionsCtrl.currentAction?.id).toEqual(SIGN_ACCOUNT_OP_ACTION.id)
        unsubscribe()
        done()
      }
      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(2)
        actionsCtrl.setCurrentActionById(SIGN_ACCOUNT_OP_ACTION.id)
      }

      if (emitCounter === 1) {
        expect(actionsCtrl.currentAction).toEqual(DAPP_CONNECT_ACTION)
        expect(actionsCtrl.actionsQueue).toHaveLength(2) // the DAPP_CONNECT_ACTION and the queued SIGN_ACCOUNT_OP_ACTION
      }
    })

    // Add actions to the queue
    actionsCtrl.addOrUpdateAction(DAPP_CONNECT_ACTION)
  })
  test('should select action by index', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 2) {
        expect(actionsCtrl.currentAction).toEqual(DAPP_CONNECT_ACTION)
        expect(actionsCtrl.actionsQueue).toHaveLength(2) // the DAPP_CONNECT_ACTION and the queued SIGN_ACCOUNT_OP_ACTION
        unsubscribe()
        done()
      }
    })

    actionsCtrl.setCurrentActionByIndex(1)
  })
  test('should focus out the current action window', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.windowProps).not.toBe(null)
        expect(actionsCtrl.actionWindow.windowProps?.focused).toEqual(false)
        unsubscribe()
        done()
      }
    })

    event.emit('windowFocusChange', 'random-window-id')
  })
  test('should focus on the minimized action window', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.windowProps).not.toBe(null)
        expect(actionsCtrl.actionWindow.windowProps?.focused).toEqual(true)
        unsubscribe()
        done()
      }
    })

    event.emit('windowFocusChange', windowId)
  })
  test('should remove actions from actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.windowProps?.id).toEqual(2)
        expect(actionsCtrl.actionsQueue).toHaveLength(1)
        expect(actionsCtrl.currentAction?.id).toBe(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.removeAction(SIGN_ACCOUNT_OP_REQUEST.id)
  })
  test('should close the action window', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.windowProps).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(0)
        expect(actionsCtrl.currentAction).toBe(null)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.closeActionWindow()
  })
  test('removeAccountData', async () => {
    // Add actions to the queue
    actionsCtrl.addOrUpdateAction(DAPP_CONNECT_ACTION, 'last', 'queue')
    actionsCtrl.addOrUpdateAction(SIGN_ACCOUNT_OP_ACTION, 'last', 'open-action-window')

    expect(actionsCtrl.actionsQueue.length).toBeGreaterThanOrEqual(2)

    // Remove account data
    actionsCtrl.removeAccountData('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')

    const globalActions = actionsCtrl.actionsQueue.filter(
      (a) => !['accountOp', 'signMessage', 'benzin'].includes(a?.type)
    )

    expect(actionsCtrl.actionsQueue).toHaveLength(globalActions.length)
  })
  test('should toJSON()', () => {
    const json = actionsCtrl.toJSON()
    expect(json).toBeDefined()
  })
})
