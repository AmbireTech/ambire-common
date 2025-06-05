"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContractImplementation = getContractImplementation;
exports.has7702 = has7702;
exports.getDelegatorName = getDelegatorName;
const _7702_1 = require("../../consts/7702");
const deploy_1 = require("../../consts/deploy");
function getContractImplementation(chainId) {
    if (_7702_1.networks7702[chainId.toString()])
        return _7702_1.networks7702[chainId.toString()].implementation;
    return deploy_1.EIP_7702_AMBIRE_ACCOUNT;
}
function has7702(net) {
    return net.has7702 || !!_7702_1.networks7702[net.chainId.toString()];
}
function getDelegatorName(contract) {
    switch (contract.toLowerCase()) {
        case deploy_1.EIP_7702_AMBIRE_ACCOUNT.toLowerCase():
            return 'Ambire';
        case deploy_1.EIP_7702_METAMASK.toLowerCase():
            return 'Metamask';
        default:
            return '';
    }
}
//# sourceMappingURL=7702.js.map