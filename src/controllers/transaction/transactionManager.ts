import { createPublicClient, http } from 'viem'
import { sepolia, arbitrumSepolia, baseSepolia } from 'viem/chains'
import { IntentController } from './controllers/intent'
import { ControllersTransactionDependecies, TransactionDependencies } from './dependencies'
import { TransactionFormState } from './transactionFormState'

import EventEmitter from '../eventEmitter/eventEmitter'

export class TransactionManagerController extends EventEmitter {
  public intent: IntentController

  public formState: TransactionFormState

  private controllers: EventEmitter[] = []

  public transactionType: 'transfer' | 'intent' | 'swap' | 'swapAndBridge' | 'error' = 'transfer'

  private dependencies: ControllersTransactionDependecies

  private chainMap = [sepolia, arbitrumSepolia, baseSepolia]

  constructor(deps: TransactionDependencies) {
    super()

    // TODO: intialize interopSDK here
    this.dependencies = { ...deps, interopSDK: null }

    this.formState = new TransactionFormState(this.dependencies)
    this.intent = new IntentController(this.dependencies, this.formState)

    this.controllers = [this.formState, this.intent]

    this.registerControllerUpdates()
  }

  private registerControllerUpdates(): void {
    this.controllers.forEach((controller) => {
      controller.onUpdate(async () => {
        if (controller.toJSON().name === 'TransactionFormState') {
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
      if (
        this.formState.toSelectedToken?.symbol === this.formState.fromSelectedToken?.symbol &&
        this.formState.toSelectedToken?.decimals === this.formState.fromSelectedToken?.decimals
      ) {
        this.transactionType = 'intent'

        await this.intent.getProtocolQuote()

        if (this.formState.fromChainId) {
          this.intent.publicClient = this.getPublicClient(this.formState.fromChainId)
        }
        return
      }

      this.transactionType = 'swapAndBridge'
      return
    }

    this.transactionType = 'error'
  }

  private getPublicClient(chainId: number) {
    const chain = this.chainMap.find((c) => c.id === chainId)

    if (!chain) return

    return createPublicClient({
      chain,
      transport: http()
    })
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
