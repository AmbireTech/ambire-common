import { AccountOpAction, Action } from '../../controllers/actions/actions';
import { Account, AccountId } from '../../interfaces/account';
import { DappProviderRequest } from '../../interfaces/dapp';
import { Network, NetworkId } from '../../interfaces/network';
import { DappUserRequest, UserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export declare const batchCallsFromUserRequests: ({ accountAddr, networkId, userRequests }: {
    accountAddr: AccountId;
    networkId: NetworkId;
    userRequests: UserRequest[];
}) => Call[];
export declare const ACCOUNT_SWITCH_USER_REQUEST = "ACCOUNT_SWITCH_USER_REQUEST";
export declare const buildSwitchAccountUserRequest: ({ nextUserRequest, selectedAccountAddr, networkId, session, dappPromise }: {
    nextUserRequest: UserRequest;
    selectedAccountAddr: string;
    networkId: Network['id'];
    session: DappProviderRequest['session'];
    dappPromise: DappUserRequest['dappPromise'];
}) => UserRequest;
export declare const makeSmartAccountOpAction: ({ account, networkId, nonce, actionsQueue, userRequests, entryPointAuthorizationSignature }: {
    account: Account;
    networkId: string;
    nonce: bigint | null;
    actionsQueue: Action[];
    userRequests: UserRequest[];
    entryPointAuthorizationSignature?: string | undefined;
}) => AccountOpAction;
export declare const makeBasicAccountOpAction: ({ account, networkId, nonce, userRequest }: {
    account: Account;
    networkId: string;
    nonce: bigint | null;
    userRequest: UserRequest;
}) => AccountOpAction;
export declare const getAccountOpsForSimulation: (account: Account, visibleActionsQueue: Action[], network?: Network, op?: AccountOp | null) => {
    [key: string]: AccountOp[];
};
//# sourceMappingURL=main.d.ts.map