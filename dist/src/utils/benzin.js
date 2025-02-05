"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBenzinUrlParams = void 0;
const submittedAccountOp_1 = require("../libs/accountOp/submittedAccountOp");
const getBenzinUrlParams = ({ chainId, txnId, identifiedBy, isInternal }) => {
    const userOpHash = identifiedBy && (0, submittedAccountOp_1.isIdentifiedByUserOpHash)(identifiedBy) ? identifiedBy.identifier : undefined;
    const relayerId = identifiedBy && (0, submittedAccountOp_1.isIdentifiedByRelayer)(identifiedBy) ? identifiedBy.identifier : undefined;
    return `?chainId=${String(chainId)}${txnId ? `&txnId=${txnId}` : ''}${userOpHash ? `&userOpHash=${userOpHash}` : ''}${relayerId ? `&relayerId=${relayerId}` : ''}${identifiedBy?.bundler ? `&bundler=${identifiedBy?.bundler}` : ''}${isInternal ? '&isInternal' : ''}`;
};
exports.getBenzinUrlParams = getBenzinUrlParams;
//# sourceMappingURL=benzin.js.map