import { Message } from '../../../interfaces/userRequest';
import { Call } from '../../accountOp/types';
export declare const isPlainObject: (value: unknown) => value is Record<string, unknown>;
export declare const isHexChar: (value: string) => boolean;
export declare const isHexOfLength: (value: string, hexLength: number) => boolean;
export declare const parseIntegerLiteral: (value: string) => number | null;
export declare const getSafeTxCallsFromMessage: (message: Message) => Call[] | null;
/** The key a descriptor is registered under, both in the relayer index and in the resolved maps */
export declare const getRegistryKey: (chainId: bigint | number | string, address: string) => string;
/**
 * The key a Safe proxy's implementation is recorded under. Shared with the controller that answers
 * the lookup, so the two can't drift into writing and reading different keys.
 */
export declare const getSafeSingletonKey: (chainId: bigint, address: string) => string;
//# sourceMappingURL=utils.d.ts.map