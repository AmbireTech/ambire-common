import { type Hex } from 'viem';
import { AccountOp } from '../../../accountOp/accountOp';
import { HumanizerVisualization } from '../../interfaces';
import { HexIrCall } from '../../utils';
import { HumanizerUniMatcher } from './interfaces';
export declare const humanizeUniversalRouterCommands: (commands: Hex, inputs: readonly Hex[], deadline: bigint, accountOp: AccountOp, call: HexIrCall) => HumanizerVisualization[];
export declare const uniUniversalRouter: HumanizerUniMatcher;
//# sourceMappingURL=uniUniversalRouter.d.ts.map