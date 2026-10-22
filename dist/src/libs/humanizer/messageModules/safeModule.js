"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeMessageModule = void 0;
const ethers_1 = require("ethers");
const Safe_1 = require("../modules/Safe");
const Tokens_1 = require("../modules/Tokens");
const utils_1 = require("../utils");
const safeMessageModule = (message) => {
    if (message.content.kind === 'message' || typeof message.content.message === 'string')
        return { fullVisualization: [] };
    if (message.content.primaryType !== 'SafeTx')
        return { fullVisualization: [] };
    const { to, value, data, operation, nonce } = message.content.message;
    const { accountAddr } = message;
    const { verifyingContract } = message.content.domain;
    const humanizedCall = (0, Tokens_1.genericErc20Humanizer)({ accountAddr }, { to, value, data });
    const safeStandardHumanization = (0, Safe_1.getSafeHumanization)(verifyingContract ?? undefined, to, value, data, 0, nonce);
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
    if (humanizedCall.fullVisualization) {
        fullVisualization.push(...humanizedCall.fullVisualization);
    }
    const delegateCallWarnings = operation !== undefined ? (0, Safe_1.getDelegateCallWarning)(operation, to) : [];
    if (delegateCallWarnings.length) {
        return {
            fullVisualization,
            warnings: delegateCallWarnings
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