const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  pk2,
  chainId,
  AmbireAccount,
  wallet,
  provider,
  addressOne,
  addressTwo,
  addressThree,
  addressFour,
} = require('../config')
const {wrapEthSign, wrapRecover, wrapCancel} = require('../ambireSign')
const { wait } = require('../polling')
const wallet2 = new ethers.Wallet(pk2, provider)
const timelock = 1
const recoveryInfo = [[addressOne, addressTwo], timelock]
const abiCoder = new ethers.AbiCoder()

function getTimelockData(newRecoveryInfo = recoveryInfo) {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [newRecoveryInfo]))
  const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)
  return {hash, timelockAddress}
}

let ambireAccountAddress = null
async function deployAmbireAccount(newRecoveryInfo = recoveryInfo) {
  const {hash, timelockAddress} = getTimelockData(newRecoveryInfo)

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

function getRecoveryTxn(contractAddress, privAddress = addressThree) {
  const setAddrPrivilegeABI = [
    'function setAddrPrivilege(address addr, bytes32 priv)'
  ]
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [ privAddress, ethers.toBeHex(1, 32) ])
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
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully schedule and finalize a timelock transaction with the same signature but fail on the third txn', async function () {
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
  it('successfully cancels a recovery transaction', async function () {
    const {contract, ambireAccountAddress} = await getCachedAmbireAccount()
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getRecoveryTxn(ambireAccountAddress, addressFour)];
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

    // cancel
    const cancelSignature = wrapCancel(signature)
    const cancelTxn = await contract.execute(recoveryTxns, cancelSignature)
    await wait(wallet, cancelTxn)
    const canceled = await contract.scheduledRecoveries(msgHash)
    expect(canceled.toString()).to.equal("0")
    const newKeyCanSign = await contract.privileges(addressFour)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
  })
  it('fails on trying to add unsigned transactions to finalize recovery after initial schedule', async function () {
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
    const otherTxn = [addressTwo, 0, '0x00']
    const otherTxns = [...recoveryTxns, otherTxn]
    let errorCaught = false
    try {
      await await contract.execute(otherTxns, ambireSignature)
    } catch (error) {
      expect(error.reason).to.equal('RECOVERY_NOT_AUTHORIZED')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
})

describe('Bigger timelock recovery tests', function() {
  it('fail on finalizing the recovery before the timelock', async function () {
    const twoMinutesTimelock = 120
    const recoveryInfo = [[addressOne, addressTwo], twoMinutesTimelock]
    const {contract, ambireAccountAddress} = await deployAmbireAccount(recoveryInfo)
    const {timelockAddress} = getTimelockData(recoveryInfo)
    const nonce = await contract.nonce()
    const recoveryTxns = [getRecoveryTxn(ambireAccountAddress, addressFour)];
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
    expect(recovery.toString()).to.equal((block.timestamp + twoMinutesTimelock).toString())

    // try to execute immediatelly but fail because 2 minutes lock have not passed
    let errorCaught = false
    try {
      await contract.execute(recoveryTxns, ambireSignature)
    } catch (error) {
      expect(error.reason).to.equal('RECOVERY_NOT_READY')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
})