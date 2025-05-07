import EventEmitter from '../../eventEmitter/eventEmitter'
import { TransactionDependencies } from '../dependencies'
import { TransactionFormState } from '../transactionFormState'

export class IntentController extends EventEmitter {
  constructor(
    private readonly dependencies: TransactionDependencies,
    private readonly formState: TransactionFormState
  ) {
    super()
  }

  // doSomething() {
  //   Access dependencies like this
  //   this.dependencies.networks
  // }
}
