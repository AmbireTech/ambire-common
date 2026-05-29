"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDebugTraceTransaction = void 0;
const hyperEvmBalanceChanges_1 = require("../libs/accountOp/hyperEvmBalanceChanges");
const getDebugTraceTransaction = (chainId, provider) => (txnHash) => chainId === hyperEvmBalanceChanges_1.HYPER_EVM_CHAIN_ID && provider
    ? provider.send('debug_traceTransaction', [txnHash, { tracer: 'callTracer' }])
    : Promise.resolve(null);
exports.getDebugTraceTransaction = getDebugTraceTransaction;
//# sourceMappingURL=debugTransaction.js.map