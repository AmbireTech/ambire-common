import { ethers } from 'hardhat'
import {
  AmbireAccount,
  abiCoder,
  addressOne,
  addressThree,
  addressTwo,
  expect,
  provider
} from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { getPriviledgeTxn, getTimelockData } from '../helpers'
import { wrapEthSign, wrapRecover } from '../ambireSign'

let ambireAccountAddress: string
const timelock = 120 // a 1 second timelock default
const recovery = [[addressOne, addressTwo], timelock]
let blockTimestamp = 0

describe('Account state checks tests', function () {
  it('should successfully deploys the ambire account and the account state', async function () {
    const [signer] = await ethers.getSigners()
    const { hash, timelockAddress } = getTimelockData(recovery)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true },
      { addr: timelockAddress, hash: hash }
    ])
    ambireAccountAddress = addr
  })
  it('should call ambireV2Check with a v2 address and confirm it returns a zero', async function () {
    const [signer] = await ethers.getSigners()

    const abi = ['function ambireV2Check(address account) external returns (uint)']
    const iface = new ethers.Interface(abi)
    const callData = iface.encodeFunctionData('ambireV2Check', [ambireAccountAddress])

    const AmbireAccountState = await ethers.getContractFactory("AmbireAccountState");
    const Deployless = await ethers.getContractFactory("Deployless");
      const bytecode = ethers.hexlify(
        ethers.concat([
          Deployless.bytecode,
          Deployless.interface.encodeDeploy([AmbireAccountState.bytecode, callData])
        ])
    )
    const deploylessResult = await signer.call({
      data: bytecode
    })
    expect(deploylessResult).to.equal(ethers.toBeHex(0, 32))
  })
  it('should call ambireV2Check with a random address and confirm it reverts', async function () {
    const [signer] = await ethers.getSigners()

    const abi = ['function ambireV2Check(address account) external returns (uint)']
    const iface = new ethers.Interface(abi)
    const callData = iface.encodeFunctionData('ambireV2Check', [addressOne])

    const AmbireAccountState = await ethers.getContractFactory("AmbireAccountState");
    const Deployless = await ethers.getContractFactory("Deployless");
      const bytecode = ethers.hexlify(
        ethers.concat([
          Deployless.bytecode,
          Deployless.interface.encodeDeploy([AmbireAccountState.bytecode, callData])
        ])
    )
    const deploylessResult = await signer.call({
      data: bytecode
    })
    expect(deploylessResult).to.equal('0x')
  })
  it('should return empty recoveries if none are scheduled', async function () {
    const [signer] = await ethers.getSigners()
    const { hash } = getTimelockData(recovery)

    const abi = ['function getScheduledRecoveries(address account, address[] memory associatedKeys, bytes32 privValue) public returns (uint[] memory scheduledRecoveries)']
    const iface = new ethers.Interface(abi)
    const callData = iface.encodeFunctionData('getScheduledRecoveries', [
      ambireAccountAddress,
      [addressThree],
      hash
    ])

    const AmbireAccountState = await ethers.getContractFactory("AmbireAccountState");
    const Deployless = await ethers.getContractFactory("Deployless");
      const bytecode = ethers.hexlify(
        ethers.concat([
          Deployless.bytecode,
          Deployless.interface.encodeDeploy([AmbireAccountState.bytecode, callData])
        ])
    )
    const deploylessResult = await signer.call({
      data: bytecode
    })
    const res = abiCoder.decode(['uint[]'], deploylessResult)[0]
    expect(res[0]).to.equal(0n)
  })
  it('successfully schedule a timelock transaction', async function () {
    const [signer, signer2] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const { hash, timelockAddress } = getTimelockData(recovery)
    const nonce = await contract.nonce()
    const recoveryTxns = [getPriviledgeTxn(ambireAccountAddress, addressThree)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, 31337, nonce, recoveryTxns]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const s = wrapEthSign(await signer2.signMessage(msg))
    const signature = abiCoder.encode(
      ['tuple(address[], uint)', 'bytes', 'address'],
      [recovery, s, timelockAddress]
    )
    const ambireSignature = wrapRecover(signature)
    const resultTxn = await contract.execute(recoveryTxns, ambireSignature)
    const receipt = await resultTxn.wait()
    const block: any = await provider.getBlock(receipt.blockNumber)
    const hasRecovery = await contract.scheduledRecoveries(msgHash)
    blockTimestamp = block.timestamp
    expect(hasRecovery.toString()).to.equal((blockTimestamp + timelock).toString())
  })
  it('should return the hash of the scheduled recovery', async function () {
    const [signer] = await ethers.getSigners()

    const abi = ['function getScheduledRecoveries(address account, address[] memory associatedKeys, bytes32 privValue) public returns (uint[] memory scheduledRecoveries)']
    const iface = new ethers.Interface(abi)
    const callData = iface.encodeFunctionData('getScheduledRecoveries', [
      ambireAccountAddress,
      [addressThree],
      ethers.toBeHex(1, 32)
    ])

    const AmbireAccountState = await ethers.getContractFactory("AmbireAccountState");
    const Deployless = await ethers.getContractFactory("Deployless");
      const bytecode = ethers.hexlify(
        ethers.concat([
          Deployless.bytecode,
          Deployless.interface.encodeDeploy([AmbireAccountState.bytecode, callData])
        ])
    )
    const deploylessResult = await signer.call({
      data: bytecode
    })
    const abiCoder = new ethers.AbiCoder()
    const res = abiCoder.decode(['uint[]'], deploylessResult)[0]
    expect(res[0]).to.equal((blockTimestamp + timelock).toString())
  })
})
