import type { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'

export interface KeystoreSigner {
  signRawTransaction: (params: any) => Promise<string>
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    primaryType?: string
  ) => Promise<string>
  signMessage: (hash: string) => Promise<string>
}
