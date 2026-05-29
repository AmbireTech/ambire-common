import { Interface } from 'ethers';
import { Guild } from '../../const/abis/Guild';
import { getAction, getLabel } from '../../utils';
const iface = new Interface(Guild);
const GuildModule = (accOp, calls) => {
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
            return [getAction('Claim Guild badge'), getLabel('for'), getLabel(guildName, true)];
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
export default GuildModule;
//# sourceMappingURL=index.js.map