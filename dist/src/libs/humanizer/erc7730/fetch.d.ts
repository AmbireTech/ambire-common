import { BindedRelayerCall } from '../../relayerCall/relayerCall';
/**
 * Fetch and validate the resource from the relayer.
 * We have this wrapper mainly because of the validate method
 */
export declare const fetchRelayerResource: <T>(path: string, method: string, callRelayer: BindedRelayerCall, validate: (payload: unknown, path: string) => payload is T, body?: any) => Promise<T>;
//# sourceMappingURL=fetch.d.ts.map