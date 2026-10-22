"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.singletonFactory = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const CONTRACT_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f';
const deployAbi = (0, viem_1.parseAbi)(['function deploy(bytes,bytes32)']);
const deploySelector = (0, viem_1.toFunctionSelector)(deployAbi[0]);
const singletonFactory = (_, call) => {
    // @TODO fix those upper/lowercase
    if (call.to &&
        call.to.toLowerCase() === CONTRACT_FACTORY_ADDRESS.toLowerCase() &&
        call.data.slice(0, 10) === deploySelector) {
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
};
exports.singletonFactory = singletonFactory;
//# sourceMappingURL=singletonFactory.js.map