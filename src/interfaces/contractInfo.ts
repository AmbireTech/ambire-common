import { ControllerInterface } from './controller'

export type IContractInfoController = ControllerInterface<
  InstanceType<typeof import('../controllers/contractInfo/contractInfo').ContractInfo>
>

export interface SelectorsFromStorage {
  [selector: string]: { signature: string }[]
}
export interface Selectors {
  [selector: string]:
    | { status: 'success'; data: { signature: string }[] }
    | { status: 'error'; error: string }
    | { status: 'not-found' }
    | { status: 'loading' }
}

export type SourcifyFunctionsResponse =
  | {
      ok: false
    }
  | {
      ok: true
      result: {
        function: {
          [selector: string]: { name: string; filtered: boolean; hasVerifiedContract: boolean }[]
        }
      }
    }
