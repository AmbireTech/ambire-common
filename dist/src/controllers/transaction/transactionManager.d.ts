import { ITransactionManagerController } from '../../interfaces/transactionManager';
import EventEmitter from '../eventEmitter/eventEmitter';
import { IntentController } from './controllers/intent';
import { TransactionDependencies } from './dependencies';
import { TransactionFormState } from './transactionFormState';
export declare class TransactionManagerController extends EventEmitter implements ITransactionManagerController {
    #private;
    intent: IntentController;
    formState: TransactionFormState;
    transactionType: 'transfer' | 'intent' | 'swap' | 'swapAndBridge' | 'error';
    constructor(deps: TransactionDependencies);
    private registerControllerUpdates;
    private handleFormUpdate;
    private getPublicClient;
    toJSON(): this & {
        transactionType: "error" | "transfer" | "swapAndBridge" | "swap" | "intent";
        formState: TransactionFormState & {
            name: string;
            supportedChainIds: bigint[];
            maxFromAmount: string;
            recipientAddress: string;
            emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
        };
        intent: IntentController & {
            name: string;
            emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
        };
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=transactionManager.d.ts.map