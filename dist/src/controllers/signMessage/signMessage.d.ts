import { Account } from '../../interfaces/account';
import { ExternalSignerControllers, Key } from '../../interfaces/keystore';
import { Message } from '../../interfaces/userRequest';
import { AccountsController } from '../accounts/accounts';
import { SignedMessage } from '../activity/activity';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
declare const STATUS_WRAPPED_METHODS: {
    readonly sign: "INITIAL";
};
export declare class SignMessageController extends EventEmitter {
    #private;
    isInitialized: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    dapp: {
        name: string;
        icon: string;
    } | null;
    messageToSign: Message | null;
    signingKeyAddr: Key['addr'] | null;
    signingKeyType: Key['type'] | null;
    signedMessage: SignedMessage | null;
    constructor(keystore: KeystoreController, providers: ProvidersController, networks: NetworksController, accounts: AccountsController, externalSignerControllers: ExternalSignerControllers);
    init({ dapp, messageToSign }: {
        dapp?: {
            name: string;
            icon: string;
        };
        messageToSign: Message;
    }): Promise<void>;
    reset(): void;
    setSigningKey(signingKeyAddr: Key['addr'], signingKeyType: Key['type']): void;
    sign(): Promise<void>;
    removeAccountData(address: Account['addr']): void;
}
export {};
//# sourceMappingURL=signMessage.d.ts.map