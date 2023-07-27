"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseErr = exports.fromDescriptor = exports.Deployless = exports.DeploylessMode = void 0;
const ethers_1 = require("ethers");
const assert_1 = __importDefault(require("assert"));
const Deployless_json_1 = __importDefault(require("../../../contracts/compiled/Deployless.json"));
// this is a magic contract that is constructed like `constructor(bytes memory contractBytecode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
const deploylessProxyBin = Deployless_json_1.default.bin;
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
// see https://gist.github.com/Ivshti/fbcc37c0a8b88d6e51bb30db57f3d50e
const codeOfContractCode = Deployless_json_1.default.binRuntime;
const codeOfContractAbi = Deployless_json_1.default.abi;
// The custom error that both these contracts will raise in case the deploy process of the contract goes wrong
// error DeployFailed();
const deployErrorSig = '0xb4f54111';
// Signature of Error(string)
const errorSig = '0x08c379a0';
// Signature of Panic(uint256)
const panicSig = '0x4e487b71';
// any made up addr would work
const arbitraryAddr = '0x0000000000000000000000000000000000696969';
const abiCoder = new ethers_1.AbiCoder();
var DeploylessMode;
(function (DeploylessMode) {
    DeploylessMode[DeploylessMode["Detect"] = 0] = "Detect";
    DeploylessMode[DeploylessMode["ProxyContract"] = 1] = "ProxyContract";
    DeploylessMode[DeploylessMode["StateOverride"] = 2] = "StateOverride";
})(DeploylessMode = exports.DeploylessMode || (exports.DeploylessMode = {}));
const defaultOptions = {
    mode: DeploylessMode.Detect,
    blockTag: 'latest',
    from: undefined
};
class Deployless {
    get isLimitedAt24kbData() {
        return !this.stateOverrideSupported;
    }
    constructor(provider, abi, code, codeAtRuntime) {
        assert_1.default.ok(code.startsWith('0x'), 'contract code must start with 0x');
        this.contractBytecode = code;
        this.provider = provider;
        this.iface = new ethers_1.Interface(abi);
        if (codeAtRuntime !== undefined) {
            assert_1.default.ok(codeAtRuntime.startsWith('0x'), 'contract code (runtime) must start with 0x');
            this.stateOverrideSupported = true;
            this.contractRuntimeCode = codeAtRuntime;
        }
    }
    // this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
    async detectStateOverride() {
        if (!(this.provider instanceof ethers_1.JsonRpcProvider)) {
            throw new Error('state override mode (or auto-detect) not available unless you use JsonRpcProvider');
        }
        const codeOfIface = new ethers_1.Interface(codeOfContractAbi);
        const code = await mapError(this.provider.send('eth_call', [
            {
                to: arbitraryAddr,
                data: codeOfIface.encodeFunctionData('codeOf', [this.contractBytecode])
            },
            'latest',
            { [arbitraryAddr]: { code: codeOfContractCode } }
        ]));
        // any response bigger than 0x is sufficient to know that state override worked
        this.stateOverrideSupported = code.length > 2;
        this.contractRuntimeCode = mapResponse(code);
    }
    async call(methodName, args, opts = {}) {
        opts = { ...defaultOptions, ...opts };
        const forceProxy = opts.mode === DeploylessMode.ProxyContract;
        // First, start by detecting which modes are available, unless we're forcing the proxy mode
        // if we use state override, we do need detection to run still so it can populate contractRuntimeCode
        if (!this.detectionPromise && !forceProxy && this.contractRuntimeCode === undefined) {
            this.detectionPromise = this.detectStateOverride();
        }
        await this.detectionPromise;
        if (opts.mode === DeploylessMode.StateOverride && !this.stateOverrideSupported) {
            // @TODO test this case
            throw new Error('state override requested but not supported');
        }
        const callData = this.iface.encodeFunctionData(methodName, args);
        const callPromise = !!this.stateOverrideSupported && !forceProxy
            ? this.provider.send('eth_call', [
                {
                    to: arbitraryAddr,
                    data: callData,
                    from: opts.from,
                    gasPrice: opts?.gasPrice,
                    gas: opts?.gasLimit
                },
                opts.blockTag,
                { [arbitraryAddr]: { code: this.contractRuntimeCode } }
            ])
            : this.provider.call({
                blockTag: opts.blockTag,
                from: opts.from,
                gasPrice: opts?.gasPrice,
                gasLimit: opts?.gasLimit,
                data: checkDataSize((0, ethers_1.concat)([
                    deploylessProxyBin,
                    abiCoder.encode(['bytes', 'bytes'], [this.contractBytecode, callData])
                ]))
            });
        const returnDataRaw = mapResponse(await mapError(callPromise));
        return this.iface.decodeFunctionResult(methodName, returnDataRaw);
    }
}
exports.Deployless = Deployless;
function fromDescriptor(provider, desc, supportStateOverride) {
    return new Deployless(provider, desc.abi, desc.bin, supportStateOverride ? desc.binRuntime : undefined);
}
exports.fromDescriptor = fromDescriptor;
async function mapError(callPromise) {
    try {
        return await callPromise;
    }
    catch (e) {
        // ethers v5 provider: e.error.data is usually our eth_call output in case of execution reverted
        if (e.error && e.error.data)
            return e.error.data;
        // ethers v5 provider: unwrap the wrapping that ethers adds to this type of error in case of provider.call
        if (e.code === 'CALL_EXCEPTION' && e.error)
            throw e.error;
        // ethers v6 provider: wrapping the error in case of execution reverted
        if (e.code === 'CALL_EXCEPTION' && e.data)
            return e.data;
        throw e;
    }
}
function mapResponse(data) {
    if (data === deployErrorSig)
        throw new Error('contract deploy failed');
    const err = parseErr(data);
    if (err)
        throw err;
    return data;
}
function parseErr(data) {
    const dataNoPrefix = data.slice(10);
    if (data.startsWith(panicSig)) {
        // https://docs.soliditylang.org/en/v0.8.11/control-structures.html#panic-via-assert-and-error-via-require
        const num = parseInt('0x' + dataNoPrefix);
        if (num === 0x00)
            return 'generic compiler error';
        if (num === 0x01)
            return 'solidity assert error';
        if (num === 0x11)
            return 'arithmetic error';
        if (num === 0x12)
            return 'division by zero';
        return `panic error: 0x${num.toString(16)}`;
    }
    if (data.startsWith(errorSig)) {
        try {
            return abiCoder.decode(['string'], '0x' + dataNoPrefix)[0];
        }
        catch (e) {
            if (e.code === 'BUFFER_OVERRUN' || e.code === 'NUMERIC_FAULT')
                return dataNoPrefix;
            else
                throw e;
        }
    }
    return null;
}
exports.parseErr = parseErr;
function checkDataSize(data) {
    if ((0, ethers_1.getBytes)(data).length >= 24576)
        throw new Error('24kb call data size limit reached, use StateOverride mode');
    return data;
}
//# sourceMappingURL=deployless.js.map