import { ControllerInterface } from './controller'

export type IContractNamesController = ControllerInterface<
  InstanceType<typeof import('../controllers/contractNames/contractNames').ContractNamesController>
>
