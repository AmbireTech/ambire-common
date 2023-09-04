import { TypedMessage } from './userRequest'

export interface KeystoreSigner {
  signRawTransaction: (params: any) => Promise<string>
  // @TODO update this
  signTypedData: (typedMessage: TypedMessage) => Promise<string>
  signMessage: (hash: string | Uint8Array) => Promise<string>
}
