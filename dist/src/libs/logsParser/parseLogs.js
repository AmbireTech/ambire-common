"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransferLogTokens = getTransferLogTokens;
const ethers_1 = require("ethers");
async function getTransferLogTokens(logs, accountAddr) {
    const abi = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
    const iface = new ethers_1.Interface(abi);
    const tokens = [];
    const accAddr = (0, ethers_1.getAddress)(accountAddr);
    logs.forEach((log) => {
        try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (!parsed)
                return;
            const from = (0, ethers_1.getAddress)(parsed.args.from);
            const to = (0, ethers_1.getAddress)(parsed.args.to);
            if (from !== accAddr && to !== accAddr)
                return;
            tokens.push(log.address);
        }
        catch (e) {
            // it means it wasn't a transfer log
        }
    });
    return tokens;
}
//# sourceMappingURL=parseLogs.js.map