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

  public transactionType: 'transfer' | 'intent' | 'swap' | 'swapAndBridge' | 'error' = 'transfer'

  constructor(private dependencies: TransactionDependencies) {
    super()

    this.formState = new TransactionFormState(dependencies)
    this.swapAndBridge = new SwapAndBridgeController(dependencies, this.formState)
    this.intent = new IntentController(dependencies, this.formState)
    this.transfer = new TransferController(dependencies, this.formState)

    this.controllers = [this.formState, this.swapAndBridge, this.intent, this.transfer]

    this.registerControllerUpdates()
  }

  private registerControllerUpdates(): void {
    this.controllers.forEach((controller) => {
      controller.onUpdate(() => {
        if (controller.constructor.name === 'TransactionFormState') {
          this.handleFormUpdate()
        }
        // when any controller updates, propagate through the manager
        this.emitUpdate()
      }, `${controller.constructor.name}-update`)
    })
  }

  /*
   * Same-chain transfers: same chain, same token -> type: transfer
   * Same-chain swaps: same chain, different token -> type: swap
   * Cross-chain transfer: different chain, same token -> type: intent
   * Cross-chain swapAndBridge: different chain, different token -> type: swapAndBridge
   * Error: Same address, same chain, same token -> type: error
   */
  private handleFormUpdate() {
    if (this.formState.fromChainId === this.formState.toChainId) {
      if (this.formState.toSelectedToken?.address === this.formState.fromSelectedToken?.address) {
        if (
          this.formState.addressState.fieldValue === this.dependencies.selectedAccount.account?.addr
        ) {
          this.transactionType = 'error'
          return
        }
        this.transactionType = 'transfer'
        return
      }

      this.transactionType = 'swap'
    } else if (this.formState.fromChainId !== this.formState.toChainId) {
      if (this.formState.toSelectedToken?.address === this.formState.fromSelectedToken?.address) {
        this.transactionType = 'intent'
        return
      }

      this.transactionType = 'swapAndBridge'
      return
    }

    this.transactionType = 'error'
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      transactionType: this.transactionType,
      formState: this.formState.toJSON(),
      swapAndBridge: this.swapAndBridge.toJSON(),
      intent: this.intent.toJSON(),
      transfer: this.transfer.toJSON()
    }
  }
}
