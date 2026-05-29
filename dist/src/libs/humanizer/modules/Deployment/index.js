import { getAction } from '../../utils';
export const deploymentModule = (_, irCalls
// humanizerMeta: HumanizerMeta
) => {
    const newCalls = irCalls.map((irCall) => irCall.to === undefined
        ? {
            ...irCall,
            fullVisualization: [getAction('Deploy a smart contract')]
        }
        : irCall);
    return newCalls;
};
//# sourceMappingURL=index.js.map