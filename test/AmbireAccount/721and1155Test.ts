import { ethers } from 'hardhat'

import { addressOne, addressTwo, AmbireAccount, expect } from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

let ambireAccountAddress: string

describe('NFT 721 and 1155 tests original contract tests', () => {
  it('successfully deploys the ambire account', async () => {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: signer.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('should call onERC721Received and return its signature', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const result = await contract.onERC721Received(addressOne, addressTwo, 1, '0x00')
    const abi = ['function onERC721Received(address,address,uint256,bytes)']
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC721Received')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0x150b7a02')
  })
  it('should call onERC1155Received and return its signature', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const result = await contract.onERC1155Received(addressOne, addressTwo, 1, 2, '0x00')
    const abi = ['function onERC1155Received(address, address, uint256, uint256, bytes calldata)']
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155Received')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0xf23a6e61')
  })
  it('should call onERC1155BatchReceived and return its signature', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const result = await contract.onERC1155BatchReceived(
      addressOne,
      addressTwo,
      [1, 2],
      [3, 4],
      '0x00'
    )
    const abi = [
      'function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155BatchReceived')?.selector
    expect(result).to.equal(signature)
    expect(result).to.equal('0xbc197c81')
  })
})
