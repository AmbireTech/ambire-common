import { CallsUserRequest } from '../../interfaces/userRequest';
export declare const ACCOUNT_SWITCH_USER_REQUEST = "ACCOUNT_SWITCH_USER_REQUEST";
/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
export declare const getShouldSimulateInTheBackground: (currentReq: CallsUserRequest, callUserRequests: CallsUserRequest[]) => boolean;
//# sourceMappingURL=main.d.ts.map