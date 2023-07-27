"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertion = exports.deployGasLimit = exports.deploySalt = exports.buildInfo = exports.expect = exports.chainId = exports.abiCoder = exports.addressFour = exports.addressThree = exports.addressTwo = exports.addressOne = exports.wallet3 = exports.wallet2 = exports.wallet = exports.provider = exports.invalidSig = exports.validSig = exports.localhost = exports.AmbireAccountFactory = exports.AmbireAccount = exports.pk3 = exports.pk2 = exports.pk1 = void 0;
const hardhat_1 = require("hardhat");
const chai_1 = __importStar(require("chai"));
Object.defineProperty(exports, "expect", { enumerable: true, get: function () { return chai_1.expect; } });
const chai_assertions_count_1 = __importDefault(require("chai-assertions-count"));
chai_1.default.use(chai_assertions_count_1.default);
const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
exports.pk1 = pk1;
const pk2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
exports.pk2 = pk2;
const pk3 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
exports.pk3 = pk3;
const addressOne = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
exports.addressOne = addressOne;
const addressTwo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
exports.addressTwo = addressTwo;
const addressThree = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
exports.addressThree = addressThree;
const addressFour = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
exports.addressFour = addressFour;
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json');
exports.AmbireAccount = AmbireAccount;
const AmbireAccountFactory = require('../artifacts/contracts/AmbireAccountFactory.sol/AmbireAccountFactory.json');
exports.AmbireAccountFactory = AmbireAccountFactory;
const localhost = 'http://127.0.0.1:8545';
exports.localhost = localhost;
const validSig = '0x1626ba7e';
exports.validSig = validSig;
const invalidSig = '0xffffffff';
exports.invalidSig = invalidSig;
const provider = hardhat_1.ethers.provider;
exports.provider = provider;
const wallet = new hardhat_1.ethers.Wallet(pk1, provider);
exports.wallet = wallet;
const wallet2 = new hardhat_1.ethers.Wallet(pk2, provider);
exports.wallet2 = wallet2;
const wallet3 = new hardhat_1.ethers.Wallet(pk3, provider);
exports.wallet3 = wallet3;
const chainId = 31337;
exports.chainId = chainId;
const abiCoder = new hardhat_1.ethers.AbiCoder();
exports.abiCoder = abiCoder;
const assertion = chai_1.default.Assertion;
exports.assertion = assertion;
const deploySalt = 0;
exports.deploySalt = deploySalt;
const deployGasLimit = 1000000;
exports.deployGasLimit = deployGasLimit;
const fs = require('fs');
const filenames = fs.readdirSync(`${__dirname}/../artifacts/build-info`);
const buildInfo = filenames.length ? require(`../artifacts/build-info/${filenames[0]}`) : null;
exports.buildInfo = buildInfo;
//# sourceMappingURL=config.js.map