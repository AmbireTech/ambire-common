"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeMessageModule = void 0;
const ethers_1 = require("ethers");
const safe_1 = require("../../../consts/safe");
const Safe_1 = require("../modules/Safe");
const Tokens_1 = require("../modules/Tokens");
const utils_1 = require("../utils");
const safeMessageModule = (message) => {
    if (message.content.kind === 'message' || typeof message.content.message === 'string')
        return { fullVisualization: [] };
    if (message.content.primaryType !== 'SafeTx')
        return { fullVisualization: [] };
    const { to, value, data, operation } = message.content.message;
    const { accountAddr } = message;
    const { verifyingContract } = message.content.domain;
    const humanizedCalls = (0, Tokens_1.genericErc20Humanizer)({ accountAddr }, [{ to, value, data }]);
    const safeStandardHumanization = (0, Safe_1.getSafeHumanization)(verifyingContract ?? undefined, to, value, data);
    const fullVisualization = [];
    if (!(0, ethers_1.isAddress)(verifyingContract))
        return {};
    fullVisualization.push(...[
        (0, utils_1.getAction)('Safe{WALLET} transaction'),
        (0, utils_1.getLabel)('from'),
        (0, utils_1.getAddressVisualization)(verifyingContract)
    ], ...(safeStandardHumanization && safeStandardHumanization.visuals
        ? [(0, utils_1.getBreak)(), ...safeStandardHumanization.visuals]
        : []));
    if (humanizedCalls[0]?.fullVisualization) {
        fullVisualization.push(...humanizedCalls[0].fullVisualization);
    }
    if (operation === 1 &&
        (!to || !(0, ethers_1.isAddress)(to) || !safe_1.allowedMulticallContracts.includes((0, ethers_1.getAddress)(to)))) {
        return {
            fullVisualization,
            warnings: [
                (0, utils_1.getWarning)('You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution', 'SAFE{WALLET}_DELEGATE_CALL')
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
exports.safeMessageModule = safeMessageModule;
//# sourceMappingURL=safeModule.js.map