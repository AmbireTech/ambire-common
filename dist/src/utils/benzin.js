import { isIdentifiedByRelayer, isIdentifiedByUserOpHash } from '../libs/accountOp/submittedAccountOp';
const getBenzinUrlParams = ({ chainId, txnId, identifiedBy, isInternal }) => {
    const userOpHash = identifiedBy && isIdentifiedByUserOpHash(identifiedBy) ? identifiedBy.identifier : undefined;
    const relayerId = identifiedBy && isIdentifiedByRelayer(identifiedBy) ? identifiedBy.identifier : undefined;
    return `?chainId=${String(chainId)}${txnId ? `&txnId=${txnId}` : ''}${userOpHash ? `&userOpHash=${userOpHash}` : ''}${relayerId ? `&relayerId=${relayerId}` : ''}${identifiedBy?.bundler ? `&bundler=${identifiedBy?.bundler}` : ''}${isInternal ? '&isInternal' : ''}`;
};
export { getBenzinUrlParams };
//# sourceMappingURL=benzin.js.map