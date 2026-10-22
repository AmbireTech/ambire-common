"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const claimAbi = (0, viem_1.parseAbi)([
    'function claim((address receiver, uint8 guildAction, uint256 userId, uint256 guildId, string guildName, uint256 createdAt) pinData, address adminTreasury, uint256 adminFee, uint256 signedAt, string cid, bytes signature) payable'
]);
const claimSelector = (0, viem_1.toFunctionSelector)(claimAbi[0]);
const GuildModule = (accOp, call) => {
    const matcher = {
        [claimSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: claimAbi, data: call.data });
            const [pinData] = args;
            return [(0, utils_1.getAction)('Claim Guild badge'), (0, utils_1.getLabel)('for'), (0, utils_1.getLabel)(pinData.guildName, true)];
        }
    };
    const match = matcher[call.data.slice(0, 10)];
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !match)
        return call;
    return { ...call, fullVisualization: match(call) };
};
exports.default = GuildModule;
//# sourceMappingURL=index.js.map