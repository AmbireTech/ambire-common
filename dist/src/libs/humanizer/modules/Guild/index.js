"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const Guild_1 = require("../../const/abis/Guild");
const utils_1 = require("../../utils");
const GuildModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(Guild_1.Guild);
    const matcher = {
        [iface.getFunction('claim((address receiver, uint8 guildAction, uint256 userId, uint256 guildId, string guildName, uint256 createdAt) pinData, address adminTreasury, uint256 adminFee, uint256 signedAt, string cid, bytes signature)')?.selector]: (call) => {
            const { pinData: { 
            // receiver,
            // guildAction,
            // userId,
            // guildId,
            guildName
            // createdAt
             }
            // adminTreasury,
            // adminFee,
            // signedAt,
            // cid,
            // signature
             } = iface.parseTransaction(call).args;
            // if (receiver === accOp.accountAddr)
            return [(0, utils_1.getAction)('Claim Guild badge'), (0, utils_1.getLabel)('for'), (0, utils_1.getLabel)(guildName, true)];
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
exports.default = GuildModule;
//# sourceMappingURL=index.js.map