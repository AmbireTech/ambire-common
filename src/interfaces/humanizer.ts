import { AbiFragment } from 'libs/humanizer/interfaces'

// @TODO make this an enum
export interface HumanizerFragment {
  type: 'knownAddresses' | 'abis' | 'selector' | 'token'
  isGlobal: boolean
  key: string
  value: string | Array<any> | AbiFragment | any
}
