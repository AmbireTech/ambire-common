import { DecodedError } from '../errorDecoder/types';
export declare const PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE = "Currently, the paymaster seems to be down and your transaction cannot be broadcast. Please try again in a few moments or pay the fee with a Basic Account if the error persists";
export declare function getHumanReadableBroadcastError(e: Error | DecodedError): Error;
//# sourceMappingURL=broadcastErrorHumanizer.d.ts.map