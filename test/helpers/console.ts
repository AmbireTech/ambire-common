function suppressConsoleBeforeEach() {
  let originalLog: jest.SpyInstance
  let originalError: jest.SpyInstance

  beforeEach(() => {
    originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})
    originalError = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    originalError.mockRestore()
    originalLog.mockRestore()
  })
}

function suppressConsole() {
  const originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})
  const originalError = jest.spyOn(console, 'error').mockImplementation(() => {})

  return {
    restore: () => {
      originalError.mockRestore()
      originalLog.mockRestore()
    }
  }
}

export { suppressConsole, suppressConsoleBeforeEach }
