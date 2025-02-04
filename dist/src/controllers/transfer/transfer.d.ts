import { Account } from '../../interfaces/account';
import { AddressState } from '../../interfaces/domains';
import { Network } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import { TransferUpdate } from '../../interfaces/transfer';
import { HumanizerMeta } from '../../libs/humanizer/interfaces';
import { TokenResult } from '../../libs/portfolio';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class TransferController extends EventEmitter {
    #private;
    isSWWarningVisible: boolean;
    isSWWarningAgreed: boolean;
    amount: string;
    amountInFiat: string;
    amountFieldMode: 'fiat' | 'token';
    addressState: AddressState;
    isRecipientAddressUnknown: boolean;
    isRecipientAddressUnknownAgreed: boolean;
    isRecipientHumanizerKnownTokenOrSmartContract: boolean;
    isTopUp: boolean;
    constructor(storage: Storage, humanizerInfo: HumanizerMeta, selectedAccountData: Account, networks: Network[]);
    get shouldSkipTransactionQueuedModal(): boolean;
    set shouldSkipTransactionQueuedModal(value: boolean);
    set selectedToken(token: TokenResult | null);
    get selectedToken(): TokenResult | null;
    get maxAmount(): string;
    get maxAmountInFiat(): string;
    resetForm(): void;
    get validationFormMsgs(): {
        amount: {
            success: boolean;
            message: string;
        };
        recipientAddress: {
            success: boolean;
            message: string;
        };
    };
    get isFormValid(): boolean | null;
    get isInitialized(): boolean;
    get recipientAddress(): string;
    update({ selectedAccountData, humanizerInfo, selectedToken, amount, addressState, isSWWarningAgreed, isRecipientAddressUnknownAgreed, isTopUp, networks, contacts, amountFieldMode }: TransferUpdate): void;
    checkIsRecipientAddressUnknown(): void;
    toJSON(): this & {
        validationFormMsgs: {
            amount: {
                success: boolean;
                message: string;
            };
            recipientAddress: {
                success: boolean;
                message: string;
            };
        };
        isFormValid: boolean | null;
        isInitialized: boolean;
        selectedToken: TokenResult | null;
        maxAmount: string;
        maxAmountInFiat: string;
        shouldSkipTransactionQueuedModal: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=transfer.d.ts.map