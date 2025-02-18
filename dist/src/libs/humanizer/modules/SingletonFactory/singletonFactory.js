"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.singletonFactory = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const CONTRACT_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f';
const singletonFactory = (_, irCalls) => {
    const iface = new ethers_1.Interface(['function  deploy(bytes,bytes32)']);
    const newCalls = irCalls.map((call) => {
        // @TODO fix those upper/lowercase
        if ((0, ethers_1.getAddress)(call.to) === CONTRACT_FACTORY_ADDRESS &&
            call.data.slice(0, 10) === iface.getFunction('deploy').selector) {
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Deploy a contract'),
                    (0, utils_1.getLabel)('via'),
                    (0, utils_1.getAddressVisualization)(CONTRACT_FACTORY_ADDRESS)
                ]
            };
        }
        return call;
    });
    return newCalls;
};
exports.singletonFactory = singletonFactory;
//# sourceMappingURL=singletonFactory.js.map