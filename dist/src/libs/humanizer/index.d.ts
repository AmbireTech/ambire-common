import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { humanizerCallModules } from './callModules';
import { Erc7730CallDescriptors, Erc7730ResolvedDescriptor } from './erc7730';
import { IrCall, IrMessage } from './interfaces';
type HumanizeAccountOpOptions = {
    erc7730Descriptors?: Erc7730CallDescriptors;
    nativeAssetSymbol?: string;
};
type HumanizeMessageOptions = {
    erc7730Descriptor?: Erc7730ResolvedDescriptor;
};
declare const humanizeAccountOp: (_accountOp: AccountOp, options?: HumanizeAccountOpOptions) => IrCall[];
declare const humanizeMessage: (_message: Message, options?: HumanizeMessageOptions) => IrMessage;
export * from './erc7730';
export { humanizeAccountOp, humanizeMessage, humanizerCallModules };
export type { HumanizeAccountOpOptions, HumanizeMessageOptions };
//# sourceMappingURL=index.d.ts.map