import { Message } from '../../interfaces/userRequest'

export interface SignedMessage extends Message {
  dapp: {
    name: string
    icon: string
  } | null
  timestamp: number
}

export interface InternalSignedMessages {
  // account => Message[]
  [key: string]: SignedMessage[]
}
