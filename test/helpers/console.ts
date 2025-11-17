function suppressConsoleBeforeEach(suppressWarns = false) {
  let originalLog: jest.SpyInstance
  let originalError: jest.SpyInstance
  let originalWarn: jest.SpyInstance

  beforeEach(() => {
    originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})
    originalError = jest.spyOn(console, 'error').mockImplementation(() => {})
    if (suppressWarns) {
      originalWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    }
  })

  afterEach(() => {
    originalError.mockRestore()
    originalLog.mockRestore()
    if (originalWarn) originalWarn.mockRestore()
  })
}

function suppressConsole(suppressWarns = false) {
  const originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})
  const originalError = jest.spyOn(console, 'error').mockImplementation(() => {})
  let originalWarn: jest.SpyInstance

  if (suppressWarns) {
    originalWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  }

  return {
    restore: () => {
      originalError.mockRestore()
      originalLog.mockRestore()
      if (originalWarn) originalWarn.mockRestore()
    }
  }
}

export { suppressConsole, suppressConsoleBeforeEach }
