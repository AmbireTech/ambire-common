"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get4437Bytecode = exports.getBytecode = void 0;
const deploy_1 = require("../../consts/deploy");
const provider_1 = require("../../services/provider");
const deploy_2 = require("./deploy");
async function getBytecode(priLevels) {
    // get the bytecode and deploy it
    return (0, deploy_2.getProxyDeployBytecode)(deploy_1.PROXY_AMBIRE_ACCOUNT, priLevels, {
        ...(0, deploy_2.getStorageSlotsFromArtifact)(null)
    });
}
exports.getBytecode = getBytecode;
async function get4437Bytecode(network, priLevels) {
    const provider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId);
    const code = await provider.getCode(deploy_1.PROXY_AMBIRE_4337_ACCOUNT);
    if (code === '0x')
        throw new Error('No proxy ambire account mined for the specified network');
    // get the bytecode and deploy it
    return (0, deploy_2.getProxyDeployBytecode)(deploy_1.PROXY_AMBIRE_4337_ACCOUNT, priLevels, {
        ...(0, deploy_2.getStorageSlotsFromArtifact)(null)
    });
}
exports.get4437Bytecode = get4437Bytecode;
//# sourceMappingURL=bytecode.js.map