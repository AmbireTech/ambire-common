import { ethers } from "hardhat";
import { deployAmbireAccountHardhatNetwork } from "../implementations"

describe('Basic Ambire Account tests', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners();
    await deployAmbireAccountHardhatNetwork([{addr: signer.address, hash: true}])
  })
})