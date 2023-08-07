import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import lookup from '../../src/libs/dns/lookup'

let ambireAccountAddress: string

describe('DKIM', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('makes a lookup', async function () {
    const result = await lookup()
    console.log(result)
  })
})
