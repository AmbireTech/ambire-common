import EventEmitter from 'events'

const mockWindowManager = (eventEmitter?: EventEmitter) => {
  let windowId = 0
  const event = eventEmitter || new EventEmitter()

  const windowManager = {
    event,
    focus: () =>
      Promise.resolve({
        id: windowId,
        top: 0,
        left: 0,
        width: 100,
        height: 100,
        focused: true
      }),
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

  return { windowManager, getWindowId: () => windowId, eventEmitter: event }
}

export { mockWindowManager }
