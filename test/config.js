const { ethers } = require('ethers')

const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const pk2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const addressOne = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const addressTwo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const localhost = 'http://localhost:8545'
const validSig = '0x1626ba7e'
const invalidSig = '0xffffffff'
const provider = new ethers.JsonRpcProvider(localhost)
const wallet = new ethers.Wallet(pk1, provider)
const chainId = 31337

module.exports = {
  pk1,
  pk2,
  AmbireAccount,
  localhost,
  validSig,
  invalidSig,
  provider,
  wallet,
  addressOne,
  addressTwo,
  chainId
}
