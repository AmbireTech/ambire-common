import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { HumanizerCallModule, IrCall, IrMessage } from './interfaces';
export declare const humanizerCallModules: HumanizerCallModule[];
declare const humanizeAccountOp: (_accountOp: AccountOp) => IrCall[];
declare const humanizeMessage: (_message: Message) => IrMessage;
export { humanizeAccountOp, humanizeMessage };
//# sourceMappingURL=index.d.ts.map