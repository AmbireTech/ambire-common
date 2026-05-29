import { EIP712TypedData } from '@safe-global/types-kit';
import { Account, IAccountsController } from '../../interfaces/account';
import { DappVerificationBanner, IDappsController } from '../../interfaces/dapp';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { IInviteController } from '../../interfaces/invite';
import { ExternalSignerControllers, IKeystoreController, Key, KeystoreSignerInterface } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { ISignMessageController, SignMessageStatus, SignMessageUpdateParams } from '../../interfaces/signMessage';
import { Message } from '../../interfaces/userRequest';
import { SignedMessage } from '../activity/types';
import EventEmitter from '../eventEmitter/eventEmitter';
declare const STATUS_WRAPPED_METHODS: {
    readonly sign: "INITIAL";
};
export declare class SignMessageController extends EventEmitter implements ISignMessageController {
    #private;
    networks: INetworksController;
    signer?: KeystoreSignerInterface;
    isInitialized: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    dapp: {
        name: string;
        icon: string;
        url?: string;
    } | null;
    messageToSign: Message | null;
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
    constructor(keystore: IKeystoreController, providers: IProvidersController, networks: INetworksController, accounts: IAccountsController, externalSignerControllers: ExternalSignerControllers, invite: IInviteController, eventEmitterRegistry?: IEventEmitterRegistryController, dapps?: IDappsController);
    init({ dapp, messageToSign, signed, hash, signatures }: {
        dapp?: {
            name: string;
            icon: string;
            url?: string;
        };
        messageToSign: Message;
        signed?: string[];
        hash?: Hex;
        signatures?: Hex[];
    }): Promise<void>;
    reset(): void;
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
    toJSON(): this & {
        banners: DappVerificationBanner[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=signMessage.d.ts.map