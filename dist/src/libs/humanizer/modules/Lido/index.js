"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LidoModule = void 0;
const ethers_1 = require("ethers");
const Lido_1 = require("../../const/abis/Lido");
const utils_1 = require("../../utils");
const WRAPPED_ST_ETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const ST_ETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const UNWRAP_CONTRACT_ADDR = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';
const wrapIface = new ethers_1.Interface(Lido_1.WrappedStETH);
const unwrapIface = new ethers_1.Interface(Lido_1.unstETH);
const LidoModule = (accOp, calls) => {
    const newCalls = calls.map((call) => {
        if ((0, ethers_1.isAddress)(call.to) && (0, ethers_1.getAddress)(call.to) === WRAPPED_ST_ETH_ADDRESS) {
            if (call.data.startsWith(wrapIface.getFunction('wrap(uint256)').selector)) {
                const [amount] = wrapIface.parseTransaction(call).args;
                const fullVisualization = [(0, utils_1.getAction)('Wrap'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
                return { ...call, fullVisualization };
            }
            if (call.data.startsWith(wrapIface.getFunction('unwrap(uint256)').selector)) {
                const [amount] = wrapIface.parseTransaction(call).args;
                const fullVisualization = [(0, utils_1.getAction)('Unwrap'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
                return { ...call, fullVisualization };
            }
        }
        if ((0, ethers_1.isAddress)(call.to) && (0, ethers_1.getAddress)(call.to) === UNWRAP_CONTRACT_ADDR) {
            if (call.data.startsWith(unwrapIface.getFunction('requestWithdrawals').selector)) {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                const { _amounts, _owner } = unwrapIface.parseTransaction(call).args;
                const amount = _amounts.reduce((acc, cur) => acc + cur, 0n);
                const fullVisualization = [(0, utils_1.getAction)('Request withdraw'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
                if (![ethers_1.ZeroAddress, accOp.accountAddr.toLowerCase()].includes(_owner.toLowerCase()))
                    fullVisualization.push((0, utils_1.getLabel)('and authorize'), (0, utils_1.getAddressVisualization)(_owner));
                return { ...call, fullVisualization };
            }
            if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawals').selector)) {
                return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawals')] };
            }
            if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawal').selector)) {
                return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawal')] };
            }
            if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawalsTo').selector)) {
                // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
                const { _requestIds, _hints, _recipient } = unwrapIface.parseTransaction(call).args;
                const fullVisualization = [(0, utils_1.getAction)('Claim withdrawal')];
                if (_recipient.toLowerCase() !== accOp.accountAddr.toLowerCase())
                    fullVisualization.push((0, utils_1.getLabel)('and send to'), (0, utils_1.getAddressVisualization)(_recipient));
                return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawal')] };
            }
        }
        return call;
    });
    return newCalls;
};
exports.LidoModule = LidoModule;
//# sourceMappingURL=index.js.map