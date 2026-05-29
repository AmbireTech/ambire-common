import EventEmitter from '../../eventEmitter/eventEmitter';
import { ControllersTransactionDependencies } from '../dependencies';
import { TransactionFormState } from '../transactionFormState';
export declare class IntentController extends EventEmitter {
    private readonly dependencies;
    private readonly formState;
    formPreviousState: any;
    publicClient: any | undefined;
    params: any;
    quote: any;
    transactions: any[];
    constructor(dependencies: ControllersTransactionDependencies, formState: TransactionFormState);
    getProtocolQuote(): Promise<void>;
    setQuote(quote: any): void;
    setTransaction(transactions: any): void;
    setQuoteAndTransaction(quote: any, transactions: any): void;
}
//# sourceMappingURL=intent.d.ts.map