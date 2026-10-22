"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTestErc7730MessageDescriptor = exports.getTestErc7730DescriptorForCall = exports.getTestErc7730Descriptors = exports.getTestErc7730Errors = exports.SAFE_PROXY_V1_4_1_RUNTIME_CODE = void 0;
const featureFlags_1 = require("../featureFlags/featureFlags");
const erc7730_1 = require("./erc7730");
/** Runtime code of a real SafeProxy v1.4.1, so a mocked provider looks like a deployed Safe.
 * The proxy version is fixed here on purpose: its keccak256 must match a hash in
 * KNOWN_SAFE_PROXY_CODE_HASHES (consts/safe.ts) for the Safe singleton lookup to follow it. */
exports.SAFE_PROXY_V1_4_1_RUNTIME_CODE = '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033';
const controllersByRelayer = new WeakMap();
/** In-memory storage, so a test controller never touches anything persistent. */
const makeMemoryStorage = () => ({
    get: async (key, defaultValue) => defaultValue,
    set: async () => { }
});
/** A no-op sink, since these tests only assert on the returned descriptors. */
const makeUiStub = () => ({ message: { sendUiMessage: () => { } } });
/** Answers every chainId with the same provider, which is all these tests ever pass in. */
const makeProvidersStub = (provider) => provider &&
    {
        providers: new Proxy({}, { get: () => provider }),
        initialLoadPromise: undefined
    };
/**
 * Runs the real plan/fetch loop against a test's relayer mock.
 *
 * Memoized per `callRelayer`, so repeated calls within one test share a controller - and therefore
 * its cache and request dedup - while separate tests, which each build their own mock, stay
 * isolated. Tests of the library itself should pass a plain `known` object instead; this is for
 * tests that assert on relayer traffic.
 */
const getTestController = (callRelayer, provider) => {
    const existing = controllersByRelayer.get(callRelayer);
    if (existing)
        return existing;
    const controller = new erc7730_1.Erc7730Controller({
        storage: makeMemoryStorage(),
        callRelayer,
        featureFlags: new featureFlags_1.FeatureFlagsController({}, makeMemoryStorage()),
        providers: makeProvidersStub(provider),
        ui: makeUiStub()
    });
    controllersByRelayer.set(callRelayer, controller);
    return controller;
};
/**
 * The errors the test controller reported for this relayer mock. Descriptor lookups never throw -
 * a failure degrades to the built-in humanization - so this is how a test asserts that a bad
 * response was actually reported rather than silently swallowed.
 */
const getTestErc7730Errors = (callRelayer) => getTestController(callRelayer).emittedErrors;
exports.getTestErc7730Errors = getTestErc7730Errors;
const getTestErc7730Descriptors = (accountOp, callRelayer, provider) => getTestController(callRelayer, provider).getDescriptorsForAccountOp(accountOp);
exports.getTestErc7730Descriptors = getTestErc7730Descriptors;
/** A single call, wrapped as a one-call accountOp. */
const getTestErc7730DescriptorForCall = async (call, chainId, callRelayer, provider) => {
    const descriptors = await (0, exports.getTestErc7730Descriptors)({ chainId, calls: [call] }, callRelayer, provider);
    return descriptors[0] ?? null;
};
exports.getTestErc7730DescriptorForCall = getTestErc7730DescriptorForCall;
const getTestErc7730MessageDescriptor = (message, callRelayer, provider) => getTestController(callRelayer, provider).getDescriptorForMessage(message);
exports.getTestErc7730MessageDescriptor = getTestErc7730MessageDescriptor;
//# sourceMappingURL=testDescriptors.js.map