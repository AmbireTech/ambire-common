import { Message } from '../../../interfaces/userRequest';
import { AccountOp } from '../../accountOp/accountOp';
import { Call } from '../../accountOp/types';
import { Erc7730CalldataIndex, Erc7730CallDescriptors, Erc7730Descriptor, Erc7730Eip712Index, Erc7730Eip712IndexEntry, Erc7730Known, Erc7730Resolution, Erc7730ResolvedDescriptor, Erc7730Want } from './types';
/** How deep `includes` chains and nested calls are followed before giving up. */
export declare const ERC7730_MAX_RESOLUTION_DEPTH = 5;
export declare const validateCalldataIndex: (payload: unknown, path: string) => payload is Erc7730CalldataIndex;
export declare const validateEip712Index: (payload: unknown, path: string) => payload is Erc7730Eip712Index;
export declare const validateDescriptor: (payload: unknown, path: string) => payload is Erc7730Descriptor;
export declare const normalizeRelayerPath: (pathOrUrl: string) => string;
export declare const getAddressFromStorageSlot: (slotValue: string) => string | null;
/**
 * Picks the index entry matching a typed message. Entries without `encodeTypeHashes` match
 * anything; otherwise the message's own hash has to be among them. A message whose hash could not
 * be computed falls back to the sole entry, when there is exactly one.
 */
export declare const selectEip712IndexEntry: (entries: Erc7730Eip712IndexEntry[], encodeTypeHash: string | null) => Erc7730Eip712IndexEntry | null;
type Erc7730ResolveOptions = {
    /** Needed to format the call, which is how the calls embedded in it are found */
    accountAddr?: string;
};
/**
 * The descriptor for one call, plus the descriptors of every call embedded in it.
 *
 * This is the single traversal that both `planErc7730Wants` and `resolveErc7730Descriptors` read,
 * so the plan can never ask for something the resolve step does not use, or miss something it does.
 */
export declare const resolveErc7730Call: (call: Call, chainId: AccountOp["chainId"], known: Erc7730Known, 
/**
 * Whether an address with no descriptor of its own is worth a proxy-singleton lookup. Off for the
 * inner calls of a Safe transaction: they go to arbitrary contracts, and reading a singleton slot
 * off each one is an RPC round trip that almost never finds anything.
 */
followProxy?: boolean, options?: Erc7730ResolveOptions) => Erc7730Resolution;
/** What the controller still has to fetch before an accountOp can be fully described. */
export declare const planErc7730Wants: (accountOp: AccountOp, known: Erc7730Known) => Erc7730Want[];
/** The descriptor for each call that has one, given everything fetched so far. */
export declare const resolveErc7730Descriptors: (accountOp: AccountOp, known: Erc7730Known) => Erc7730CallDescriptors;
/** Everything one typed message needs, in the same plan/resolve shape as a call. */
export declare const resolveErc7730Message: (message: Message, known: Erc7730Known) => Erc7730Resolution;
export declare const planErc7730MessageWants: (message: Message, known: Erc7730Known) => Erc7730Want[];
export declare const resolveErc7730MessageDescriptor: (message: Message, known: Erc7730Known) => Erc7730ResolvedDescriptor | null;
export {};
//# sourceMappingURL=registry.d.ts.map