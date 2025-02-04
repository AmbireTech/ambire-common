import { PERMIT_2_ADDRESS } from '../../../consts/addresses';
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils';
const visualizePermit = (permit) => {
    return [
        getAction('Permit'),
        getAddressVisualization(PERMIT_2_ADDRESS),
        getLabel('to use'),
        getToken(permit.token, permit.amount),
        getLabel('for time period'),
        getDeadline(permit.expiration)
    ];
};
export const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    const visualizations = [];
    if (tm?.domain?.verifyingContract &&
        tm.domain.verifyingContract.toLowerCase() === PERMIT_2_ADDRESS.toLowerCase()) {
        if (tm?.types?.PermitSingle?.[0]?.type === 'PermitDetails') {
            visualizations.push(...visualizePermit(tm.message.details), getLabel('this whole signatuere'), getDeadline(tm.message.sigDeadline));
        }
        else if (tm?.types?.PermitBatch?.[0]?.type === 'PermitDetails[]') {
            tm.message.details.forEach((permitDetails, i) => {
                visualizations.push(...[
                    getLabel(`Permit #${i + 1}`),
                    ...visualizePermit(permitDetails),
                    getLabel('this whole signatuere'),
                    getDeadline(tm.message.sigDeadline)
                ]);
            });
        }
        return { fullVisualization: visualizations };
    }
    return { fullVisualization: [] };
};
//# sourceMappingURL=permit2Module.js.map