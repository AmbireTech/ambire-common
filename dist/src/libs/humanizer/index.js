"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanizerCallModules = exports.humanizeMessage = exports.humanizeAccountOp = void 0;
const tslib_1 = require("tslib");
const richJson_1 = require("../richJson/richJson");
const callModules_1 = require("./callModules");
Object.defineProperty(exports, "humanizerCallModules", { enumerable: true, get: function () { return callModules_1.humanizerCallModules; } });
const erc7730_1 = require("./erc7730");
const messageModules_1 = require("./messageModules");
const fallbackShortPlaintext_1 = require("./messageModules/fallbackShortPlaintext");
const utils_1 = require("./utils");
// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [
    messageModules_1.safeMessageModule,
    messageModules_1.erc20Module,
    messageModules_1.erc721Module,
    messageModules_1.permit2Module,
    messageModules_1.cowSwapModule,
    messageModules_1.entryPointModule,
    messageModules_1.legendsMessageModule,
    messageModules_1.ensMessageModule,
    messageModules_1.openseaMessageModule,
    messageModules_1.zealyMessageModule,
    messageModules_1.safeMessageModule,
    messageModules_1.eip7702AuthorizationModule,
    messageModules_1.snapshotModule,
    fallbackShortPlaintext_1.fallbackShortPlaintext
];
const humanizeAccountOp = (_accountOp, options) => {
    const accountOp = (0, richJson_1.parse)((0, richJson_1.stringify)(_accountOp));
    let currentCalls = accountOp.calls.map((originalCall) => (0, callModules_1.humanizeCallWithModules)(accountOp, originalCall));
    if (options?.erc7730Descriptors) {
        currentCalls = currentCalls.map((call, index) => {
            const resolvedDescriptor = options.erc7730Descriptors?.[index];
            if (!resolvedDescriptor || call.preferredOverErc7730)
                return call;
            try {
                const originalCall = accountOp.calls[index];
                if (!originalCall)
                    return call;
                const erc7730Call = (0, erc7730_1.humanizeCallWithErc7730)(originalCall, accountOp.chainId, accountOp.accountAddr, resolvedDescriptor, options.nativeAssetSymbol);
                if (!erc7730Call)
                    return call;
                // The descriptor builds its result from the raw call, so it starts with no warnings. The
                // warnings the modules found are still about the same call, so keep them both.
                return {
                    ...erc7730Call,
                    warnings: (0, utils_1.dedupeWarnings)([...(call.warnings || []), ...(erc7730Call.warnings || [])])
                };
            }
            catch (error) {
                console.error(error);
                return call;
            }
        });
    }
    return currentCalls;
};
exports.humanizeAccountOp = humanizeAccountOp;
const humanizeMessage = (_message, options) => {
    const message = (0, richJson_1.parse)((0, richJson_1.stringify)(_message));
    try {
        // runs all modules and takes the first non empty array
        const { fullVisualization, warnings, canHideDropdownArrow } = humanizerTMModules
            .map((m) => {
            try {
                return m(message);
            }
            catch (error) {
                console.error(error);
                return {};
            }
        })
            .filter((p) => p.fullVisualization?.length)[0] || {};
        if (options?.erc7730Descriptor) {
            const erc7730Message = (0, erc7730_1.humanizeMessageWithErc7730)(message, options.erc7730Descriptor);
            if (erc7730Message) {
                // The descriptor builds its result from the raw message, so it starts with no warnings.
                // The warnings humanizerTMModules found are still about the same message, so keep both.
                return {
                    ...erc7730Message,
                    warnings: (0, utils_1.dedupeWarnings)([...(warnings || []), ...(erc7730Message.warnings || [])])
                };
            }
        }
        return { ...message, fullVisualization, warnings, canHideDropdownArrow };
    }
    catch (error) {
        console.error(error);
        return message;
    }
};
exports.humanizeMessage = humanizeMessage;
tslib_1.__exportStar(require("./erc7730"), exports);
//# sourceMappingURL=index.js.map