import { UserRequest } from '../interfaces/userRequest';
/**
 * How many calls are waiting in the batch. Requests that are not part of the batch are left out:
 * Safe transactions that are already signed, and speed ups, which are requests of their own
 */
declare const getCallsCount: (userRequests: UserRequest[]) => number;
export { getCallsCount };
//# sourceMappingURL=userRequest.d.ts.map