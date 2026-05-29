import { aaveLendingPoolV2 } from './aaveLendingPoolV2';
import { aaveV3Pool } from './aaveV3';
import { aaveWethGatewayV2 } from './aaveWethGatewayV2';
const matcher = {
    ...aaveLendingPoolV2(),
    ...aaveWethGatewayV2(),
    ...aaveV3Pool()
};
export const aaveHumanizer = (accountOp, irCalls) => {
    const newCalls = irCalls.map((call) => {
        const sigHash = call.data.slice(0, 10);
        if (!call.to)
            return call;
        return matcher[sigHash]
            ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
            : call;
    });
    return newCalls;
};
//# sourceMappingURL=index.js.map