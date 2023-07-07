import { ethers } from 'ethers'
import chai from 'chai'
import chaiAssertionsCount from 'chai-assertions-count'
chai.use(chaiAssertionsCount)
import { expect } from 'chai'

const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const pk2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const pk3 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
const addressOne = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const addressTwo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const addressThree = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const addressFour = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const AmbireAccountFactory = require('../artifacts/contracts/AmbireAccountFactory.sol/AmbireAccountFactory.json')
const localhost = 'http://127.0.0.1:8545'
const validSig = '0x1626ba7e'
const invalidSig = '0xffffffff'
const provider = new ethers.JsonRpcProvider(localhost)
const wallet = new ethers.Wallet(pk1, provider)
const wallet2 = new ethers.Wallet(pk2, provider)
const wallet3 = new ethers.Wallet(pk3, provider)
const chainId = 31337
const abiCoder = new ethers.AbiCoder()
const assertion = chai.Assertion
const deploySalt = 0
const deployGasLimit = 1000000
const fs = require('fs');
const filenames = fs.readdirSync(__dirname + '/../artifacts/build-info');
const buildInfo = filenames.length ? require('../artifacts/build-info/' + filenames[0]) : null

export {
  pk1,
  pk2,
  pk3,
  AmbireAccount,
  AmbireAccountFactory,
  localhost,
  validSig,
  invalidSig,
  provider,
  wallet,
  wallet2,
  wallet3,
  addressOne,
  addressTwo,
  addressThree,
  addressFour,
  abiCoder,
  chainId,
  expect,
  buildInfo,
  deploySalt,
  deployGasLimit,
  assertion
}
