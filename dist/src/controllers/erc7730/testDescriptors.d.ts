import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { Erc7730CallDescriptors, Erc7730ResolvedDescriptor } from '../../libs/humanizer/erc7730/types';
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
/** Runtime code of a real SafeProxy v1.4.1, so a mocked provider looks like a deployed Safe.
 * The proxy version is fixed here on purpose: its keccak256 must match a hash in
 * KNOWN_SAFE_PROXY_CODE_HASHES (consts/safe.ts) for the Safe singleton lookup to follow it. */
export declare const SAFE_PROXY_V1_4_1_RUNTIME_CODE = "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033";
/**
 * The errors the test controller reported for this relayer mock. Descriptor lookups never throw -
 * a failure degrades to the built-in humanization - so this is how a test asserts that a bad
 * response was actually reported rather than silently swallowed.
 */
export declare const getTestErc7730Errors: (callRelayer: BindedRelayerCall) => import("../../interfaces/eventEmitter").ErrorRef[];
export declare const getTestErc7730Descriptors: (accountOp: AccountOp, callRelayer: BindedRelayerCall, provider?: any) => Promise<Erc7730CallDescriptors>;
/** A single call, wrapped as a one-call accountOp. */
export declare const getTestErc7730DescriptorForCall: (call: AccountOp["calls"][number], chainId: bigint, callRelayer: BindedRelayerCall, provider?: any) => Promise<Erc7730ResolvedDescriptor | null>;
export declare const getTestErc7730MessageDescriptor: (message: Message, callRelayer: BindedRelayerCall, provider?: any) => Promise<Erc7730ResolvedDescriptor | null>;
//# sourceMappingURL=testDescriptors.d.ts.map