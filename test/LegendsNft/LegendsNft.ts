import { expect } from 'chai'
import { ethers } from 'hardhat'

describe('Legends nft', () => {
  let legendsNftContract: any
  let signer: any
  let signer2: any
  beforeEach('successfully deploys the ambire account', async () => {
    ;[signer, signer2] = await ethers.getSigners()
    legendsNftContract = await ethers.deployContract('LegendsNFT')
    await legendsNftContract.setBaseUri('https://relayer.ambire.com/')
  })
  it('token mint', async () => {
    expect(await legendsNftContract.balanceOf(signer.address)).eq(0)
    await expect(legendsNftContract.mint()).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.mint()).to.be.revertedWith('ERC721: token already minted')
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.connect(signer2).mint()).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer2.address)).eq(1)
  })

  it('tokenURI', async () => {
    await legendsNftContract.mint()
    expect(await legendsNftContract.tokenURI(BigInt(signer.address))).eq(
      `https://relayer.ambire.com/${signer.address.toLowerCase()}`
    )
  })

  it('set base uri not owner', async () => {
    await expect(legendsNftContract.connect(signer2).setBaseUri('')).to.be.rejectedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('try to transfer or approve', async () => {
    await legendsNftContract.mint()
    await legendsNftContract.connect(signer2).mint()

    await expect(
      legendsNftContract.transferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.rejectedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.safeTransferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.rejectedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract['safeTransferFrom(address,address,uint256,bytes)'](
        signer.address,
        signer2.address,
        BigInt(signer.address),
        ethers.toUtf8Bytes('asd')
      )
    ).to.be.rejectedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.approve(signer2.address, BigInt(signer.address))
    ).to.be.rejectedWith('Soulbound: cannot approve token transfer')

    await expect(legendsNftContract.setApprovalForAll(signer2.address, true)).to.be.rejectedWith(
      'Soulbound: cannot set approval for all'
    )
  })
})
