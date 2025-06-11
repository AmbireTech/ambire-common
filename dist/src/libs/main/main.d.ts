import { AccountOpAction, Action } from '../../controllers/actions/actions';
import { Account, AccountId } from '../../interfaces/account';
import { DappProviderRequest } from '../../interfaces/dapp';
import { Network } from '../../interfaces/network';
import { DappUserRequest, UserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export declare const batchCallsFromUserRequests: ({ accountAddr, chainId, userRequests }: {
    accountAddr: AccountId;
    chainId: bigint;
    userRequests: UserRequest[];
}) => Call[];
export declare const ACCOUNT_SWITCH_USER_REQUEST = "ACCOUNT_SWITCH_USER_REQUEST";
export declare const buildSwitchAccountUserRequest: ({ nextUserRequest, selectedAccountAddr, session, dappPromise }: {
    nextUserRequest: UserRequest;
    selectedAccountAddr: string;
    session?: DappProviderRequest["session"];
    dappPromise?: DappUserRequest["dappPromise"];
}) => UserRequest;
export declare const makeAccountOpAction: ({ account, chainId, nonce, actionsQueue, userRequests }: {
    account: Account;
    chainId: bigint;
    nonce: bigint | null;
    actionsQueue: Action[];
    userRequests: UserRequest[];
}) => AccountOpAction;
export declare const getAccountOpsForSimulation: (account: Account, visibleActionsQueue: Action[], networks: Network[]) => {
    [key: string]: AccountOp[];
} | undefined;
//# sourceMappingURL=main.d.ts.map