"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseErr = exports.fromDescriptor = exports.Deployless = exports.DeploylessMode = void 0;
var ethers_1 = require("ethers");
var assert_1 = require("assert");
var Deployless_json_1 = require("../../../contracts/compiled/Deployless.json");
// this is a magic contract that is constructed like `constructor(bytes memory contractBytecode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
var deploylessProxyBin = Deployless_json_1.default.bin;
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
// see https://gist.github.com/Ivshti/fbcc37c0a8b88d6e51bb30db57f3d50e
var codeOfContractCode = '0x608060405234801561001057600080fd5b506004361061002b5760003560e01c80631e05758f14610030575b600080fd5b61004a60048036038101906100459190610248565b61004c565b005b60008151602083016000f0905060008173ffffffffffffffffffffffffffffffffffffffff163b036100aa576040517fb4f5411100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60008173ffffffffffffffffffffffffffffffffffffffff16803b806020016040519081016040528181526000908060200190933c90506000815190508060208301f35b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6101558261010c565b810181811067ffffffffffffffff821117156101745761017361011d565b5b80604052505050565b60006101876100ee565b9050610193828261014c565b919050565b600067ffffffffffffffff8211156101b3576101b261011d565b5b6101bc8261010c565b9050602081019050919050565b82818337600083830152505050565b60006101eb6101e684610198565b61017d565b90508281526020810184848401111561020757610206610107565b5b6102128482856101c9565b509392505050565b600082601f83011261022f5761022e610102565b5b813561023f8482602086016101d8565b91505092915050565b60006020828403121561025e5761025d6100f8565b5b600082013567ffffffffffffffff81111561027c5761027b6100fd565b5b6102888482850161021a565b9150509291505056fea2646970667358221220de4923c71abcedf68454c251a9becff7e8a4f8db4adee6fdb16d583f509c63bb64736f6c63430008120033';
var codeOfContractAbi = ['function codeOf(bytes deployCode) external view'];
// The custom error that both these contracts will raise in case the deploy process of the contract goes wrong
// error DeployFailed();
var deployErrorSig = '0xb4f54111';
// Signature of Error(string)
var errorSig = '0x08c379a0';
// Signature of Panic(uint256)
var panicSig = '0x4e487b71';
// any made up addr would work
var arbitraryAddr = '0x0000000000000000000000000000000000696969';
var abiCoder = new ethers_1.AbiCoder();
var DeploylessMode;
(function (DeploylessMode) {
    DeploylessMode[DeploylessMode["Detect"] = 0] = "Detect";
    DeploylessMode[DeploylessMode["ProxyContract"] = 1] = "ProxyContract";
    DeploylessMode[DeploylessMode["StateOverride"] = 2] = "StateOverride";
})(DeploylessMode = exports.DeploylessMode || (exports.DeploylessMode = {}));
var defaultOptions = {
    mode: DeploylessMode.Detect,
    blockTag: 'latest',
    from: undefined
};
var Deployless = /** @class */ (function () {
    function Deployless(provider, abi, code, codeAtRuntime) {
        assert_1.default.ok(code.startsWith('0x'), 'contract code must start with 0x');
        assert_1.default.ok(!abi.includes(function (x) { return x.type === 'constructor'; }), 'contract cannot have a constructor, as it is not supported in state override mode');
        this.contractBytecode = code;
        this.provider = provider;
        this.iface = new ethers_1.Interface(abi);
        if (codeAtRuntime !== undefined) {
            assert_1.default.ok(codeAtRuntime.startsWith('0x'), 'contract code (runtime) must start with 0x');
            this.stateOverrideSupported = true;
            this.contractRuntimeCode = codeAtRuntime;
        }
    }
    Object.defineProperty(Deployless.prototype, "isLimitedAt24kbData", {
        get: function () {
            return !this.stateOverrideSupported;
        },
        enumerable: false,
        configurable: true
    });
    // this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
    Deployless.prototype.detectStateOverride = function () {
        return __awaiter(this, void 0, void 0, function () {
            var codeOfIface, code;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!(this.provider instanceof ethers_1.JsonRpcProvider)) {
                            throw new Error('state override mode (or auto-detect) not available unless you use JsonRpcProvider');
                        }
                        codeOfIface = new ethers_1.Interface(codeOfContractAbi);
                        return [4 /*yield*/, mapError(this.provider.send('eth_call', [
                                {
                                    to: arbitraryAddr,
                                    data: codeOfIface.encodeFunctionData('codeOf', [this.contractBytecode])
                                },
                                'latest',
                                (_a = {}, _a[arbitraryAddr] = { code: codeOfContractCode }, _a)
                            ]))
                            // any response bigger than 0x is sufficient to know that state override worked
                        ];
                    case 1:
                        code = _b.sent();
                        // any response bigger than 0x is sufficient to know that state override worked
                        this.stateOverrideSupported = code.length > 2;
                        this.contractRuntimeCode = mapResponse(code);
                        return [2 /*return*/];
                }
            });
        });
    };
    Deployless.prototype.call = function (methodName, args, opts) {
        if (opts === void 0) { opts = {}; }
        return __awaiter(this, void 0, void 0, function () {
            var forceProxy, callData, callPromise, returnDataRaw, _a;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        opts = __assign(__assign({}, defaultOptions), opts);
                        forceProxy = opts.mode === DeploylessMode.ProxyContract;
                        // First, start by detecting which modes are available, unless we're forcing the proxy mode
                        // if we use state override, we do need detection to run still so it can populate contractRuntimeCode
                        if (!this.detectionPromise && !forceProxy && this.contractRuntimeCode === undefined) {
                            this.detectionPromise = this.detectStateOverride();
                        }
                        return [4 /*yield*/, this.detectionPromise];
                    case 1:
                        _c.sent();
                        if (opts.mode === DeploylessMode.StateOverride && !this.stateOverrideSupported) {
                            // @TODO test this case
                            throw new Error('state override requested but not supported');
                        }
                        callData = this.iface.encodeFunctionData(methodName, args);
                        callPromise = !!this.stateOverrideSupported && !forceProxy
                            ? this.provider.send('eth_call', [
                                {
                                    to: arbitraryAddr,
                                    data: callData,
                                    from: opts.from,
                                    gasPrice: opts === null || opts === void 0 ? void 0 : opts.gasPrice,
                                    gas: opts === null || opts === void 0 ? void 0 : opts.gasLimit
                                },
                                opts.blockTag,
                                (_b = {}, _b[arbitraryAddr] = { code: this.contractRuntimeCode }, _b)
                            ])
                            : this.provider.call({
                                blockTag: opts.blockTag,
                                from: opts.from,
                                gasPrice: opts === null || opts === void 0 ? void 0 : opts.gasPrice,
                                gasLimit: opts === null || opts === void 0 ? void 0 : opts.gasLimit,
                                data: checkDataSize((0, ethers_1.concat)([
                                    deploylessProxyBin,
                                    abiCoder.encode(['bytes', 'bytes'], [this.contractBytecode, callData])
                                ]))
                            });
                        _a = mapResponse;
                        return [4 /*yield*/, mapError(callPromise)];
                    case 2:
                        returnDataRaw = _a.apply(void 0, [_c.sent()]);
                        return [2 /*return*/, this.iface.decodeFunctionResult(methodName, returnDataRaw)];
                }
            });
        });
    };
    return Deployless;
}());
exports.Deployless = Deployless;
function fromDescriptor(provider, desc, supportStateOverride) {
    return new Deployless(provider, desc.abi, desc.bin, supportStateOverride ? desc.binRuntime : undefined);
}
exports.fromDescriptor = fromDescriptor;
function mapError(callPromise) {
    return __awaiter(this, void 0, void 0, function () {
        var e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, callPromise];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    e_1 = _a.sent();
                    // ethers v5 provider: e.error.data is usually our eth_call output in case of execution reverted
                    if (e_1.error && e_1.error.data)
                        return [2 /*return*/, e_1.error.data
                            // ethers v5 provider: unwrap the wrapping that ethers adds to this type of error in case of provider.call
                        ];
                    // ethers v5 provider: unwrap the wrapping that ethers adds to this type of error in case of provider.call
                    if (e_1.code === 'CALL_EXCEPTION' && e_1.error)
                        throw e_1.error;
                    // ethers v6 provider: wrapping the error in case of execution reverted
                    if (e_1.code === 'CALL_EXCEPTION' && e_1.data)
                        return [2 /*return*/, e_1.data];
                    throw e_1;
                case 3: return [2 /*return*/];
            }
        });
    });
}
function mapResponse(data) {
    if (data === deployErrorSig)
        throw new Error('contract deploy failed');
    var err = parseErr(data);
    if (err)
        throw err;
    return data;
}
function parseErr(data) {
    var dataNoPrefix = data.slice(10);
    if (data.startsWith(panicSig)) {
        // https://docs.soliditylang.org/en/v0.8.11/control-structures.html#panic-via-assert-and-error-via-require
        var num = parseInt('0x' + dataNoPrefix);
        if (num === 0x00)
            return 'generic compiler error';
        if (num === 0x01)
            return 'solidity assert error';
        if (num === 0x11)
            return 'arithmetic error';
        if (num === 0x12)
            return 'division by zero';
        return "panic error: 0x".concat(num.toString(16));
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
