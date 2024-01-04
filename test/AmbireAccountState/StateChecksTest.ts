import { ethers } from 'hardhat'
import {
  abiCoder,
  addressOne,
  expect,
} from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { ERC_4337_ENTRYPOINT } from '../../src/consts/deploy'
import { getAccountDeployParams } from '../../src/libs/account/account'

let ambireAccountAddress: string
let factoryAddr: any
let addrBytecode: any
let salt: any

describe('Account state checks tests', function () {
  it('should successfully deploy the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr, factoryAddress, bytecode, deploySalt } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: '0x0000000000000000000000000000000000000000000000000000000000000001' }
    ])
    ambireAccountAddress = addr
    factoryAddr = factoryAddress
    addrBytecode = bytecode
    salt = deploySalt
  })
  
  it('should call ambireV2Check with a v2 address and confirm it return 01 as hex', async function () {
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
    expect(deploylessResult).to.equal(ethers.toBeHex(1, 32))
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
  it('should call getAccountsState with a v2 address and confirm everything works', async function () {
    const [signer] = await ethers.getSigners()

    const account = {
      addr: ambireAccountAddress,
      associatedKeys: [signer.address],
      creation: {
        factoryAddr,
        bytecode: addrBytecode,
        salt
      }
    }
    const accounts = [account]
    const args = accounts.map((account) => [
      account.addr,
      account.associatedKeys,
      ...getAccountDeployParams(account),
      ERC_4337_ENTRYPOINT
    ])

    const abi = ['function getAccountsState(tuple(address, address[], address, bytes, address)[]) external']
    const iface = new ethers.Interface(abi)
    const callData = iface.encodeFunctionData('getAccountsState', [args])

    const AmbireAccountState = await ethers.deployContract("AmbireAccountState");
    const result = await signer.call({
      to: await AmbireAccountState.getAddress(),
      data: callData,
    })
    const decoded = abiCoder.decode(['tuple(bool, bytes, uint, bytes32[], bool, uint256, bool, uint)[]'], result)[0]
    expect(decoded.length).to.equal(1)
    decoded.map((oneAcc: any) => {
      expect(oneAcc[0]).to.equal(true)
      expect(oneAcc[1]).to.equal('0x')
      expect(oneAcc[2]).to.equal(0n)
      expect(oneAcc[3].length).to.equal(1)
      oneAcc[3].map((priv: any) => expect(priv).to.equal(ethers.toBeHex(1, 32)))
      expect(oneAcc[4]).to.equal(true)
      expect(oneAcc[5]).to.equal(0n)
      expect(oneAcc[6]).to.equal(false)
      expect(oneAcc[7]).to.be.greaterThan(100000n)
    })
  })
})
