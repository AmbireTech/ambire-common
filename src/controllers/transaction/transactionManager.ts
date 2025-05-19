import { IntentController } from './controllers/intent'
import { TransactionDependencies } from './dependencies'
import { TransactionFormState } from './transactionFormState'

import EventEmitter from '../eventEmitter/eventEmitter'

export class TransactionManagerController extends EventEmitter {
  public intent: IntentController

  public formState: TransactionFormState

  private controllers: EventEmitter[] = []

  public transactionType: 'transfer' | 'intent' | 'swap' | 'swapAndBridge' | 'error' = 'transfer'

  constructor(private dependencies: TransactionDependencies) {
    super()

    // TODO: intialize interopSDK here
    this.dependencies = { ...dependencies, interopSDK: null }

    this.formState = new TransactionFormState(dependencies)
    this.intent = new IntentController(dependencies, this.formState)

    this.controllers = [this.formState]

    this.registerControllerUpdates()
  }

  private registerControllerUpdates(): void {
    this.controllers.forEach((controller) => {
      controller.onUpdate(async () => {
        if (controller.constructor.name === 'TransactionFormState') {
          try {
            await this.handleFormUpdate()
          } catch (error: any) {
            this.emitError({ error, level: 'silent', message: error?.message })
          }
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
  private async handleFormUpdate() {
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
        await this.intent.getProtocolQuote()
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
      intent: this.intent.toJSON()
    }
  }
}
