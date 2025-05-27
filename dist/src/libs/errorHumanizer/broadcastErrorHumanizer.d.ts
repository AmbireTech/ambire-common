import { DecodedError } from '../errorDecoder/types';
/** The paymaster is down or the user is offline */
export declare const PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE = "Unable to connect to the paymaster. Please try again";
export declare function getHumanReadableBroadcastError(e: Error | DecodedError): Error;
//# sourceMappingURL=broadcastErrorHumanizer.d.ts.map