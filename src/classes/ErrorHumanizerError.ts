export default class ErrorHumanizerError extends Error {
  isFallbackMessage: boolean

  constructor(
    message: string,
    {
      cause,
      isFallbackMessage
    }: {
      cause?: string | null
      isFallbackMessage?: boolean
    }
  ) {
    super(message)
    this.name = 'ErrorHumanizerError'
    this.isFallbackMessage = !!isFallbackMessage
    this.cause = cause
  }
}
