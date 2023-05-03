export type LogType = {
  address: string
  blockHash: string
  blockNumber: number
  data: string
  logIndex: number
  removed: boolean
  topics: string[]
  transactionHash: string
  transactionIndex: number
}

export type ParsedLogType = LogType & {
  to: string
}

export type ByHash = {
  [key: string]: LogType
}
