import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import fs from 'fs'
import { promisify } from 'util'
import { ethers } from 'hardhat'
import { expect } from 'chai'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

describe('DKIM', function () {
  it('successfully parses a gmail email', async function () {
    const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
        encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const selector = ethers.hexlify(ethers.toUtf8Bytes(parsedContents[0].selector))

    const rsasha256 = await ethers.deployContract('RSASHA256')
    const contractFactory = await ethers.getContractFactory("DKIMValidator", {
      libraries: {
        RSASHA256: await rsasha256.getAddress(),
      },
    });
    const validator = await contractFactory.deploy()

    const [signer] = await ethers.getSigners()
    const abiCoder = new ethers.AbiCoder()
    const exponent = ethers.toBeHex(parsedContents[0].exponent)
    const modulus = parsedContents[0].solidity.modulus
    const dkimSig = parsedContents[0].solidity.signature
    const hash = parsedContents[0].solidity.hash
    const sig = abiCoder.encode(['tuple(bytes, tuple(bytes, bytes))', 'bytes', 'address', 'bytes32'], [
      [selector, [exponent, modulus]],
      dkimSig,
      signer.address,
      hash,
    ])
    const provider = ethers.provider
    const abiFunc = ['function validateSig(address accountAddr, bytes calldata data, bytes calldata sig, uint nonce, tuple(address, uint256, bytes)[] calldata calls) external returns (bool shouldExecute)']
    const iface = new ethers.Interface(abiFunc)
    const calldata = iface.encodeFunctionData('validateSig', [
      signer.address, '0x00', sig, 1, []
    ])
    const isValid = await provider.call({
      to: await validator.getAddress(),
      data: calldata
    })
    expect(isValid).to.equal(ethers.toBeHex(1, 32))
  })
})
