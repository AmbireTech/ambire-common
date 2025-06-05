"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privilegeHumanizer = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../../../contracts/compiled/AmbireAccount.json"));
const deploy_1 = require("../../../../consts/deploy");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
const parsePrivilegeCall = (humanizerMeta, call) => {
    const { addr, priv } = iface.parseTransaction(call).args;
    if ((0, utils_1.getKnownName)(humanizerMeta, addr)?.includes('entry point') && priv === deploy_1.ENTRY_POINT_MARKER)
        return [(0, utils_1.getAction)('Enable'), (0, utils_1.getAddressVisualization)(addr)];
    if (priv === ethers_1.ZeroHash)
        return [(0, utils_1.getAction)('Revoke access'), (0, utils_1.getLabel)('of'), (0, utils_1.getAddressVisualization)(addr)];
    return [
        (0, utils_1.getAction)('Update access status'),
        (0, utils_1.getLabel)('of'),
        (0, utils_1.getAddressVisualization)(addr),
        (0, utils_1.getLabel)('to'),
        priv === '0x0000000000000000000000000000000000000000000000000000000000000001'
            ? (0, utils_1.getLabel)('regular access')
            : (0, utils_1.getLabel)(priv)
    ];
};
const privilegeHumanizer = (accountOp, irCalls, humanizerMeta) => {
    const newCalls = irCalls.map((call) => {
        if (call.data.slice(0, 10) === iface.getFunction('setAddrPrivilege')?.selector) {
            return {
                ...call,
                fullVisualization: parsePrivilegeCall(humanizerMeta, call)
            };
        }
        return call;
    });
    return newCalls;
};
exports.privilegeHumanizer = privilegeHumanizer;
//# sourceMappingURL=privileges.js.map