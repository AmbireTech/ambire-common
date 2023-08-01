import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import fs from 'fs'
import { promisify } from 'util'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

let ambireContract: any
let ambireAddress: any

function getSetDKIMTxn(keySelector: any, exponent: any, modulus: any) {
  const setDKIMAbi = ['function setDKIMKey(bytes calldata keySelector, bytes calldata exponent, bytes calldata modulus)']
  const iface = new ethers.Interface(setDKIMAbi)
  const calldata = iface.encodeFunctionData('setDKIMKey', [keySelector, exponent, modulus])
  return [ambireAddress, 0, calldata]
}

describe('DKIM', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccount, ambireAccountAddress } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireContract = ambireAccount
    ambireAddress = ambireAccountAddress
  })
  it('successfully parses a gmail email and verify it through the library', async function () {
    const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
        encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const selector = ethers.hexlify(ethers.toUtf8Bytes(parsedContents[0].selector))

    const rsasha256 = await ethers.deployContract('RSASHA256')

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
    const abiFunc = ['function verify(bytes32 hash, bytes calldata sig, bytes calldata exponent, bytes calldata modulus) external view returns (bool)']
    const iface = new ethers.Interface(abiFunc)
    const calldata = iface.encodeFunctionData('verify', [hash, dkimSig, exponent, modulus])
    const isValid = await provider.call({
      to: await rsasha256.getAddress(),
      data: calldata
    })
    expect(isValid).to.equal(ethers.toBeHex(1, 32))
  })

  it('successfully parses a gmail email and verify it onchain', async function () {
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
    })
    const validator = await contractFactory.deploy()

    const [signer] = await ethers.getSigners()
    const abiCoder = new ethers.AbiCoder()
    const exponent = ethers.toBeHex(parsedContents[0].exponent)
    const modulus = parsedContents[0].solidity.modulus
    const dkimSig = parsedContents[0].solidity.signature
    const hash = parsedContents[0].solidity.hash
    const sig = abiCoder.encode(['bytes', 'tuple(bytes, bytes)', 'bytes', 'address', 'bytes32'], [
      selector,
      [exponent, modulus],
      dkimSig,
      signer.address,
      hash,
    ])

    // set the DKIM
    const txn = await ambireContract.executeBySender([getSetDKIMTxn(selector, exponent, modulus)])
    const dkimBytecode = await ambireContract.getDKIMKey()
    expect(dkimBytecode[0]).to.equal(selector)
    expect(dkimBytecode[1][0]).to.equal(exponent)
    expect(dkimBytecode[1][1]).to.equal(modulus)

    const provider = ethers.provider
    const abiFunc = ['function validateSig(address accountAddr, bytes calldata data, bytes calldata sig, uint nonce, tuple(address, uint256, bytes)[] calldata calls) external returns (bool shouldExecute)']
    const iface = new ethers.Interface(abiFunc)
    const calldata = iface.encodeFunctionData('validateSig', [
      ambireAddress, '0x00', sig, 1, []
    ])
    const isValid = await provider.call({
      to: await validator.getAddress(),
      data: calldata
    })
    expect(isValid).to.equal(ethers.toBeHex(1, 32))
  })
})
