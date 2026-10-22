import { AccountStates } from '../../interfaces/account';
import { DappProviderRequest } from '../../interfaces/dapp';
import { CallsUserRequest, SwitchAccountRequest, UserRequest, UserRequestWaitingAccountSwitch } from '../../interfaces/userRequest';
export declare const dappRequestMethodToRequestKind: (method: DappProviderRequest["method"]) => "message" | "calls" | "typedMessage" | "unlock" | "dappConnect" | "walletAddEthereumChain" | "walletWatchAsset";
export declare const isSignRequest: (kind: UserRequest["kind"]) => kind is "message" | "calls" | "typedMessage" | "authorization-7702" | "siwe";
export declare const messageOnNewRequest: (request: UserRequest, addType: "queued" | "updated") => string;
export declare const getCallsUserRequestsByNetwork: (accountAddr: string, userRequests: UserRequest[]) => {
    [key: string]: CallsUserRequest[];
};
export declare const buildSwitchAccountUserRequest: ({ nextUserRequest, selectedAccountAddr, dappPromises }: {
    nextUserRequest: UserRequestWaitingAccountSwitch;
    selectedAccountAddr: string;
    dappPromises: UserRequest["dappPromises"];
}) => SwitchAccountRequest;
export declare const sumTopUps: (userRequests: UserRequest[]) => bigint | undefined;
/**
 * True for a Safe transaction that at least one owner has already signed. Such a transaction
 * waits in the Safe queue for the other owners, so the wallet should open it only when the
 * user picks it.
 */
export declare const isSignedSafeCallsRequest: (request: UserRequest) => boolean;
export declare const isWaitingForSafeDeployment: (request: UserRequest, accountStates: AccountStates) => boolean;
//# sourceMappingURL=requests.d.ts.map