import { afterEach, beforeEach } from '@jest/globals'

export function suppressConsole() {
  let originalError: jest.SpyInstance
  let originalLog: jest.SpyInstance

  beforeEach(() => {
    originalError = jest.spyOn(console, 'error').mockImplementation(() => {})
    originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    originalError.mockRestore()
    originalLog.mockRestore()
  })
}
