import chai, { expect } from 'chai'
import chaiAssertionsCount from 'chai-assertions-count'
import { ethers } from 'hardhat'

import { DEFAULT_ACCOUNT_LABEL } from '../src/consts/account'
import { Account } from '../src/interfaces/account'

chai.use(chaiAssertionsCount)

const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const pk2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const pk3 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
const addressOne = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const addressTwo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const addressThree = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const addressFour = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const AmbireAccount = require('../contracts/compiled/AmbireAccount.json')
const AmbireFactory = require('../contracts/compiled/AmbireFactory.json')

const relayerUrl = 'https://staging-relayer.ambire.com'
const velcroUrl = 'https://relayer.ambire.com/velcro-v3'
const localhost = 'http://127.0.0.1:8545'
const validSig = '0x1626ba7e'
const invalidSig = '0xffffffff'
const provider = ethers.provider
const wallet = new ethers.Wallet(pk1, provider)
const wallet2 = new ethers.Wallet(pk2, provider)
const wallet3 = new ethers.Wallet(pk3, provider)
const chainId = 31337n
const abiCoder = new ethers.AbiCoder()
const assertion = chai.Assertion
const deploySalt = 0
const deployGasLimit = 1000000

// if storageSlot 0 is privileges then this will work. If we change it in AmbireAccount.sol then we have to include the file below.
// const filenames = fs.readdirSync(`${__dirname}/../artifacts/build-info`)
const buildInfo = null

const trezorSlot7v24337Deployed: Account = {
  addr: '0xaA2450102D8C039A69d7B3daA7C13Cf73F55F742',
  associatedKeys: ['0xf8FF717A6099de9058541d1Ac6cdC9500E9fB1AF'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027fabb251cd0bc873c8f01fdc27fc133835d7b4900eb6429cb319361b180fada709553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xaA2450102D8C039A69d7B3daA7C13Cf73F55F742'
  }
}

const optyDeployed: Account = {
  addr: '0xCE9B3DcdbE37867EAc9c2ebC24e4Fb2eEC8c5FFc',
  associatedKeys: ['0xa2256eAFe1DBc474B05973213c86934418fdef22'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027fa9392f1f1009dfad9226b69ecc4e44c158f7c628f38b49eaad9e30082b72c3a9553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [
    [
      '0xa2256eAFe1DBc474B05973213c86934418fdef22',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xCE9B3DcdbE37867EAc9c2ebC24e4Fb2eEC8c5FFc'
  }
}

const arbNotDeployed: Account = {
  addr: '0x4E6AB66459bD13b9b30A5CbCF28723C7D08172e5',
  associatedKeys: ['0x3884dD96Da6CDaEAf937301Ff5cC5b0a58478355'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f78a07de92ae9961c37e3cf878fa0870168e35ed212cbe0bb8e4b99040792cbfa553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [
    [
      '0x3884dD96Da6CDaEAf937301Ff5cC5b0a58478355',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x4E6AB66459bD13b9b30A5CbCF28723C7D08172e5'
  }
}

export {
  pk1,
  pk2,
  pk3,
  AmbireAccount,
  AmbireFactory,
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
  assertion,
  trezorSlot7v24337Deployed,
  optyDeployed,
  arbNotDeployed,
  relayerUrl,
  velcroUrl
}
