import { aaveLendingPoolV2 } from './aaveLendingPoolV2';
import { aaveV3Pool } from './aaveV3';
import { aaveWethGatewayV2 } from './aaveWethGatewayV2';
export const aaveHumanizer = (accountOp, irCalls) => {
    const matcher = {
        ...aaveLendingPoolV2(),
        ...aaveWethGatewayV2(),
        ...aaveV3Pool()
    };
    const newCalls = irCalls.map((call) => {
        const sigHash = call.data.slice(0, 10);
        return matcher[sigHash]
            ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
            : call;
    });
    return newCalls;
};
//# sourceMappingURL=index.js.map