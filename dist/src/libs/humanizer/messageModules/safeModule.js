import { getAddress, isAddress } from 'ethers';
import { allowedMulticallContracts } from '../../../consts/safe';
import { getSafeHumanization } from '../modules/Safe';
import { genericErc20Humanizer } from '../modules/Tokens';
import { getAction, getAddressVisualization, getBreak, getLabel, getWarning } from '../utils';
export const safeMessageModule = (message) => {
    if (message.content.kind === 'message' || typeof message.content.message === 'string')
        return { fullVisualization: [] };
    if (message.content.primaryType !== 'SafeTx')
        return { fullVisualization: [] };
    const { to, value, data, operation } = message.content.message;
    const { accountAddr } = message;
    const { verifyingContract } = message.content.domain;
    const humanizedCalls = genericErc20Humanizer({ accountAddr }, [{ to, value, data }]);
    const safeStandardHumanization = getSafeHumanization(verifyingContract ?? undefined, to, value, data);
    const fullVisualization = [];
    if (!isAddress(verifyingContract))
        return {};
    fullVisualization.push(...[
        getAction('Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization(verifyingContract)
    ], ...(safeStandardHumanization && safeStandardHumanization.visuals
        ? [getBreak(), ...safeStandardHumanization.visuals]
        : []));
    if (humanizedCalls[0]?.fullVisualization) {
        fullVisualization.push(...humanizedCalls[0].fullVisualization);
    }
    if (operation === 1 &&
        (!to || !isAddress(to) || !allowedMulticallContracts.includes(getAddress(to)))) {
        return {
            fullVisualization,
            warnings: [
                getWarning('You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution', 'SAFE{WALLET}_DELEGATE_CALL')
            ]
        };
    }
    return {
        fullVisualization,
        warnings: safeStandardHumanization && safeStandardHumanization.warnings
            ? safeStandardHumanization.warnings
            : []
    };
};
//# sourceMappingURL=safeModule.js.map