"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContractImplementation = getContractImplementation;
exports.has7702 = has7702;
exports.getDelegatorName = getDelegatorName;
const deploy_1 = require("../../consts/deploy");
function getContractImplementation(chainId, accountKeys) {
    if (accountKeys.find((key) => key.type === 'lattice')) {
        return deploy_1.EIP_7702_GRID_PLUS;
    }
    return deploy_1.EIP_7702_AMBIRE_ACCOUNT;
}
function has7702(net) {
    return net.has7702;
}
function getDelegatorName(contract) {
    switch (contract.toLowerCase()) {
        case deploy_1.EIP_7702_AMBIRE_ACCOUNT.toLowerCase():
            return 'Ambire';
        case deploy_1.EIP_7702_GRID_PLUS.toLowerCase():
            return 'Ambire';
        case deploy_1.EIP_7702_METAMASK.toLowerCase():
            return 'Metamask';
        default:
            return '';
    }
}
//# sourceMappingURL=7702.js.map