import { SiweMessage as SiweMessageType } from 'viem/siwe';
import { SiweMessage } from '@signinwithethereum/siwe';
import { IAccountsController } from '../../interfaces/account';
import { AutoLoginPolicy, AutoLoginSettings, AutoLoginStatus, DefaultAutoLoginPolicy, IAutoLoginController, SiweValidityStatus } from '../../interfaces/autoLogin';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IInviteController } from '../../interfaces/invite';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { PlainTextMessageUserRequest } from '../../interfaces/userRequest';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly revokePolicy: "INITIAL";
    readonly revokeAllPoliciesForDomain: "INITIAL";
};
export declare const AUTO_LOGIN_DURATION_OPTIONS: {
    label: string;
    value: number;
}[];
/**
 * The controller handles SIWE-like messages and provides auto-login functionality.
 * It creates and manages auto-login policies based on signed SIWE messages, and
 * automatically signs messages when auto-login is applicable.
 * In essence, it implements:
 * - ERC-4361: Sign-In with Ethereum (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-4361.md)
 * - ERC-8019: Auto-Login for SIWE (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-8019.md)
 */
export declare class AutoLoginController extends EventEmitter implements IAutoLoginController {
    #private;
    settings: AutoLoginSettings;
    initialLoadPromise?: Promise<void>;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(storage: IStorageController, keystore: IKeystoreController, providers: IProvidersController, networks: INetworksController, accounts: IAccountsController, externalSignerControllers: ExternalSignerControllers, invite: IInviteController, eventEmitterRegistry?: IEventEmitterRegistryController);
    static isExpiredPolicy(policy: AutoLoginPolicy): boolean;
    static convertSiweToViemFormat(parsedSiweMessage: SiweMessage): SiweMessageType;
    static getParsedSiweMessage(message: string | `0x${string}`, requestOrigin: string): null | {
        parsedSiwe: SiweMessageType;
        status: SiweValidityStatus;
    };
    static isPolicyMatchingDomainAndUri(parsedSiwe: SiweMessageType, policy: Pick<AutoLoginPolicy, 'domain' | 'uriPrefix'>): boolean;
    revokePolicy(accountAddress: string, policyDomain: string, policyUriPrefix: string): Promise<void>;
    revokeAllPoliciesForDomain(policyDomain: string, policyUriPrefix: string): Promise<void>;
    onSiweMessageSigned(parsedSiwe: SiweMessageType, isAutoLoginEnabledByUser: boolean, autoLoginDuration: number): Promise<AutoLoginPolicy | null>;
    getAutoLoginStatus(parsedSiwe: SiweMessageType): AutoLoginStatus;
    autoLogin(messageToSign: {
        accountAddr: string;
        chainId: bigint;
        message: PlainTextMessageUserRequest['meta']['params']['message'];
    }): Promise<import("../activity/types").SignedMessage>;
    getPolicyFromDefaultPolicy(defaultPolicy: DefaultAutoLoginPolicy): AutoLoginPolicy;
    getAccountPolicyForOrigin(accountAddr: string, origin: string, chainId?: number): AutoLoginPolicy | null;
    getAccountPolicies(accountAddr: string, withDefaultPolicies?: boolean): AutoLoginPolicy[];
}
//# sourceMappingURL=autoLogin.d.ts.map