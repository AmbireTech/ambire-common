"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSASupport = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const userOperation_1 = require("../userOperation/userOperation");
const deployless_1 = require("./deployless");
// simulate a deployless call to the given provider.
// if the call is successful, it means Ambire smart accounts are supported
// on the given network
async function getSASupport(provider) {
    const smartAccount = await (0, account_1.getSmartAccount)([
        {
            addr: deploy_1.DEPLOYLESS_SIMULATION_FROM,
            hash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        }
    ], []);
    const deploylessOptions = {
        blockTag: 'latest',
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        // very important to send to the AMBIRE_ACCOUNT_FACTORY
        // or else the SA address won't match
        to: deploy_1.AMBIRE_ACCOUNT_FACTORY,
        mode: deployless_1.DeploylessMode.StateOverride
    };
    const deployless = (0, deployless_1.fromDescriptor)(provider, AmbireFactory_json_1.default, true);
    let supportsStateOverride = true;
    const result = await deployless
        .call('deployAndExecute', [
        smartAccount.creation.bytecode,
        smartAccount.creation.salt,
        [(0, accountOp_1.callToTuple)((0, userOperation_1.getActivatorCall)(smartAccount.addr))],
        (0, account_1.getSpoof)(smartAccount)
    ], deploylessOptions)
        .catch((e) => {
        if (e.message.includes('no response')) {
            throw new Error('no response');
        }
        // if there's an error, return the zero address indicating that
        // our smart accounts will most likely not work on this chain
        supportsStateOverride = false;
        return [ethers_1.ZeroAddress];
    });
    return {
        addressMatches: result[0] === smartAccount.addr,
        supportsStateOverride
    };
}
exports.getSASupport = getSASupport;
//# sourceMappingURL=simulateDeployCall.js.map