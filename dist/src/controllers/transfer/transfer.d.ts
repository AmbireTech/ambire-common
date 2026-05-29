import { IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IDappsController } from '../../interfaces/dapp';
import { AddressState } from '../../interfaces/domains';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISignAccountOpController } from '../../interfaces/signAccountOp';
import { IStorageController } from '../../interfaces/storage';
import { AddressPoisoningMatch, ITransferController, TransferUpdate } from '../../interfaces/transfer';
import { IUiController, View } from '../../interfaces/ui';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { HumanizerMeta } from '../../libs/humanizer/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { Validation } from '../../services/validations';
import EventEmitter from '../eventEmitter/eventEmitter';
import { OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp';
type SignAccountOpControllerMethods = {
    [K in keyof SignAccountOpController as SignAccountOpController[K] extends (...args: any) => any ? K : never]: SignAccountOpController[K];
};
export declare class TransferController extends EventEmitter implements ITransferController {
    #private;
    /**
     * The field value for the amount input. Not sanitized and can contain
     * invalid values. Use #getSafeAmountFromFieldValue() to get a formatted value.
     */
    amount: string;
    amountInFiat: string;
    /**
     * A counter used to trigger UI updates when a form values is
     * changed programmatically by the controller.
     */
    programmaticUpdateCounter: number;
    amountFieldMode: 'fiat' | 'token';
    addressState: AddressState;
    areDefaultsSet: boolean;
    isRecipientAddressUnknown: boolean;
    isRecipientAddressUnknownAgreed: boolean;
    isRecipientHumanizerKnownTokenOrSmartContract: boolean;
    isRecipientAddressViewOnly: boolean;
    isTopUp: boolean;
    isRecipientAddressFirstTimeSend: boolean;
    lastSentToRecipientAt: Date | null;
    addressPoisoningMatch: AddressPoisoningMatch | null;
    signAccountOpController: ISignAccountOpController | null;
    latestBroadcastedAccountOp: AccountOp | null;
    latestBroadcastedToken: TokenResult | null;
    hasProceeded: boolean;
    constructor(callRelayer: Function, storage: IStorageController, humanizerInfo: HumanizerMeta, selectedAccount: ISelectedAccountController, networks: INetworksController, addressBook: IAddressBookController, accounts: IAccountsController, keystore: IKeystoreController, portfolio: IPortfolioController, activity: IActivityController, externalSignerControllers: ExternalSignerControllers, providers: IProvidersController, phishing: IPhishingController, dapps: IDappsController, relayerUrl: string, onBroadcastSuccess: OnBroadcastSuccess, ui: IUiController, eventEmitterRegistry?: IEventEmitterRegistryController);
    get transferSessionId(): string;
    get shouldSkipTransactionQueuedModal(): boolean;
    set shouldSkipTransactionQueuedModal(value: boolean);
    set selectedToken(token: TokenResult | null);
    get selectedToken(): TokenResult | null;
    get tokens(): TokenResult[];
    get maxAmount(): string;
    get maxAmountInFiat(): string;
    resetForm(shouldDestroyAccountOp?: boolean): void;
    get validationFormMsgs(): {
        amount: Validation;
        recipientAddress: Validation;
    };
    get isFormValid(): boolean;
    get isInitialized(): boolean;
    get recipientAddress(): string;
    update({ humanizerInfo, selectedToken, amount, shouldSetMaxAmount, addressState, isRecipientAddressUnknownAgreed, amountFieldMode }: TransferUpdate): Promise<void>;
    checkIsRecipientAddressUnknown(): void;
    checkIsRecipientAddressViewOnly(): void;
    /**
     * When doing a MAX transfer or a close to MAX transfer out,
     * if the selected fee token is the same as the transfer token,
     * we automatically adjust the transfer amount so the user
     * can successfully broadcast. For that, we put an additional
     * warning telling him why this is happening
     */
    get amountAdjustmentWarning(): Validation | null;
    get hasPersistedState(): boolean;
    syncSignAccountOp(): Promise<void>;
    callSignAccountOpMethod<M extends keyof SignAccountOpControllerMethods>(method: M, args: Parameters<SignAccountOpControllerMethods[M]>): Promise<void>;
    setUserProceeded(hasProceeded: boolean): void;
    destroySignAccountOp(): void;
    destroyLatestBroadcastedAccountOp(skipUpdate?: boolean): void;
    unloadScreen(viewType: View['type'], opts?: {
        isNavigateOut: boolean;
    }): void;
    reset(opts?: {
        destroyAccountOp: boolean;
    }): void;
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq(): void;
    toJSON(): this & {
        transferSessionId: string;
        validationFormMsgs: {
            amount: Validation;
            recipientAddress: Validation;
        };
        isFormValid: boolean;
        isInitialized: boolean;
        selectedToken: TokenResult;
        tokens: TokenResult[];
        maxAmount: string;
        maxAmountInFiat: string;
        shouldSkipTransactionQueuedModal: boolean;
        hasPersistedState: boolean;
        isRecipientAddressViewOnly: boolean;
        amountAdjustmentWarning: Validation;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=transfer.d.ts.map