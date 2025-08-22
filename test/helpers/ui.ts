import EventEmitter from 'events'

const mockUiManager = (eventEmitter?: EventEmitter) => {
  let windowId = 0
  const event = eventEmitter || new EventEmitter()

  return {
    uiManager: {
      window: {
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
        closePopupWithUrl: () => {
          event.emit('windowRemoved', windowId)
          return Promise.resolve()
        },
        remove: (id: number | 'popup') => {
          if (id === 'popup') return Promise.resolve()

          event.emit('windowRemoved', windowId)
          return Promise.resolve()
        }
      },
      notification: {
        create: () => Promise.resolve()
      },
      message: {
        sendToastMessage: () => {},
        sendUiMessage: () => {},
        sendNavigateMessage: () => {}
      }
    },
    getWindowId: () => windowId,
    eventEmitter: event
  }
}

export { mockUiManager }
