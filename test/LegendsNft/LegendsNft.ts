import '@nomicfoundation/hardhat-chai-matchers'

import { expect } from 'chai'
import { hexlify } from 'ethers'
import { ethers } from 'hardhat'

describe('Legends nft', () => {
  let legendsNftContract: any
  let signer: any
  let signer2: any
  beforeEach('successfully deploys the ambire account', async () => {
    ;[signer, signer2] = await ethers.getSigners()
    const LegendsNftContract = await ethers.getContractFactory('LegendsNFT')
    legendsNftContract = await LegendsNftContract.deploy()

    await legendsNftContract.setBaseUri('random data')
    await legendsNftContract.setBaseUri('https://staging-relayer.ambire.com/legends/nft-meta/')
  })
  it('token mint', async () => {
    expect(await legendsNftContract.balanceOf(signer.address)).eq(0)
    await expect(legendsNftContract.mint(1)).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.mint(1)).to.be.revertedWith('ERC721: token already minted')
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.connect(signer2).mint(2)).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer2.address)).eq(1)
  })

  it('tokenURI', async () => {
    await legendsNftContract.mint(1)
    expect(await legendsNftContract.tokenURI(BigInt(signer.address))).eq(
      `https://staging-relayer.ambire.com/legends/nft-meta/${signer.address.toLowerCase()}`
    )
  })

  it('set base uri not owner', async () => {
    await expect(legendsNftContract.connect(signer2).setBaseUri('')).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('try to transfer or approve', async () => {
    await legendsNftContract.mint(2)
    await legendsNftContract.connect(signer2).mint(2)

    await expect(
      legendsNftContract.transferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.safeTransferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract['safeTransferFrom(address,address,uint256,bytes)'](
        signer.address,
        signer2.address,
        BigInt(signer.address),
        ethers.toUtf8Bytes('asd')
      )
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.approve(signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot approve token transfer')

    await expect(legendsNftContract.setApprovalForAll(signer2.address, true)).to.be.revertedWith(
      'Soulbound: cannot set approval for all'
    )

    await legendsNftContract.setAllowTransfer(true)
    await expect(
      legendsNftContract.connect(signer2).burn(BigInt(signer.address))
    ).to.be.revertedWith('You cannot burn this NFT.')

    await legendsNftContract.burn(BigInt(signer.address))
    await legendsNftContract.burn(BigInt(signer2.address))
    await expect(legendsNftContract.ownerOf(BigInt(signer.address))).to.be.revertedWith(
      'ERC721: invalid token ID'
    )
    await expect(legendsNftContract.ownerOf(BigInt(signer2.address))).to.be.revertedWith(
      'ERC721: invalid token ID'
    )
    await legendsNftContract.mint(2)
    expect(await legendsNftContract.ownerOf(BigInt(signer.address))).eq(signer.address)
  })
  it('opensea update', async () => {
    const supportsInterface721 = await legendsNftContract.supportsInterface(hexlify('0x80ac58cd'))
    const supportsInterface721Enumerable = await legendsNftContract.supportsInterface(
      hexlify('0x780e9d63')
    )
    const supportsInterface4906 = await legendsNftContract.supportsInterface(hexlify('0x49064906'))
    expect(supportsInterface721).eq(true)
    expect(supportsInterface721Enumerable).eq(true)
    expect(supportsInterface4906).eq(true)
    const tx = await legendsNftContract.updateOpenSeaInfo(
      0n,
      115792089237316195423570985008687907853269984665640564039457584007913129639935n
    )
    const { logs } = await tx.wait()
    expect(logs.length).to.eq(1)
    expect(logs[0].address).to.eq(legendsNftContract.target)
    expect(logs[0].args[0]).to.eq(0n)
    expect(logs[0].args[1]).to.eq(
      115792089237316195423570985008687907853269984665640564039457584007913129639935n
    )
    expect(logs[0].fragment.name).to.eq('BatchMetadataUpdate')
  })
})
