class InnerCallFailureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InnerCallFailureError'
  }
}

export { InnerCallFailureError }
