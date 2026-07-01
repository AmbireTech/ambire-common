import { ControllerInterface } from './controller'

export type IContractInfoController = ControllerInterface<
  InstanceType<typeof import('../controllers/contractInfo/contractInfo').ContractInfoController>
>

export interface Selectors {
  [selector: string]:
    | { status: 'success'; data: { signature: string }[]; updatedAt: number }
    | { status: 'error'; data?: { signature: string }[]; error: string; updatedAt: number }
    | { status: 'not-found'; updatedAt: number }
    | { status: 'loading'; data?: { signature: string }[]; updatedAt: number }
    | { status: 'fetching-disabled'; updatedAt: number }
}
