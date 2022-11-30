export type UseGetMsgTypeProps = {
  msgToSign: any
}

export type UseGetMsgTypeReturnType = {
  /** Error when formatting the typed data */
  typeDataErr: any
  /** msg to be signed on the requested network */
  requestedChainId: any
  /** The formatted typed data to sign. Will be undefined if the msg is not typedData */
  dataV4: any
  isTypedData: boolean
}
