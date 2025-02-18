"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearHumanizerMetaObjectFromStorage = exports.humanizeMessage = exports.humanizeAccountOp = exports.humanizerCallModules = void 0;
const tslib_1 = require("tslib");
const humanizerInfo_json_1 = tslib_1.__importDefault(require("../../consts/humanizer/humanizerInfo.json"));
const richJson_1 = require("../richJson/richJson");
const messageModules_1 = require("./messageModules");
const _1Inch_1 = tslib_1.__importDefault(require("./modules/1Inch"));
const Aave_1 = require("./modules/Aave");
const Across_1 = tslib_1.__importDefault(require("./modules/Across"));
const Airdrops_1 = require("./modules/Airdrops");
const AsciiModule_1 = tslib_1.__importDefault(require("./modules/AsciiModule"));
const Curve_1 = tslib_1.__importDefault(require("./modules/Curve"));
const Deployment_1 = require("./modules/Deployment");
const embeddedAmbireOperationHumanizer_1 = require("./modules/embeddedAmbireOperationHumanizer");
const ENS_1 = require("./modules/ENS");
const FallbackHumanizer_1 = tslib_1.__importDefault(require("./modules/FallbackHumanizer"));
const GasTankModule_1 = tslib_1.__importDefault(require("./modules/GasTankModule"));
const KyberSwap_1 = tslib_1.__importDefault(require("./modules/KyberSwap"));
const Legends_1 = tslib_1.__importDefault(require("./modules/Legends"));
const Lido_1 = require("./modules/Lido");
const OpenSea_1 = require("./modules/OpenSea");
const postProcessModule_1 = require("./modules/PostProcessing/postProcessModule");
const PreProcess_1 = tslib_1.__importDefault(require("./modules/PreProcess"));
const Privileges_1 = tslib_1.__importDefault(require("./modules/Privileges"));
const SingletonFactory_1 = tslib_1.__importDefault(require("./modules/SingletonFactory"));
const Socket_1 = require("./modules/Socket");
const Sushiswap_1 = tslib_1.__importDefault(require("./modules/Sushiswap"));
const Tokens_1 = require("./modules/Tokens");
const TraderJoe_1 = tslib_1.__importDefault(require("./modules/TraderJoe"));
const Uniswap_1 = require("./modules/Uniswap");
const WALLET_1 = require("./modules/WALLET");
const Wrapping_1 = tslib_1.__importDefault(require("./modules/Wrapping"));
// from most generic to least generic
// the final humanization is the final triggered module
exports.humanizerCallModules = [
    PreProcess_1.default,
    embeddedAmbireOperationHumanizer_1.embeddedAmbireOperationHumanizer,
    Deployment_1.deploymentModule,
    Tokens_1.genericErc721Humanizer,
    Tokens_1.genericErc20Humanizer,
    Lido_1.LidoModule,
    GasTankModule_1.default,
    Airdrops_1.airdropsModule,
    Uniswap_1.uniswapHumanizer,
    Curve_1.default,
    TraderJoe_1.default,
    KyberSwap_1.default,
    Socket_1.SocketModule,
    Across_1.default,
    _1Inch_1.default,
    Wrapping_1.default,
    Aave_1.aaveHumanizer,
    WALLET_1.WALLETModule,
    Privileges_1.default,
    Sushiswap_1.default,
    Legends_1.default,
    SingletonFactory_1.default,
    ENS_1.ensModule,
    OpenSea_1.openSeaModule,
    AsciiModule_1.default,
    FallbackHumanizer_1.default,
    postProcessModule_1.postProcessing
];
// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [
    messageModules_1.erc20Module,
    messageModules_1.erc721Module,
    messageModules_1.permit2Module,
    messageModules_1.entryPointModule,
    messageModules_1.legendsMessageModule,
    messageModules_1.ensMessageModule,
    messageModules_1.openseaMessageModule
];
const humanizeAccountOp = (_accountOp, options) => {
    const accountOp = (0, richJson_1.parse)((0, richJson_1.stringify)(_accountOp));
    const humanizerOptions = {
        ...options,
        networkId: accountOp.networkId
    };
    let currentCalls = accountOp.calls;
    exports.humanizerCallModules.forEach((hm) => {
        try {
            currentCalls = hm(accountOp, currentCalls, humanizerInfo_json_1.default, humanizerOptions);
        }
        catch (error) {
            console.error(error);
            // No action is needed here; we only set `currentCalls` if the module successfully resolves the calls.
        }
    });
    return currentCalls;
};
exports.humanizeAccountOp = humanizeAccountOp;
const humanizeMessage = (_message) => {
    const message = (0, richJson_1.parse)((0, richJson_1.stringify)(_message));
    try {
        // runs all modules and takes the first non empty array
        const { fullVisualization, warnings } = humanizerTMModules.map((m) => m(message)).filter((p) => p.fullVisualization?.length)[0] || {};
        return { ...message, fullVisualization, warnings };
    }
    catch (error) {
        console.error(error);
        return message;
    }
};
exports.humanizeMessage = humanizeMessage;
// As of version v4.34.0 HumanizerMetaV2 in storage is no longer needed. It was
// used for persisting learnt data from async operations, triggered by the
// humanization process.
async function clearHumanizerMetaObjectFromStorage(storage) {
    await storage.remove('HumanizerMetaV2');
}
exports.clearHumanizerMetaObjectFromStorage = clearHumanizerMetaObjectFromStorage;
//# sourceMappingURL=index.js.map