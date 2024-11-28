import { ErrorRef } from '../controllers/eventEmitter/eventEmitter'

export default class EmittableError extends Error {
  level: ErrorRef['level']

  message: ErrorRef['message']

  error: Error

  constructor(errorRef: { message: ErrorRef['message']; level: ErrorRef['level']; error?: Error }) {
    super()
    this.message = errorRef.message
    this.name = 'EmittableError'
    this.level = errorRef.level

    if (!errorRef.error) {
      this.error = new Error(errorRef.message)
    } else {
      this.error = errorRef.error
    }
  }
}
