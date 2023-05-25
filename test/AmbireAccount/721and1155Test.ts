import { ethers } from 'ethers'
import {
  AmbireAccount,
  wallet,
  addressOne,
  addressTwo,
  expect,
} from '../config'
import { wait } from '../polling'

let ambireAccountAddress: string
async function deployAmbireAccount() {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract: any = await factory.deploy([addressOne])
  await wait(wallet, contract)
  expect(await contract.getAddress()).to.not.be.null
  const isSigner = await contract.privileges(addressOne)
  expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

describe('NFT 721 and 1155 tests original contract tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('should call onERC721Received and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC721Received(addressOne, addressTwo, 1, '0x00')
    const abi = [
      'function onERC721Received(address,address,uint256,bytes)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC721Received')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0x150b7a02')
  })
  it('should call onERC1155Received and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC1155Received(addressOne, addressTwo, 1, 2, '0x00')
    const abi = [
      'function onERC1155Received(address, address, uint256, uint256, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155Received')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0xf23a6e61')
  })
  it('should call onERC1155BatchReceived and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC1155BatchReceived(addressOne, addressTwo, [1,2], [3,4], '0x00')
    const abi = [
      'function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155BatchReceived')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0xbc197c81')
  })
})