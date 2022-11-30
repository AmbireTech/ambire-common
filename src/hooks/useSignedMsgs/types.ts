import { UseStorageType } from '../useStorage'

export type UseSignedMsgsProps = {
  useStorage: UseStorageType
}

export type UseSignedMsgsReturnType = {
  addSignedMessage: (msg: any) => void
  signedMessages: any[]
}
