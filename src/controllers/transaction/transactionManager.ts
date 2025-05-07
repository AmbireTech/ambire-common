import { SwapAndBridgeController } from './controllers/swapAndBridge'
import { IntentController } from './controllers/intent'
import { TransferController } from './controllers/transfer'
import { TransactionFormState } from './transactionFormState'
import { TransactionDependencies } from './dependencies'

export class TransactionManager {
  public swapAndBridge: SwapAndBridgeController

  public intent: IntentController

  public transfer: TransferController

  public formState: TransactionFormState

  constructor(dependencies: TransactionDependencies) {
    // if we need to access dependencies in the future
    // just pass it down to the transaction form state
    this.formState = new TransactionFormState()

    this.swapAndBridge = new SwapAndBridgeController(dependencies, this.formState)
    this.intent = new IntentController(dependencies, this.formState)
    this.transfer = new TransferController(dependencies, this.formState)
  }
}
