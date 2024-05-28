import EventEmitter from 'events'

import { describe, expect, test } from '@jest/globals'

import { DappUserRequest, SignUserRequest } from '../../interfaces/userRequest'
import { ActionsController } from './actions'

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

  let actionsCtrl: ActionsController
  test('should init ActionsController', () => {
    actionsCtrl = new ActionsController({ windowManager, onActionWindowClose: () => {} })
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
    const action1 = { id: req1.id, type: 'userRequest', userRequest: req1 }
    const action2 = { id: req2.id, type: 'userRequest', userRequest: req2 }

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
        expect(actionsCtrl.actionWindowId).toEqual(1)
      }
    })

    actionsCtrl.addOrUpdateAction(action1)
    expect(actionsCtrl.actionsQueue).toHaveLength(1)
    expect(actionsCtrl.currentAction).toEqual(action1)
  })
  test('should add an action with priority', (done) => {
    const req3: SignUserRequest = {
      id: 3,
      action: { kind: 'benzin' },
      meta: { isSignAction: true, accountAddr: '', networkId: '' }
    }
    const action3 = { id: req3.id, type: 'benzin', userRequest: req3 }

    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionsQueue).toHaveLength(3)
        expect(actionsCtrl.currentAction).toEqual(action3)
        expect(actionsCtrl.actionWindowId).toEqual(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.addOrUpdateAction(action3, true)
  })
  test('on window close', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindowId).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(2) // benzin action should be removed
        expect(actionsCtrl.currentAction).toEqual(null)

        unsubscribe()
        done()
      }
    })

    event.emit('windowRemoved', windowId)
  })
  test('should open first action when action-window is closed but there are pending actions', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 3) {
        expect(actionsCtrl.actionWindowId).toEqual(2)
        expect(actionsCtrl.currentAction).not.toBe(null)
        expect(actionsCtrl.currentAction?.id).toBe(1)
        unsubscribe()
        done()
      }
    })

    actionsCtrl.openFirstPendingAction()
  })
  test('should remove actions from actionsQueue', (done) => {
    let emitCounter = 0
    const unsubscribe = actionsCtrl.onUpdate(async () => {
      emitCounter++

      if (emitCounter === 2) {
        expect(actionsCtrl.actionWindowId).toBe(null)
        expect(actionsCtrl.actionsQueue).toHaveLength(0)
        expect(actionsCtrl.currentAction).toBe(null)
        unsubscribe()
        done()
      }
      if (emitCounter === 1) {
        expect(actionsCtrl.actionWindowId).toEqual(2)
        expect(actionsCtrl.actionsQueue).toHaveLength(1)
        expect(actionsCtrl.currentAction?.id).toBe(2)
        actionsCtrl.removeAction(2)
      }
    })

    actionsCtrl.removeAction(1)
  })
})
