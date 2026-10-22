"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.airdropsModule = void 0;
const viem_1 = require("viem");
const addresses_1 = require("../../../../consts/addresses");
const utils_1 = require("../../utils");
const claimTokensAbi = (0, viem_1.parseAbi)([
    'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)'
]);
const claimAbi = (0, viem_1.parseAbi)([
    'function claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof)'
]);
const MERKLE_DISTRIBUTOR_S1 = '0x71Cfc1Be4AEE4941C58ceF02069f19eE291C0aC3';
const distributors = {
    [MERKLE_DISTRIBUTOR_S1]: addresses_1.STK_WALLET
};
const WTC_TOKEN_ADDRESS = '0xeF4461891DfB3AC8572cCf7C794664A8DD927945';
const claimTokensSelector = (0, viem_1.toFunctionSelector)(claimTokensAbi[0]);
const claimSelector = (0, viem_1.toFunctionSelector)(claimAbi[0]);
const airdropsModule = (accountOp, call) => {
    const matcher = {
        [claimTokensSelector]: (call) => {
            if (call.to !== '0x4ee97a759AACa2EdF9c1445223b6Cd17c2eD3fb4')
                return call;
            const { args } = (0, viem_1.decodeFunctionData)({ abi: claimTokensAbi, data: call.data });
            const [, amount] = args;
            const fullVisualization = [(0, utils_1.getAction)('Claim'), (0, utils_1.getToken)(WTC_TOKEN_ADDRESS, amount)];
            return { ...call, fullVisualization };
        },
        [claimSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: claimAbi, data: call.data });
            const [, , amount] = args;
            if (!call.to)
                return call;
            if (!distributors[call.to])
                return call;
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim'), (0, utils_1.getToken)(addresses_1.STK_WALLET, amount)] };
        }
    };
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const selectedParser = matcher[call.data.slice(0, 10)];
    if (!selectedParser)
        return call;
    return selectedParser(call);
};
exports.airdropsModule = airdropsModule;
//# sourceMappingURL=index.js.map