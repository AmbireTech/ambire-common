"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gasTankModule = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("../../../../consts/addresses");
const utils_1 = require("../../utils");
const gasTankModule = (_, irCalls) => {
    const newCalls = irCalls.map((call) => {
        // @TODO fix those upper/lowercase
        if (call.to.toLowerCase() === addresses_1.FEE_COLLECTOR.toLowerCase()) {
            if (call.value > 0n) {
                return {
                    ...call,
                    fullVisualization: [(0, utils_1.getAction)('Fuel gas tank with'), (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value)]
                };
            }
            try {
                const [text] = new ethers_1.AbiCoder().decode(['string', 'uint256', 'string'], call.data);
                // mostly useful for filtering out call in benzin
                if (text === 'gasTank')
                    return { ...call, fullVisualization: [(0, utils_1.getAction)('Pay fee with gas tank')] };
            }
            catch (e) {
                // do nothing
            }
        }
        else if (call.fullVisualization?.[0]?.content === 'Send' &&
            call.fullVisualization?.[1]?.type === 'token' &&
            call.fullVisualization?.[2]?.content === 'to' &&
            call.fullVisualization?.[3].type === 'address' &&
            call.fullVisualization[3].address.toLowerCase() === addresses_1.FEE_COLLECTOR.toLowerCase())
            return {
                ...call,
                fullVisualization: [(0, utils_1.getAction)('Fuel gas tank with'), call.fullVisualization[1]]
            };
        return call;
    });
    return newCalls;
};
exports.gasTankModule = gasTankModule;
//# sourceMappingURL=gasTankModule.js.map