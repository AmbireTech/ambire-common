import { ethers } from 'ethers'
import {
  chainId,
  AmbireAccount,
  wallet,
  wallet2,
  provider,
  addressOne,
  addressTwo,
  addressThree,
  addressFour,
  expect,
  assertion,
} from '../config'
import {wrapEthSign, wrapRecover, wrapCancel} from '../ambireSign'
import { wait } from '../polling'
import { sendFunds, getPriviledgeTxn } from '../helpers'
const timelock = 1
const recoveryInfo = [[addressOne, addressTwo], timelock]
const abiCoder = new ethers.AbiCoder()

function getTimelockData(newRecoveryInfo = recoveryInfo) {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [newRecoveryInfo]))
  const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)
  return {hash, timelockAddress}
}

let ambireAccountAddress: string
async function deployAmbireAccount(newRecoveryInfo = recoveryInfo) {
  const {hash, timelockAddress} = getTimelockData(newRecoveryInfo)

  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract: any = await factory.deploy([addressOne])
  await wait(wallet, contract)
  const contractAddress = await contract.getAddress()
  expect(contractAddress).to.not.be.null
  const singularKeyCanSign = await contract.privileges(addressOne)
  expect(singularKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  const secondAddressCannotSign = await contract.privileges(addressTwo)
  expect(secondAddressCannotSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')

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
  return {contract}
}

describe('Recovery basic schedule and execute', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully schedule a timelock transaction', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, resultTxn)
    const receipt = await resultTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())
  })
  it('successfully finalize a timelock transaction', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)
    let resultTxn
    try {
      resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    } catch (e: any) {
      await new Promise(r => setTimeout(r, 1000)) //sleep
      resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    }
    
    await wait(wallet, resultTxn)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal('0')
    const newKeyCanSign = await contract.privileges(addressThree)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})

describe('Recovery complex tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully schedule and finalize a timelock transaction with the same signature but fail on the third txn', async function () {
    assertion.expectExpects(4)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)

    // schedule
    const scheduleTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, scheduleTxn)
    const receipt = await scheduleTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())

    // Finalize. If recovery is not ready yet, try again 5 times.
    // With a recovery locktime of 1 second, it should happen
    // within this timeframe
    let finalizeTxn
    let tryToFinalize = 5
    while (tryToFinalize > 0) {
      try {
        finalizeTxn = await contract.execute(recoveryTxns, ambireSignature)
        break
      } catch (e: any) {
        tryToFinalize--
        await new Promise(r => setTimeout(r, 1010)) //sleep
      }
    }

    await wait(wallet, finalizeTxn)
    const recoveryFinalized = await contract.scheduledRecoveries(msgHash)
    expect(recoveryFinalized.toString()).to.equal('0')
    const newKeyCanSign = await contract.privileges(addressThree)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

    // try to schedule but fail because the nonce has moved up
    try {
      await contract.execute(recoveryTxns, ambireSignature)
    } catch (error: any) {
      expect(error.reason).to.equal('RECOVERY_NOT_AUTHORIZED')
    }
  })
  it('successfully cancels a recovery transaction', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressFour)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )    
    const s = wrapEthSign(await wallet2.signMessage(ethers.getBytes(msgHash)))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)

    const confirmNoScheduled = await contract.scheduledRecoveries(msgHash)
    expect(confirmNoScheduled.toString()).to.equal('0')

    // schedule
    const scheduleTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, scheduleTxn)
    const receipt = await scheduleTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())

    // cancel
    await new Promise(r => setTimeout(r, 500)) //sleep
    const cancelHash = ethers.keccak256(abiCoder.encode(['bytes32', 'uint'], [msgHash, '0x63616E63']))
    const cancelSig = wrapEthSign(await wallet2.signMessage(ethers.getBytes(cancelHash)))
    const cancelSignature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        cancelSig,
        timelockAddress
      ]
    )

    const wrapped = wrapCancel(cancelSignature)
    const cancelTxn = await contract.execute(recoveryTxns, wrapped)
    await wait(wallet, cancelTxn)
    const canceled = await contract.scheduledRecoveries(msgHash)
    expect(canceled.toString()).to.equal('0')
    const newKeyCanSign = await contract.privileges(addressFour)
    expect(newKeyCanSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
  })
  it('fails on trying to add unsigned transactions to finalize recovery after initial schedule', async function () {
    assertion.expectExpects(2)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)

    // schedule
    const scheduleTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, scheduleTxn)
    const receipt = await scheduleTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())

    // finalize
    const otherTxn = [addressTwo, 0, '0x00']
    const otherTxns = [...recoveryTxns, otherTxn]
    try {
      await await contract.execute(otherTxns, ambireSignature)
    } catch (error: any) {
      expect(error.reason).to.equal('RECOVERY_NOT_AUTHORIZED')
    }
  })
  it('should execute multiple after schedule, the first txn beign the recovery and the second being a random one with the signature from the recovered key', async function() {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const {timelockAddress} = getTimelockData()
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressTwo)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, resultTxn)
    const receipt = await resultTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())
    // make sure that currently, addressTwo doesn't have privileges
    const secondAddressCannotSign = await contract.privileges(addressTwo)
    expect(secondAddressCannotSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')

    // send funds to the contract
    await sendFunds(ambireAccountAddress, 1)

    // send a normal txn
    const normalTxns = [[addressFour, ethers.parseEther('0.01'), '0x00']]
    const incrementedNonce = nonce + ethers.toBigInt(1)
    const secondHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, incrementedNonce, normalTxns])
    )
    const secondMsg = ethers.getBytes(secondHash)
    const addressTwoSig = wrapEthSign(await wallet2.signMessage(secondMsg))
    const multiple = [
      [recoveryTxns, ambireSignature],
      [normalTxns, addressTwoSig],
    ]
    const balance = await provider.getBalance(ambireAccountAddress)
    const multipleTxn = await contract.executeMultiple(multiple)
    await wait(wallet, multipleTxn)
    const postBalance = await provider.getBalance(ambireAccountAddress)
    const sentAmount = balance - postBalance
    expect(sentAmount).to.equal(ethers.parseEther('0.01'))
  })
})

describe('Bigger timelock recovery tests', function() {
  it('fail on finalizing the recovery before the timelock', async function () {
    assertion.expectExpects(6)
    const twoMinutesTimelock = 120
    const recoveryInfo = [[addressOne, addressTwo], twoMinutesTimelock]
    const {contract} = await deployAmbireAccount(recoveryInfo)
    const {timelockAddress} = getTimelockData(recoveryInfo)
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressFour)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
      [
        'tuple(address[], uint)',
        'bytes',
        'address'
      ],
      [
        recoveryInfo,
        s,
        timelockAddress
      ]
    )
    const ambireSignature = wrapRecover(signature)

    // schedule
    const scheduleTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, scheduleTxn)
    const receipt = await scheduleTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + twoMinutesTimelock).toString())

    // try to execute immediatelly but fail because 2 minutes lock have not passed
    try {
      await contract.execute(recoveryTxns, ambireSignature)
    } catch (error: any) {
      expect(error.reason).to.equal('RECOVERY_NOT_READY')
    }
  })
})

// this test demonstrates a known issue: once a recovery is scheduled,
// the next transaction has to be the recovery finalization.
// if it's not, the scheduled recovery is locked in the contract forever
// as the contract nonce gets updated and we can no longer recover the hash
describe('Bricking Recovery', function() {
  it('recovery hash is made unaccessible forever by sending a normal transaction after scheduling a recovery', async function(){
    assertion.expectExpects(7)
    const {contract} = await deployAmbireAccount()
    const {timelockAddress} = getTimelockData()

    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, recoveryTxns])
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const signature = abiCoder.encode(
    [
        'tuple(address[], uint)',
        'bytes',
        'address'
    ],
    [
        recoveryInfo,
        s,
        timelockAddress
    ]
    )
    const ambireSignature = wrapRecover(signature)
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    await wait(wallet, resultTxn)
    const receipt = await resultTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const recovery = await contract.scheduledRecoveries(msgHash)
    expect(recovery.toString()).to.equal((block.timestamp + timelock).toString())

    // send funds to the contract
    await sendFunds(ambireAccountAddress, 1)

    // send a normal txn
    const otherTxns = [[addressFour, ethers.parseEther('0.01'), '0x00']]
    const secondHash = ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, otherTxns])
    )
    const secondMsg = ethers.getBytes(secondHash)
    const normalSign = wrapEthSign(await wallet.signMessage(secondMsg))
    const normalTxn = await contract.execute(otherTxns, normalSign)
    await wait(wallet, normalTxn)

    // can no longer finalize
    const reConfirmRecoveryThere = await contract.scheduledRecoveries(msgHash)
    expect(reConfirmRecoveryThere.toString()).to.equal((block.timestamp + timelock).toString())
    try {
      await contract.execute(recoveryTxns, ambireSignature)
    } catch (error: any) {
      expect(error.reason).to.equal('RECOVERY_NOT_AUTHORIZED')
    }
  })
})