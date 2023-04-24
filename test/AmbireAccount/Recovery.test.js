const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  pk2,
  chainId,
  AmbireAccount,
  wallet,
  provider,
  addressOne,
  addressTwo
} = require('../config')
const {wrapEthSign, wrapRecover} = require('../ambireSign')
const { wait } = require('../polling')
const wallet2 = new ethers.Wallet(pk2, provider)
const timelock = 120

let ambireAccountAddress = null
async function deployAmbireAccount() {
  const abiCoder = new ethers.AbiCoder()
  const recoveryInfo = [[addressOne, addressTwo], timelock]
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)

  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract = await factory.deploy([addressOne])
  await wait(wallet, contract)
  const contractAddress = await contract.getAddress()
  expect(contractAddress).to.not.be.null
  const singularKeyCanSign = await contract.privileges(addressOne)
  expect(singularKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

  const setAddrPrivilegeABI = [
    'function setAddrPrivilege(address addr, bytes32 priv)'
  ]
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [ timelockAddress, hash ])
  const setPrivTxn = [{
    to: contractAddress,
    value: 0,
    data: calldata
  }]
  const txn = await contract.executeBySender(setPrivTxn)
  await wait(wallet, txn)
  const isTimelockSet = await contract.privileges(timelockAddress)
  expect(isTimelockSet).to.equal(hash)

  ambireAccountAddress = contractAddress
  return {contract, contractAddress}
}

async function getCachedAmbireAccount() {
  if (ambireAccountAddress) {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    return {contract, contractAddress: ambireAccountAddress}
  }

  return await deployAmbireAccount()
}

describe('Recovery tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully schedule a timelock transaction', async function () {
    const {contract, contractAddress} = await getCachedAmbireAccount()
    const abiCoder = new ethers.AbiCoder()
    const recoveryInfo = [[addressOne, addressTwo], timelock]
    const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
    const nonce = await contract.nonce()
    const txns = [
      [addressOne, 0, '0x00']
    ]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [contractAddress, chainId, nonce, txns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)
    const resultTxn = await contract.execute(txns, ambireSignature)
    await wait(wallet, resultTxn)
    const receipt = await resultTxn.wait()
    const block = await provider.getBlock(receipt.blockNumber)
    const retrievedHash = await contract.scheduledRecoveries(msgHash)
    expect(retrievedHash).to.not.be.null
    expect(retrievedHash.toString()).to.equal((block.timestamp + timelock).toString())
  })
})