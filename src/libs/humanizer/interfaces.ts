export interface IrCall {
  data: string
  to: string
  value: bigint
  fullVisualization: any
}

export interface Ir {
  calls: IrCall[]
}
