"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.airdropsModule = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface([
    'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)'
]);
const WTC_TOKEN_ADDRESS = '0xeF4461891DfB3AC8572cCf7C794664A8DD927945';
const airdropsModule = (accountOp, currentIrCalls) => {
    const matcher = {
        [iface.getFunction('claimTokens').selector]: (call) => {
            if (call.to !== '0x4ee97a759AACa2EdF9c1445223b6Cd17c2eD3fb4')
                return call;
            const { amount } = iface.parseTransaction(call).args;
            const fullVisualization = [(0, utils_1.getAction)('Claim'), (0, utils_1.getToken)(WTC_TOKEN_ADDRESS, amount)];
            return { ...call, fullVisualization };
        }
    };
    return currentIrCalls.map((call) => matcher[call.data.slice(0, 10)] ? matcher[call.data.slice(0, 10)](call) : call);
};
exports.airdropsModule = airdropsModule;
//# sourceMappingURL=index.js.map