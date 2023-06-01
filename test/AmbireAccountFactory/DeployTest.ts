import { ethers } from 'ethers'
import {
  AmbireAccount,
  AmbireAccountFactory,
  wallet,
  wallet2,
  addressOne,
  addressTwo,
  chainId,
  expect,
  deploySalt,
  deployGasLimit,
  buildInfo,
  addressFour
} from '../config'
import { wait } from '../polling'
import { wrapEthSign } from '../ambireSign'
import { getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../../v2/libs/proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../implementations'
const abiCoder = new ethers.AbiCoder()

let factoryAddress: string
let factoryContract: any
let dummyBytecode: any

describe('AmbireAccountFactory tests', function(){
  it('deploys the factory', async function(){
    const contractFactory = new ethers.ContractFactory(AmbireAccountFactory.abi, AmbireAccountFactory.bytecode, wallet)
    const factory = await contractFactory.deploy(addressOne)
    await wait(wallet, factory)
    expect(await factory.getAddress()).to.not.be.null

    factoryAddress = await factory.getAddress()
    factoryContract = new ethers.BaseContract(factoryAddress, AmbireAccountFactory.abi, wallet)
  })
  it('deploys the ambire account via the factory; no revert upon redeploy to same address', async function(){
    const bytecode = AmbireAccount.bytecode
    const accountAddr = getAmbireAccountAddress(factoryAddress, bytecode)
    const factoryDeploy = await factoryContract.deploy(bytecode, deploySalt)
    await wait(wallet, factoryDeploy)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, wallet)
    const canSign = await ambireAccount.privileges(addressOne)
    expect(canSign).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')

    // just confirm that no reverts happen
    const reDeploy = await factoryContract.deploy(bytecode, deploySalt)
    await wait(wallet, reDeploy)
  })
  it('deploy the contract and execute a transaction along with the deploy', async function(){
    // take the correct bytecode
    const ambireAccountFactory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
    const contract: any = await ambireAccountFactory.deploy()
    await wait(wallet, contract)
    const bytecode = getProxyDeployBytecode(await contract.getAddress(), [{addr: addressTwo, hash: true}], {
      ...getStorageSlotsFromArtifact(buildInfo)
    })
    dummyBytecode = bytecode
    const ambireAccountAddress = getAmbireAccountAddress(factoryAddress, bytecode)

    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ addressOne, ethers.toBeHex(1, 32) ])
    const setPrivTxn = [[ambireAccountAddress, 0, calldata]]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, 0, setPrivTxn])
    ))
    const s = wrapEthSign(await wallet2.signMessage(msg))

    const factoryDeployAndExecute = await factoryContract.deployAndExecute(bytecode, deploySalt, setPrivTxn, s, { deployGasLimit })
    await wait(wallet, factoryDeployAndExecute)
    const ambireAccount: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const canSignOne = await ambireAccount.privileges(addressOne)
    expect(canSignOne).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
    const canSignTwo = await ambireAccount.privileges(addressTwo)
    expect(canSignTwo).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
  it('deploy and execute on an already deployed contract - it should execute the call', async function(){
    const accountAddr = getAmbireAccountAddress(factoryAddress, dummyBytecode)

    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ addressFour, ethers.toBeHex(1, 32) ])
    const setPrivTxn = [[accountAddr, 0, calldata]]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [accountAddr, chainId, 1, setPrivTxn])
    ))
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const factoryDeployAndExecute = await factoryContract.deployAndExecute(dummyBytecode, deploySalt, setPrivTxn, s)
    await wait(wallet, factoryDeployAndExecute)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, wallet)
    const canSignTwo = await ambireAccount.privileges(addressFour)
    expect(canSignTwo).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})