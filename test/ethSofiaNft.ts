import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers } from 'hardhat'

describe('eth sofia nft', () => {
  let nftContract: any
  let signer: any
  let signer2: any
  beforeEach('successfully deploys the ambire account', async () => {
    ;[signer, signer2] = await ethers.getSigners()
    const NftContract = await ethers.getContractFactory('EthSofiaNft')
    nftContract = await NftContract.deploy()

    await nftContract.setBaseUri('https://nftmeta.ambire.com/eth-sofia')
  })
  it('Basic functionality', async () => {
    await expect(nftContract.ownerOf(0)).revertedWith('ERC721: invalid token ID')
    await expect(nftContract.ownerOf(1)).revertedWith('ERC721: invalid token ID')

    await expect(
      nftContract.connect(signer2).batchMint([signer.address, signer2.address])
    ).revertedWith('Ownable: caller is not the owner')

    const randomAddress = Wallet.createRandom().address
    await nftContract.batchMint([signer.address, signer2.address])
    await nftContract.batchMint([randomAddress])

    expect(await nftContract.ownerOf(0)).eq(signer.address)
    expect(await nftContract.ownerOf(1)).eq(signer2.address)
    expect(await nftContract.ownerOf(2)).eq(randomAddress)

    expect(await nftContract.tokenURI(0)).eq('https://nftmeta.ambire.com/eth-sofia')
    await nftContract.setBaseUri('random data')
    expect(await nftContract.tokenURI(0)).eq('random data')
  })
})
