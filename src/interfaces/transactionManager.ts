import { ControllerInterface } from './controller'

export type ITransactionManagerController = ControllerInterface<
  InstanceType<
    typeof import('../controllers/transaction/transactionManager').TransactionManagerController
  >
>
