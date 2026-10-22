"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanizeCallWithModules = exports.humanizerCallModules = void 0;
const tslib_1 = require("tslib");
const MetaMorpho_1 = tslib_1.__importDefault(require("./modules/MetaMorpho"));
const humanizerInfo_json_1 = tslib_1.__importDefault(require("../../consts/humanizer/humanizerInfo.json"));
const _1Inch_1 = tslib_1.__importDefault(require("./modules/1Inch"));
const Aave_1 = require("./modules/Aave");
const Across_1 = tslib_1.__importDefault(require("./modules/Across"));
const Airdrops_1 = require("./modules/Airdrops");
const Allowance_1 = tslib_1.__importDefault(require("./modules/Allowance"));
const AsciiModule_1 = tslib_1.__importDefault(require("./modules/AsciiModule"));
const Bundler3_1 = tslib_1.__importDefault(require("./modules/Bundler3"));
const CowSwap_1 = tslib_1.__importDefault(require("./modules/CowSwap"));
const Curve_1 = tslib_1.__importDefault(require("./modules/Curve"));
const DaiPermit_1 = tslib_1.__importDefault(require("./modules/DaiPermit"));
const Deployment_1 = require("./modules/Deployment");
const embeddedAmbireOperationHumanizer_1 = require("./modules/embeddedAmbireOperationHumanizer");
const ENS_1 = require("./modules/ENS");
const FallbackHumanizer_1 = tslib_1.__importDefault(require("./modules/FallbackHumanizer"));
const GasTankModule_1 = tslib_1.__importDefault(require("./modules/GasTankModule"));
const Guild_1 = tslib_1.__importDefault(require("./modules/Guild"));
const KyberSwap_1 = tslib_1.__importDefault(require("./modules/KyberSwap"));
const Legends_1 = tslib_1.__importDefault(require("./modules/Legends"));
const Lido_1 = require("./modules/Lido");
const Lifi_1 = require("./modules/Lifi");
const ModuleProxyFactory_1 = tslib_1.__importDefault(require("./modules/ModuleProxyFactory"));
const OpenSea_1 = require("./modules/OpenSea");
const Pancake_1 = tslib_1.__importDefault(require("./modules/Pancake"));
const postProcessModule_1 = require("./modules/PostProcessing/postProcessModule");
const PreProcess_1 = tslib_1.__importDefault(require("./modules/PreProcess"));
const Privileges_1 = tslib_1.__importDefault(require("./modules/Privileges"));
const Safe_1 = tslib_1.__importDefault(require("./modules/Safe"));
const SingletonFactory_1 = tslib_1.__importDefault(require("./modules/SingletonFactory"));
const Socket_1 = require("./modules/Socket");
const Sushiswap_1 = tslib_1.__importDefault(require("./modules/Sushiswap"));
const Tokens_1 = require("./modules/Tokens");
const TraderJoe_1 = tslib_1.__importDefault(require("./modules/TraderJoe"));
const TrustlessManifesto_1 = tslib_1.__importDefault(require("./modules/TrustlessManifesto"));
const Uniswap_1 = require("./modules/Uniswap");
const PrivacyPools_1 = tslib_1.__importDefault(require("./modules/PrivacyPools"));
const WALLET_1 = require("./modules/WALLET");
const Wrapping_1 = tslib_1.__importDefault(require("./modules/Wrapping"));
// The modules that describe a single call. Kept separate only to compose `humanizerCallModules`
// below - every caller runs the whole pipeline through `humanizeCallWithModules`.
const singleCallHumanizerModules = [
    Tokens_1.genericErc721Humanizer,
    Tokens_1.genericErc20Humanizer,
    DaiPermit_1.default,
    TrustlessManifesto_1.default,
    Lido_1.LidoModule,
    GasTankModule_1.default,
    PrivacyPools_1.default,
    Airdrops_1.airdropsModule,
    Uniswap_1.uniswapHumanizer,
    Curve_1.default,
    TraderJoe_1.default,
    KyberSwap_1.default,
    CowSwap_1.default,
    Socket_1.SocketModule,
    Lifi_1.LifiModule,
    Across_1.default,
    _1Inch_1.default,
    Pancake_1.default,
    Wrapping_1.default,
    Aave_1.aaveHumanizer,
    WALLET_1.WALLETModule,
    Safe_1.default,
    Bundler3_1.default,
    MetaMorpho_1.default,
    Allowance_1.default,
    ModuleProxyFactory_1.default,
    Privileges_1.default,
    Sushiswap_1.default,
    Legends_1.default,
    SingletonFactory_1.default,
    ENS_1.ensModule,
    Guild_1.default,
    OpenSea_1.openSeaModule,
    AsciiModule_1.default
];
// from most generic to least generic
// the final humanization is the final triggered module
exports.humanizerCallModules = [
    PreProcess_1.default,
    Deployment_1.deploymentModule,
    ...singleCallHumanizerModules,
    embeddedAmbireOperationHumanizer_1.embeddedAmbireOperationHumanizer,
    FallbackHumanizer_1.default,
    postProcessModule_1.postProcessing
];
/**
 * Describes one call with the humanizer modules - the humanization every call gets when no ERC-7730
 * descriptor covers it.
 *
 * The modules run in order, each seeing what the previous one produced, so the least generic module
 * that matches has the final say. A module that throws is skipped and the call keeps the description
 * it already had, because one broken decoder must not lose the whole call.
 *
 * This is the single entry point for it: a nested call decoded inside an ERC-7730 descriptor is
 * described by exactly the same modules, in the same order, as a top-level one.
 */
const humanizeCallWithModules = (accountOp, call) => exports.humanizerCallModules.reduce((currentCall, humanizeWithModule) => {
    try {
        return humanizeWithModule(accountOp, currentCall, humanizerInfo_json_1.default);
    }
    catch (error) {
        console.error(error);
        // No action is needed here; we only update `currentCall` if the module successfully resolves it.
        return currentCall;
    }
}, call);
exports.humanizeCallWithModules = humanizeCallWithModules;
//# sourceMappingURL=callModules.js.map