"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privilegeHumanizer = void 0;
const viem_1 = require("viem");
const deploy_1 = require("../../../../consts/deploy");
const utils_1 = require("../../utils");
const setAddrPrivilegeAbi = (0, viem_1.parseAbi)([
    'function setAddrPrivilege(address addr, bytes32 priv) payable'
]);
const parsePrivilegeCall = (humanizerMeta, call) => {
    const { args } = (0, viem_1.decodeFunctionData)({ abi: setAddrPrivilegeAbi, data: call.data });
    const [addr, priv] = args;
    if ((0, utils_1.getKnownName)(humanizerMeta, addr)?.includes('entry point') && priv === deploy_1.ENTRY_POINT_MARKER)
        return [(0, utils_1.getAction)('Enable'), (0, utils_1.getAddressVisualization)(addr)];
    if (priv === viem_1.zeroHash)
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
const setAddrPrivilegeSelector = (0, viem_1.toFunctionSelector)(setAddrPrivilegeAbi[0]);
const privilegeHumanizer = (accountOp, call, humanizerMeta) => {
    // humanizerMeta should be always provided
    if (!humanizerMeta)
        return call;
    if ((0, utils_1.isHexCall)(call) && call.data.slice(0, 10) === setAddrPrivilegeSelector) {
        return {
            ...call,
            fullVisualization: parsePrivilegeCall(humanizerMeta, call)
        };
    }
    return call;
};
exports.privilegeHumanizer = privilegeHumanizer;
//# sourceMappingURL=privileges.js.map