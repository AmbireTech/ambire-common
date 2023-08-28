export interface IrCall {
  data: string
  to: string
  value: bigint
  fullVisualization?: any
}

export interface Ir {
  calls: IrCall[]
}

export interface HumanizerFragment {
  key: string
  isGlobal: boolean
  value: string | Array<any> | object
}
