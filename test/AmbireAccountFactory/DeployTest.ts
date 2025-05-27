import { ethers } from 'hardhat'

import { keccak256, toUtf8Bytes } from 'ethers'
import { getProxyDeployBytecode } from '../../src/libs/proxyDeploy/deploy'
import { getExecute712Data, wrapEIP712 } from '../ambireSign'
import {
  addressFour,
  addressOne,
  addressTwo,
  AmbireAccount,
  chainId,
  deployGasLimit,
  deploySalt,
  expect
} from '../config'
import { getAmbireAccountAddress } from '../implementations'

const abiCoder = new ethers.AbiCoder()

let factoryAddress: string
let factoryContract: any
let dummyBytecode: any

describe('AmbireFactory tests', () => {
  it('deploys the factory', async () => {
    const [signer] = await ethers.getSigners()
    const factory = await ethers.deployContract('AmbireFactory', [signer.address])
    factoryAddress = await factory.getAddress()
    factoryContract = factory
  })
  it('deploys the ambire account via the factory; no revert upon redeploy to same address', async () => {
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
  it('deploy the contract and execute a transaction along with the deploy', async () => {
    const [signer, signer2] = await ethers.getSigners()
    const contract = await ethers.deployContract('AmbireAccount')
    const bytecode = getProxyDeployBytecode(
      await contract.getAddress(),
      [
        {
          addr: addressTwo,
          hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
        }
      ],
      {
        privSlot: `${keccak256(toUtf8Bytes('ambire.smart.contracts.storage'))}`
      }
    )
    dummyBytecode = bytecode
    const ambireAccountAddress = getAmbireAccountAddress(factoryAddress, bytecode)

    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [
      addressOne,
      ethers.toBeHex(2, 32)
    ])
    const setPrivTxn: [string, string, string] = [ambireAccountAddress, '0', calldata]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, 0, [setPrivTxn]]
      )
    )
    const typedData = getExecute712Data(
      chainId,
      0n,
      [setPrivTxn],
      ambireAccountAddress,
      executeHash
    )
    const s = wrapEIP712(
      await signer2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )

    await factoryContract.deployAndExecute(bytecode, deploySalt, [setPrivTxn], s, {
      deployGasLimit
    })
    const ambireAccount: any = new ethers.BaseContract(
      ambireAccountAddress,
      AmbireAccount.abi,
      signer
    )
    const canSignOne = await ambireAccount.privileges(addressOne)
    expect(canSignOne).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    )
    const canSignTwo = await ambireAccount.privileges(addressTwo)
    expect(canSignTwo).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    )
  })
  it('deploy and execute on an already deployed contract - it should execute the call', async () => {
    const [signer, signer2] = await ethers.getSigners()
    const accountAddr = getAmbireAccountAddress(factoryAddress, dummyBytecode)

    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [
      addressFour,
      ethers.toBeHex(2, 32)
    ])
    const setPrivTxn: [string, string, string] = [accountAddr, '0', calldata]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [accountAddr, chainId, 1, [setPrivTxn]]
      )
    )
    const typedData = getExecute712Data(chainId, 1n, [setPrivTxn], accountAddr, executeHash)
    const s = wrapEIP712(
      await signer2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    await factoryContract.deployAndExecute(dummyBytecode, deploySalt, [setPrivTxn], s)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, signer)
    const canSignTwo = await ambireAccount.privileges(addressFour)
    expect(canSignTwo).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    )
  })
})
