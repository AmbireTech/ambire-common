import { ethers } from 'hardhat'
import {
  AmbireAccount,
  addressOne,
  addressTwo,
  chainId,
  expect,
  deploySalt,
  deployGasLimit,
  buildInfo,
  addressFour
} from '../config'
import { wrapEthSign } from '../ambireSign'
import {
  getProxyDeployBytecode,
  getStorageSlotsFromArtifact
} from '../../src/libs/proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../implementations'
const abiCoder = new ethers.AbiCoder()

let factoryAddress: string
let factoryContract: any
let dummyBytecode: any

describe('AmbireAccountFactory tests', function () {
  it('deploys the factory', async function () {
    const [signer] = await ethers.getSigners()
    const factory = await ethers.deployContract('AmbireAccountFactory', [signer.address])
    factoryAddress = await factory.getAddress()
    factoryContract = factory
  })
  it('deploys the ambire account via the factory; no revert upon redeploy to same address', async function () {
    const [signer] = await ethers.getSigners()
    const bytecode = AmbireAccount.bin
    const accountAddr = getAmbireAccountAddress(factoryAddress, bytecode)
    await factoryContract.deploy(bytecode, deploySalt)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, signer)
    const canSign = await ambireAccount.privileges(addressOne)
    expect(canSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')

    // just confirm that no reverts happen
    await factoryContract.deploy(bytecode, deploySalt)
  })
  it('deploy the contract and execute a transaction along with the deploy', async function () {
    const [signer, signer2] = await ethers.getSigners()
    const contract = await ethers.deployContract('AmbireAccount')
    const bytecode = getProxyDeployBytecode(
      await contract.getAddress(),
      [{ addr: addressTwo, hash: true }],
      {
        ...getStorageSlotsFromArtifact(buildInfo)
      }
    )
    dummyBytecode = bytecode
    const ambireAccountAddress = getAmbireAccountAddress(factoryAddress, bytecode)

    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [
      addressOne,
      ethers.toBeHex(1, 32)
    ])
    const setPrivTxn = [[ambireAccountAddress, 0, calldata]]
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [ambireAccountAddress, chainId, 0, setPrivTxn]
        )
      )
    )
    const s = wrapEthSign(await signer2.signMessage(msg))

    await factoryContract.deployAndExecute(
      bytecode,
      deploySalt,
      setPrivTxn,
      s,
      { deployGasLimit }
    )
    const ambireAccount: any = new ethers.BaseContract(
      ambireAccountAddress,
      AmbireAccount.abi,
      signer
    )
    const canSignOne = await ambireAccount.privileges(addressOne)
    expect(canSignOne).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    )
    const canSignTwo = await ambireAccount.privileges(addressTwo)
    expect(canSignTwo).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    )
  })
  it('deploy and execute on an already deployed contract - it should execute the call', async function () {
    const [signer, signer2] = await ethers.getSigners()
    const accountAddr = getAmbireAccountAddress(factoryAddress, dummyBytecode)

    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [
      addressFour,
      ethers.toBeHex(1, 32)
    ])
    const setPrivTxn = [[accountAddr, 0, calldata]]
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [accountAddr, chainId, 1, setPrivTxn]
        )
      )
    )
    const s = wrapEthSign(await signer2.signMessage(msg))
    await factoryContract.deployAndExecute(
      dummyBytecode,
      deploySalt,
      setPrivTxn,
      s
    )
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, signer)
    const canSignTwo = await ambireAccount.privileges(addressFour)
    expect(canSignTwo).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    )
  })
})
