import { DappProviderRequest } from '../../interfaces/dapp';
import { CallsUserRequest, SignUserRequest, SwitchAccountRequest, UserRequest } from '../../interfaces/userRequest';
export declare const dappRequestMethodToRequestKind: (method: DappProviderRequest["method"]) => "message" | "calls" | "typedMessage" | "unlock" | "dappConnect" | "walletAddEthereumChain" | "walletWatchAsset";
export declare const isSignRequest: (kind: UserRequest["kind"]) => kind is "message" | "calls" | "typedMessage" | "siwe" | "authorization-7702";
export declare const messageOnNewRequest: (request: UserRequest, addType: "queued" | "updated") => string;
export declare const getCallsUserRequestsByNetwork: (accountAddr: string, userRequests: UserRequest[]) => {
    [key: string]: CallsUserRequest[];
};
export declare const buildSwitchAccountUserRequest: ({ nextUserRequest, selectedAccountAddr, dappPromises }: {
    nextUserRequest: SignUserRequest;
    selectedAccountAddr: string;
    dappPromises: UserRequest["dappPromises"];
}) => SwitchAccountRequest;
export declare const sumTopUps: (userRequests: UserRequest[]) => bigint | undefined;
//# sourceMappingURL=requests.d.ts.map