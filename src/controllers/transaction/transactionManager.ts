import { SwapAndBridgeController } from './controllers/swapAndBridge'
import { IntentController } from './controllers/intent'
import { TransferController } from './controllers/transfer'
import { TransactionDependencies } from './dependencies'
import { TransactionFormState } from './transactionFormState'

import EventEmitter from '../eventEmitter/eventEmitter'

export class TransactionManagerController extends EventEmitter {
  public swapAndBridge: SwapAndBridgeController

  public intent: IntentController

  public transfer: TransferController

  public formState: TransactionFormState

  private controllers: EventEmitter[] = []

  constructor(dependencies: TransactionDependencies) {
    super()

    this.formState = new TransactionFormState()
    this.swapAndBridge = new SwapAndBridgeController(dependencies, this.formState)
    this.intent = new IntentController(dependencies, this.formState)
    this.transfer = new TransferController(dependencies, this.formState)

    this.controllers = [this.formState, this.swapAndBridge, this.intent, this.transfer]

    this.registerControllerUpdates()
  }

  private registerControllerUpdates(): void {
    this.controllers.forEach((controller) => {
      controller.onUpdate(() => {
        // when any controller updates, propagate through the manager
        this.emitUpdate()
      }, `${controller.constructor.name}-update`)
    })
  }
}
