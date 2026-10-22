import { Message } from '../../../interfaces/userRequest';
import { Call } from '../../accountOp/types';
import { IrCall, IrMessage } from '../interfaces';
import { Erc7730ResolvedDescriptor } from './types';
export declare const humanizeCallWithErc7730: (call: Call, chainId: bigint, accountAddr: string, resolvedDescriptor: Erc7730ResolvedDescriptor, nativeAssetSymbol?: string, 
/**
 * Set only by the registry, which runs the formatting to find out which calls are embedded in
 * this one so it can fetch a descriptor for each of them.
 */
collectedNestedCalls?: Call[]) => IrCall | null;
export declare const humanizeMessageWithErc7730: (message: Message, resolvedDescriptor: Erc7730ResolvedDescriptor) => IrMessage | null;
export { buildSafeTxGasRefund } from './safeTxGasRefund';
export type { SafeTxGasRefund } from './safeTxGasRefund';
//# sourceMappingURL=humanize.d.ts.map