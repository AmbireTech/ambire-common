"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransferLogTokens = getTransferLogTokens;
exports.getTransferLogNfts = getTransferLogNfts;
const ethers_1 = require("ethers");
const erc20TransferInterface = new ethers_1.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const erc721TransferInterface = new ethers_1.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
]);
async function getTransferLogTokens(logs, accountAddr) {
    const tokens = [];
    const accAddr = (0, ethers_1.getAddress)(accountAddr);
    logs.forEach((log) => {
        try {
            const parsed = erc20TransferInterface.parseLog({ topics: [...log.topics], data: log.data });
            if (!parsed)
                return;
            const from = (0, ethers_1.getAddress)(parsed.args.from);
            const to = (0, ethers_1.getAddress)(parsed.args.to);
            if (from !== accAddr && to !== accAddr)
                return;
            tokens.push(log.address);
        }
        catch {
            // it means it wasn't a transfer log
        }
    });
    return tokens;
}
/**
 * Returns the ERC-721 balance changes involving the account. ERC-721 Transfer
 * logs have the token ID in a fourth topic, unlike ERC-20 Transfer logs where
 * the amount is stored in the log data.
 */
async function getTransferLogNfts(logs, accountAddr) {
    const accAddr = (0, ethers_1.getAddress)(accountAddr);
    const balanceChangesByNft = new Map();
    logs.forEach((log) => {
        try {
            if (log.topics.length !== 4)
                return;
            const parsed = erc721TransferInterface.parseLog({ topics: [...log.topics], data: log.data });
            if (!parsed)
                return;
            const from = (0, ethers_1.getAddress)(parsed.args.from);
            const to = (0, ethers_1.getAddress)(parsed.args.to);
            if (from !== accAddr && to !== accAddr)
                return;
            const address = (0, ethers_1.getAddress)(log.address);
            const tokenId = parsed.args.tokenId;
            const key = `${address}:${tokenId.toString()}`;
            const previousChange = balanceChangesByNft.get(key)?.balanceChange || 0n;
            let balanceChange = previousChange;
            if (from === accAddr)
                balanceChange -= 1n;
            if (to === accAddr)
                balanceChange += 1n;
            balanceChangesByNft.set(key, { address, tokenId, balanceChange });
        }
        catch {
            // it means it wasn't an ERC-721 transfer log
        }
    });
    return Array.from(balanceChangesByNft.values()).filter(({ balanceChange }) => balanceChange !== 0n);
}
//# sourceMappingURL=parseLogs.js.map