import { ControllerInterface } from './controller'

export type ITransfersScannerController = ControllerInterface<
  InstanceType<
    typeof import('../controllers/transfersScanner/transfersScanner').TransfersScannerController
  >
>
