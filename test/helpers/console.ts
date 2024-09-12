export function suppressConsole() {
  const originalError = jest.spyOn(console, 'error').mockImplementation(() => {})
  const originalLog = jest.spyOn(console, 'log').mockImplementation(() => {})

  return {
    restore: () => {
      originalError.mockRestore()
      originalLog.mockRestore()
    }
  }
}
