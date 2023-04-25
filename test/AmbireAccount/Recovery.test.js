const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  pk2,
  pk3,
  chainId,
  AmbireAccount,
  wallet,
  provider,
  addressOne,
  addressTwo,
  addressThree,
} = require('../config')
const {wrapEthSign, wrapRecover} = require('../ambireSign')
const { wait } = require('../polling')
const wallet2 = new ethers.Wallet(pk2, provider)
const wallet3 = new ethers.Wallet(pk3, provider)
const timelock = 1
const recoveryInfo = [[addressOne, addressTwo], timelock]
const abiCoder = new ethers.AbiCoder()

function getTimelockData() {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)
  return {hash, timelockAddress}
}

let ambireAccountAddress = null
async function deployAmbireAccount() {
  const {hash, timelockAddress} = getTimelockData()

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
  return {contract, ambireAccountAddress}
}

async function getCachedAmbireAccount() {
  if (ambireAccountAddress) {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    return {contract, ambireAccountAddress}
  }

  return await deployAmbireAccount()
}

function getRecoveryTxn(contractAddress) {
  const setAddrPrivilegeABI = [
    'function setAddrPrivilege(address addr, bytes32 priv)'
  ]
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [ addressThree, ethers.toBeHex(1, 32) ])
  return [contractAddress, 0, calldata]
}

describe('Recovery basic schedule and execute', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully schedule a timelock transaction', async function () {
    const {contract, ambireAccountAddress} = await getCachedAmbireAccount()
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getRecoveryTxn(ambireAccountAddress)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
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
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, resultTxn)
    const receipt = await resultTxn.wait()
    const block = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())
  })
  it('successfully finalize a timelock transaction', async function () {
    const {contract, ambireAccountAddress} = await getCachedAmbireAccount()
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getRecoveryTxn(ambireAccountAddress)];
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
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
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, resultTxn)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal("0")
    const newKeyCanSign = await contract.privileges(addressThree)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})

describe('Recovery complex tests', function () {
  // tests:
  // try to add txns to the execute with the same signature - it should fail
  // try to grief - it should fail
  // test cancelation - it should pass
  // make the timelock bigger and try to execute before it has passed - it should fail

  it('successfully schedule and finalize a timelock transaction with the same signature but fail on the third txn', async function () {
    it('successfully deploys the ambire account', async function () {
      await deployAmbireAccount()
    })
    const {contract, ambireAccountAddress} = await getCachedAmbireAccount()
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getRecoveryTxn(ambireAccountAddress)];
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
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

    // schedule
    const scheduleTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, scheduleTxn)
    const receipt = await scheduleTxn.wait()
    const block = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())

    // finalize
    const finalizeTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, finalizeTxn)
    const recoveryFinalized = await contract.scheduledRecoveries(msgHash)
    expect(recoveryFinalized.toString()).to.equal("0")
    const newKeyCanSign = await contract.privileges(addressThree)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

    // try to schedule but fail because the nonce has moved up
    let errorCaught = false
    try {
      await contract.execute(recoveryTxns, ambireSignature)
    } catch (error) {
      expect(error.reason).to.equal('RECOVERY_NOT_AUTHORIZED')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
})