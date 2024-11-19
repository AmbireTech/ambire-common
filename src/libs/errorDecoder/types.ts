export enum ErrorType {
  RevertError = 'RevertError',
  PanicError = 'PanicError',
  RelayerError = 'RelayerError',
  PaymasterError = 'PaymasterError',
  BundlerError = 'BundlerError',
  RpcError = 'RpcError',
  UnknownError = 'UnknownError',
  InnerCallFailureError = 'InnerCallFailureError'
}

export type DecodedError = {
  type: ErrorType
  reason: string | null
  data: string | null
}

export type ErrorHandler = {
  matches: (data: string, error: Error) => boolean
  handle: (data: string, error: Error) => DecodedError
}
