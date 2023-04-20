const { ethers } = require("ethers")
const { expect } = require("chai")
const pk1 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const pk2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const addressOne = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const addressTwo = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const localhost = 'http://localhost:8545'
const validSig = "0x1626ba7e"

function getMsAddress() {
  let finalSigner = ethers.ZeroAddress;
  const signers = [addressOne, addressTwo]
  for (let i = 0; i < 2; i++) {
    let kecak = ethers.keccak256(ethers.solidityPacked(["address", "address"], [finalSigner, signers[i]]))
    finalSigner = ethers.toQuantity(ethers.getBytes(kecak).slice(12, 32))
  }
  return finalSigner
}

function wrapSig(sig) {
  return `${sig}${'00'}`
}

function wrapMultiSig(sig) {
  return `${sig}${'05'}`
}

describe("Multi Sign Tests", function () {
  it("deploy ambire account", async function () {
    const provider = new ethers.JsonRpcProvider(localhost)
    const wallet = new ethers.Wallet(pk1, provider)
    const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
    const msAddress = getMsAddress()
    const contract = await factory.deploy([msAddress])
    expect(await contract.getAddress()).to.not.be.null
    const isSigner = await contract.privileges(msAddress)
    expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const wallet2 = new ethers.Wallet(pk2, provider)
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(["bytes[]"], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    const isValid = await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)
    expect(isValid).to.equal(validSig)
  })
})