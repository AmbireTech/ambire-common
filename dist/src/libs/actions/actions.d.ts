import { AccountOpAction, Action } from '../../controllers/actions/actions';
import { DappProviderRequest } from '../../interfaces/dapp';
export declare const dappRequestMethodToActionKind: (method: DappProviderRequest["method"]) => string;
export declare const getAccountOpActionsByNetwork: (accountAddr: string, actions: Action[]) => {
    [key: string]: AccountOpAction[];
};
export declare const getAccountOpFromAction: (accountOpActionId: AccountOpAction["id"], actions: Action[]) => import("../accountOp/accountOp").AccountOp | undefined;
export declare const messageOnNewAction: (action: Action, addType: "queued" | "updated") => string | null;
//# sourceMappingURL=actions.d.ts.map