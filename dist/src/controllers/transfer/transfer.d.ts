import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { IDappsController } from '../../interfaces/dapp';
import { AddressState } from '../../interfaces/domains';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IPrivacyPoolsController } from '../../interfaces/privacyPools';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISignAccountOpController } from '../../interfaces/signAccountOp';
import { IStorageController } from '../../interfaces/storage';
import { AddressPoisoningMatch, AmountAdjustmentInfo, ITransferController, TransferUpdate } from '../../interfaces/transfer';
import { IUiController, View } from '../../interfaces/ui';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { Call } from '../../libs/accountOp/types';
import { HumanizerMeta } from '../../libs/humanizer/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { RecipientValidation, Validation } from '../../services/validations';
import EventEmitter from '../eventEmitter/eventEmitter';
import { OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp';
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference';
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
    /**
     * Seed id of the Privacy Pools account to deposit into, instead of an address. Exclusive with
     * `addressState`: setting either clears the other. Limits the tokens to what the pools accept.
     */
    privacyPoolsRecipient: string | null;
    /** Whether the deposit calls are being built. The first build per account syncs its network. */
    isPreparingPrivacyPoolsDeposit: boolean;
    /** Why the deposit cannot be prepared, in words for the user. */
    privacyPoolsDepositError: string | null;
    isRecipientAddressFirstTimeSend: boolean;
    lastSentToRecipientAt: Date | null;
    addressPoisoningMatch: AddressPoisoningMatch | null;
    /**
     * Set when the recipient is a domain (ENS/Namoshi) the user has sent to before, but it now resolves
     * to a DIFFERENT address than last time (possible expiry/snipe).
     */
    recipientDomainAddressChange: {
        previousAddress: string;
    } | null;
    signAccountOpController: ISignAccountOpController | null;
    latestBroadcastedAccountOp: AccountOp | null;
    latestBroadcastedToken: TokenResult | null;
    hasProceeded: boolean;
    constructor(callRelayer: BindedRelayerCall, storage: IStorageController, signAccountOpPreference: SignAccountOpPreferenceController, featureFlags: IFeatureFlagsController, humanizerInfo: HumanizerMeta, selectedAccount: ISelectedAccountController, networks: INetworksController, addressBook: IAddressBookController, accounts: IAccountsController, keystore: IKeystoreController, portfolio: IPortfolioController, activity: IActivityController, externalSignerControllers: ExternalSignerControllers, providers: IProvidersController, phishing: IPhishingController, dapps: IDappsController, relayerUrl: string, onBroadcastSuccess: OnBroadcastSuccess, ui: IUiController, erc7730: IErc7730Controller, contractInfo: IContractInfoController, platform: Platform, privacyPools?: IPrivacyPoolsController, eventEmitterRegistry?: IEventEmitterRegistryController);
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
        recipientAddress: RecipientValidation;
    };
    get isFormValid(): boolean;
    get isInitialized(): boolean;
    get recipientAddress(): string;
    /**
     * Whether the recipient is in the locally stored phishing list. The list is kept up to date by
     * the PhishingController, so the lookup needs no network request.
     */
    get isRecipientAddressBlacklisted(): boolean;
    update({ humanizerInfo, selectedToken, amount, shouldSetMaxAmount, addressState, isRecipientAddressUnknownAgreed, amountFieldMode, privacyPoolsRecipient }: TransferUpdate): Promise<void>;
    checkIsRecipientAddressUnknown(): void;
    checkIsRecipientAddressViewOnly(): void;
    /** Information needed by the UI when the transfer amount was reduced to leave funds for the fee. */
    get amountAdjustmentInfo(): AmountAdjustmentInfo | null;
    /** Kept for clients that still render the previous validation-style adjustment message. */
    get amountAdjustmentWarning(): Validation | null;
    get hasPersistedState(): boolean;
    syncSignAccountOp(): Promise<void>;
    /** Builds the deposit calls into a Privacy Pools account. May first sync its network (slow). */
    buildPrivacyPoolsDepositCalls({ seedId, selectedToken, amount }: {
        seedId: string;
        selectedToken: TokenResult;
        /** Already sanitized to the token's decimals. */
        amount: string;
    }): Promise<Call[]>;
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
            recipientAddress: RecipientValidation;
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
        isRecipientAddressBlacklisted: boolean;
        amountAdjustmentInfo: AmountAdjustmentInfo;
        amountAdjustmentWarning: Validation;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=transfer.d.ts.map