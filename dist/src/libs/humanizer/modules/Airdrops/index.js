"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.airdropsModule = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("../../../../consts/addresses");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface([
    'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)',
    'function claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof)'
]);
const MERKLE_DISTRIBUTOR_S1 = '0x71Cfc1Be4AEE4941C58ceF02069f19eE291C0aC3';
const distributors = {
    [MERKLE_DISTRIBUTOR_S1]: addresses_1.STK_WALLET
};
const WTC_TOKEN_ADDRESS = '0xeF4461891DfB3AC8572cCf7C794664A8DD927945';
const airdropsModule = (accountOp, currentIrCalls) => {
    const matcher = {
        [iface.getFunction('claimTokens').selector]: (call) => {
            if (call.to !== '0x4ee97a759AACa2EdF9c1445223b6Cd17c2eD3fb4')
                return call;
            const { amount } = iface.parseTransaction(call).args;
            const fullVisualization = [(0, utils_1.getAction)('Claim'), (0, utils_1.getToken)(WTC_TOKEN_ADDRESS, amount)];
            return { ...call, fullVisualization };
        },
        [iface.getFunction('claim')?.selector]: (call) => {
            const { amount } = iface.parseTransaction(call).args;
            if (!call.to)
                return call;
            if (!distributors[call.to])
                return call;
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim'), (0, utils_1.getToken)(addresses_1.STK_WALLET, amount)] };
        }
    };
    return currentIrCalls.map((call) => {
        const selectedParser = matcher[call.data.slice(0, 10)];
        if (!selectedParser)
            return call;
        return selectedParser(call);
    });
};
exports.airdropsModule = airdropsModule;
//# sourceMappingURL=index.js.map