/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers';
import WALLETSupplyControllerABI from '../../../../../contracts/compiled/WALLETSupplyController.json';
import { getAction, getLabel } from '../../utils';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETSupplyControllerMapping = () => {
    const iface = new Interface(WALLETSupplyControllerABI);
    return {
        [iface.getFunction('claim')?.selector]: (call) => {
            const { toBurnBps } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [getAction('Claim rewards'), getLabel(`with ${burnPercentage}% burn`)]
                : [getAction('Claim rewards')];
        },
        [iface.getFunction('claimWithRootUpdate')?.selector]: (call) => {
            const { toBurnBps } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [getAction('Claim rewards'), getLabel(`with ${burnPercentage}% burn`)]
                : [getAction('Claim rewards')];
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        [iface.getFunction('mintVesting')?.selector]: () => {
            return [getAction('Claim vested tokens')];
        }
    };
};
//# sourceMappingURL=WALLETSupplyController.js.map