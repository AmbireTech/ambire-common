import { AccountOp } from '../accountOp/accountOp';
import { HumanizerCallModule, IrCall } from './interfaces';
export declare const humanizerCallModules: HumanizerCallModule[];
/**
 * Describes one call with the humanizer modules - the humanization every call gets when no ERC-7730
 * descriptor covers it.
 *
 * The modules run in order, each seeing what the previous one produced, so the least generic module
 * that matches has the final say. A module that throws is skipped and the call keeps the description
 * it already had, because one broken decoder must not lose the whole call.
 *
 * This is the single entry point for it: a nested call decoded inside an ERC-7730 descriptor is
 * described by exactly the same modules, in the same order, as a top-level one.
 */
export declare const humanizeCallWithModules: (accountOp: AccountOp, call: IrCall) => IrCall;
//# sourceMappingURL=callModules.d.ts.map