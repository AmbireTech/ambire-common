const { ethers } = require("ethers")
const { expect } = require("chai")
const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const AmbireAccount = require('../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const localhost = 'http://localhost:8545'

describe("Multi Sign Tests", function () {
  it("deploy ambire account", async function () {
    const provider = new ethers.JsonRpcProvider(localhost)
    const wallet = new ethers.Wallet(pk, provider)
    const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
    const contract = await factory.deploy([])
    expect(await contract.getAddress()).to.not.be.null
  })
})