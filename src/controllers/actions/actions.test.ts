import EventEmitter from 'events'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { DappUserRequest, SignUserRequest } from '../../interfaces/userRequest'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { ActionsController, BenzinAction, DappRequestAction } from './actions'

describe('SignMessageController', () => {
  const event = new EventEmitter()
  let windowId = 0
  const windowManager = {
    event,
    focus: () => Promise.resolve(),
    open: () => {
      windowId++
      return Promise.resolve(windowId)
    },
    remove: () => {
      event.emit('windowRemoved', windowId)
      return Promise.resolve()
    },
    sendWindowToastMessage: () => {}
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
  let actionsCtrl: ActionsController
  test('should init ActionsController', async () => {
    await storage.set('accounts', accounts)
    accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
    await accountsCtrl.initialLoadPromise
    await networksCtrl.initialLoadPromise
    await providersCtrl.initialLoadPromise
    accountsCtrl.selectedAccount = '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
    actionsCtrl = new ActionsController({
      accounts: accountsCtrl,
      windowManager,
      onActionWindowClose: () => {}
    })
    expect(actionsCtrl).toBeDefined()
  })
  test('should add actions to actionsQueue', (done) => {
    const req1: DappUserRequest = {
      id: 1,
      action: { kind: 'dappConnect', params: {} },
      meta: { isSignAction: false },
      session: { name: '', icon: '', origin: '' },
      dappPromise: { resolve: () => {}, reject: () => {} }
    }
    const req2: DappUserRequest = {
      id: 2,
      action: { kind: 'dappConnect', params: {} },
      meta: { isSignAction: false },
      session: { name: '', icon: '', origin: '' },
      dappPromise: { resolve: () => {}, reject: () => {} }
    }
    const action1: DappRequestAction = { id: req1.id, type: 'dappRequest', userRequest: req1 }
    const action2: DappRequestAction = { id: req2.id, type: 'dappRequest', userRequest: req2 }

    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 3) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction).toEqual(action1)
        unsubscribe()
        done()
      }

      if (emitCounter === 2) {
        actionsCtrl.addOrUpdateAction(action2)
        expect(actionsCtrl.actionWindow.id).toEqual(1)
      }
    })

    actionsCtrl.addOrUpdateAction(action1)
    expect(actionsCtrl.actionsQueue).toHaveLength(1)
    expect(actionsCtrl.currentAction).toEqual(action1)
  })
  test('should update action', (done) => {
    const updatedReq2: DappUserRequest = {
      id: 2,
      action: { kind: 'dappConnect', params: { someUpdatedParams: {} } },
      meta: { isSignAction: false },
      session: { name: '', icon: '', origin: '' },
      dappPromise: { resolve: () => {}, reject: () => {} }
    }
    const updatedAction2: DappRequestAction = {
      id: updatedReq2.id,
      type: 'dappRequest',
      userRequest: updatedReq2
    }

    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(2)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
        expect(actionsCtrl.currentAction?.id).not.toEqual(null)
        // update does not change the currently selectedAction
        expect(actionsCtrl.currentAction?.id).not.toEqual(updatedAction2.id)
        expect(actionsCtrl.actionWindow.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(updatedAction2, true)
  })
  test('should add an action with priority', (done) => {
    const req3: SignUserRequest = {
      id: 3,
      action: { kind: 'benzin' },
      meta: {
        isSignAction: true,
        accountAddr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
        networkId: 'ethereum'
      }
    }
    const action3: BenzinAction = { id: req3.id, type: 'benzin', userRequest: req3 }

    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(3)
        expect(actionsCtrl.currentAction).toEqual(action3)
        expect(actionsCtrl.actionWindow.id).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(action3, true)
  })
  test('should have banners', () => {
    // no banner for benzin and one banner for the 2 other actions
    expect(actionsCtrl.banners).toHaveLength(1)
  })
  test('on selectedAccount change', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
        expect(actionsCtrl.actionWindow.id).toEqual(1)

        await accountsCtrl.selectAccount('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')
        await actionsCtrl.forceEmitUpdate()
        unsubscribe()
        done()
      }
    })
    ;(async () => {
      await accountsCtrl.selectAccount('0x71c3D24a627f0416db45107353d8d0A5ae0401ae')
      actionsCtrl.forceEmitUpdate()
    })()
  })
  test('on window close', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.id).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(2) // benzin action should be removed
        expect(actionsCtrl.currentAction).toEqual(null)

        unsubscribe()
        done()
      }
    })

    event.emit('windowRemoved', windowId)
  })
  test('should select action by id', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.id).toBe(2) // action-window is reopened on setCurrentAction
        unsubscribe()
        done()
      }

      if (emitCounter === 1) {
        expect(actionsCtrl.currentAction?.id).toEqual(2)
      }
    })

    expect(actionsCtrl.actionsQueue).toHaveLength(2)
    expect(actionsCtrl.visibleActionsQueue).toHaveLength(2)
    actionsCtrl.setCurrentActionById(2)
  })
  test('should remove actions from actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindow.id).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(0)
        expect(actionsCtrl.currentAction).toBe(null)
        unsubscribe()
        done()
      }
      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindow.id).toEqual(2)
        expect(actionsCtrl.actionsQueue).toHaveLength(1)
        expect(actionsCtrl.currentAction?.id).toBe(2)
        actionsCtrl.removeAction(2)
      }
    })

    actionsCtrl.removeAction(1)
  })
})
