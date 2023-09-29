"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get4437Bytecode = exports.getBytecode = void 0;
const deploy_1 = require("./deploy");
const ethers_1 = require("ethers");
const deploy_2 = require("../../consts/deploy");
async function getBytecode(network, priLevels) {
    const provider = new ethers_1.JsonRpcProvider(network.rpcUrl);
    const code = await provider.getCode(deploy_2.PROXY_AMBIRE_ACCOUNT);
    if (code === '0x')
        throw new Error('No proxy ambire account mined for the specified network');
    // get the bytecode and deploy it
    return (0, deploy_1.getProxyDeployBytecode)(deploy_2.PROXY_AMBIRE_ACCOUNT, priLevels, {
        ...(0, deploy_1.getStorageSlotsFromArtifact)(null)
    });
}
exports.getBytecode = getBytecode;
// use only for tests
async function get4437Bytecode(network, priLevels) {
    const provider = new ethers_1.JsonRpcProvider(network.rpcUrl);
    const code = await provider.getCode(deploy_2.PROXY_AMBIRE_4337_ACCOUNT);
    if (code === '0x')
        throw new Error('No proxy ambire account mined for the specified network');
    // get the bytecode and deploy it
    return (0, deploy_1.getProxyDeployBytecode)(deploy_2.PROXY_AMBIRE_4337_ACCOUNT, priLevels, {
        ...(0, deploy_1.getStorageSlotsFromArtifact)(null)
    });
}
exports.get4437Bytecode = get4437Bytecode;
//# sourceMappingURL=bytecode.js.map