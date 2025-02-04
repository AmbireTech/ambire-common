import { Storage } from '../../interfaces/storage';
import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { HumanizerCallModule, HumanizerOptions, IrCall, IrMessage } from './interfaces';
export declare const humanizerCallModules: HumanizerCallModule[];
declare const humanizeAccountOp: (_accountOp: AccountOp, options: HumanizerOptions) => IrCall[];
declare const humanizeMessage: (_message: Message) => IrMessage;
declare function clearHumanizerMetaObjectFromStorage(storage: Storage): Promise<void>;
export { humanizeAccountOp, humanizeMessage, clearHumanizerMetaObjectFromStorage };
//# sourceMappingURL=index.d.ts.map