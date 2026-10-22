import { Account, IAccountsController } from '../../interfaces/account';
import { DappVerificationBanner, IDappsController } from '../../interfaces/dapp';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { IInviteController } from '../../interfaces/invite';
import { ExternalSignerControllers, IKeystoreController, Key, KeystoreSignerInterface } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { Platform } from '../../interfaces/platform';
import { IProvidersController } from '../../interfaces/provider';
import { SigningAuthRequirement } from '../../interfaces/signingAuth';
import { ISignMessageController, SignMessageStatus, SignMessageUpdateParams } from '../../interfaces/signMessage';
import { Message } from '../../interfaces/userRequest';
import { SignedMessage } from '../activity/types';
import HumanizationController from '../humanization/humanization';
import type { EIP712TypedData } from '@safe-global/types-kit';
import type { HardwareWalletSigningRequest } from '../../interfaces/signAccountOp';
import type { IrMessage } from '../../libs/humanizer/interfaces';
declare const STATUS_WRAPPED_METHODS: {
    readonly sign: "INITIAL";
};
export declare class SignMessageController extends HumanizationController implements ISignMessageController {
    #private;
    networks: INetworksController;
    signer?: KeystoreSignerInterface;
    isInitialized: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    dapp: {
        name: string;
        icon: string;
        url?: string;
        sessionId?: string;
    } | null;
    messageToSign: Message | null;
    humanizedMessage?: IrMessage;
    isHumanizing: boolean;
    safeEip712Data: unknown | null;
    hardwareWalletSigningRequest: HardwareWalletSigningRequest | null;
    signedMessage: SignedMessage | null;
    network?: Network;
    signed: string[];
    signatures: Hex[];
    signers?: {
        addr: Key['addr'];
        type: Key['type'];
    }[];
    /**
     * the signed hash
     */
    hash?: Hex;
    status: SignMessageStatus;
    constructor(keystore: IKeystoreController, providers: IProvidersController, networks: INetworksController, accounts: IAccountsController, externalSignerControllers: ExternalSignerControllers, invite: IInviteController, eventEmitterRegistry?: IEventEmitterRegistryController, dapps?: IDappsController, erc7730?: IErc7730Controller, platform?: Platform);
    init({ dapp, messageToSign, signed, hash, signatures }: {
        dapp?: {
            name: string;
            icon: string;
            url?: string;
            sessionId?: string;
        };
        messageToSign: Message;
        signed?: string[];
        hash?: Hex;
        signatures?: Hex[];
    }): Promise<void>;
    reset(): void;
    humanize(): void;
    update({ isAutoLoginEnabledByUser, autoLoginDuration }: SignMessageUpdateParams): void;
    setSigners(signers: {
        addr: Key['addr'];
        type: Key['type'];
    }[]): void;
    addMsgToSafeGlobal(sig: string, message: string | EIP712TypedData): Promise<void>;
    addSigToSafeGlobal(sig: string, hash: string): Promise<void>;
    sign(): Promise<void>;
    removeAccountData(address: Account['addr']): void;
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq(): void;
    get banners(): DappVerificationBanner[];
    /**
     * Whether auto-login can't be turned on for the requesting app, because the scam checker flags
     * it as unsafe. Clears as soon as the user trusts the app from the warning.
     */
    get isAutoLoginBlockedByScamChecker(): boolean;
    /**
     * Why this message needs the password/biometrics confirmation, or `null` when it does not. Only
     * a dapp the catalog knows can require it - elsewhere the confirmation cannot be remembered.
     * Mobile only. A Safe needs it only when its hot owners can meet the threshold on their own.
     */
    get signingAuthRequirement(): SigningAuthRequirement | null;
    toJSON(): this & {
        banners: DappVerificationBanner[];
        isAutoLoginBlockedByScamChecker: boolean;
        signingAuthRequirement: SigningAuthRequirement;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=signMessage.d.ts.map