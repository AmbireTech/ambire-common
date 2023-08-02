import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import fs from 'fs'
import { promisify } from 'util'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { getPriviledgeTxn, getTimelockData } from '../helpers'
import { wrapEthSign } from '../ambireSign'
import { abiCoder } from '../config'
import lookup from '../../src/libs/dkim/dnsLookup'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')
const SignedSet = require('@ensdomains/dnsprovejs').SignedSet

let ambireContract: any
let ambireAddress: any

function getSetDKIMTxn(keySelector: any, exponent: any, modulus: any) {
  const setDKIMAbi = ['function setDKIMKey(bytes calldata keySelector, bytes calldata exponent, bytes calldata modulus)']
  const iface = new ethers.Interface(setDKIMAbi)
  const calldata = iface.encodeFunctionData('setDKIMKey', [keySelector, exponent, modulus])
  return [ambireAddress, 0, calldata]
}

function getSetEmailFromTxn(email: string) {
  const setEmailFrom = ['function setEmailFrom(string calldata email)']
  const iface = new ethers.Interface(setEmailFrom)
  const calldata = iface.encodeFunctionData('setEmailFrom', [email])
  return [ambireAddress, 0, calldata]
}

async function deployDnsSec() {
  const contract = await ethers.deployContract('DNSSECImpl', ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d00002b000100000e10000404fefdfd'])

  const rsaSha256 = await ethers.deployContract('RSASHA256Algorithm')
  await contract.setAlgorithm(8, await rsaSha256.getAddress())

  const p256SHA256Algorithm = await ethers.deployContract('P256SHA256Algorithm')
  await contract.setAlgorithm(13, await p256SHA256Algorithm.getAddress())

  const digest = await ethers.deployContract('SHA256Digest')
  await contract.setDigest(2, await digest.getAddress())

  return contract;
}

function hexEncodeSignedSet(rrs: any, sig: any) {
  const ss = new SignedSet(rrs, sig)
  return [ss.toWire(), ss.signature.data.signature]
}

describe('DKIM', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { hash, timelockAddress } = getTimelockData()
    const { ambireAccount, ambireAccountAddress } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true },
      { addr: timelockAddress, hash: hash }
    ])
    ambireContract = ambireAccount
    ambireAddress = ambireAccountAddress
  })
  it('successfully parses a gmail email and verify it through the library', async function () {
    const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
        encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)

    const rsasha256 = await ethers.deployContract('RSASHA256')

    const exponent = ethers.toBeHex(parsedContents[0].exponent)
    const modulus = parsedContents[0].solidity.modulus
    const dkimSig = parsedContents[0].solidity.signature
    const hash = parsedContents[0].solidity.hash
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
    const gmail = await readFile(path.join(emailsPath, 'to-myself.eml'), {
        encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const dkimSelectorNoHex = parsedContents[0].selector
    const dkimSelector = ethers.hexlify(ethers.toUtf8Bytes(dkimSelectorNoHex))

    const rsasha256 = await ethers.deployContract('RSASHA256')
    const contractFactory = await ethers.getContractFactory("DKIMValidator", {
      libraries: {
        RSASHA256: await rsasha256.getAddress(),
      },
    })
    const validator = await contractFactory.deploy()

    const [signer, signerTwo, signerThree] = await ethers.getSigners()

    // sign with timelocked signer
    const txns = [getPriviledgeTxn(ambireAddress, signerThree.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAddress, 31337, 0, txns]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondarySig = wrapEthSign(await signerTwo.signMessage(msg))

    const exponent = ethers.toBeHex(parsedContents[0].exponent)
    const modulus = parsedContents[0].solidity.modulus
    const dkimSig = parsedContents[0].solidity.signature
    const processedHeader = parsedContents[0].processedHeader
    // bytes, bytes, bytes, address, string
    const sig = abiCoder.encode(['bytes', 'bytes', 'bytes', 'address', 'string'], [
      dkimSelector,
      dkimSig,
      secondarySig,
      signerThree.address,
      processedHeader,
    ])

    // set the DKIM
    const email = 'borislavdevlabs@gmail.com'
    await ambireContract.executeBySender([
      getSetDKIMTxn(dkimSelector, exponent, modulus),
      getSetEmailFromTxn(email),
    ])
    const dkimBytecode = await ambireContract.getAccountInfo()
    expect(dkimBytecode[0][0]).to.equal(dkimSelector)
    expect(dkimBytecode[0][1][0]).to.equal(exponent)
    expect(dkimBytecode[0][1][1]).to.equal(modulus)
    expect(dkimBytecode[1]).to.equal(email)

    const provider = ethers.provider
    const abiFunc = ['function validateSig(address accountAddr, bytes calldata data, bytes calldata sig, uint nonce, tuple(address, uint256, bytes)[] calldata calls) external returns (bool shouldExecute)']
    const iface = new ethers.Interface(abiFunc)
    const recoveryData = abiCoder.encode(['tuple(address[], uint256)'], [[[signer.address, signerTwo.address], 1]]);
    const calldata = iface.encodeFunctionData('validateSig', [
      ambireAddress, recoveryData, sig, 0, txns
    ])
    const isValid = await provider.call({
      to: await validator.getAddress(),
      data: calldata
    })
    expect(isValid).to.equal(ethers.toBeHex(1, 32))
  })
  it('successfully upload the dnssec contract and validate ambire\'s dns', async function () {
    const signedSetsData = await lookup('Google', 'Ambire.com')
    const rrsets = signedSetsData.proofs.map(({records, signature}: any) => {
      return hexEncodeSignedSet(records, signature)
    })
    
    const dnsSecContract = await deployDnsSec()
    const address = await dnsSecContract.getAddress()
    expect(address).to.not.be.null

    const { rrs } = await dnsSecContract.verifyRRSet(rrsets)

    // do the final check
    const records = Buffer.from(ethers.hexlify(rrsets[rrsets.length - 1][0]).slice(2), 'hex')
    const sig = Buffer.from(ethers.hexlify(rrsets[rrsets.length - 1][1]).slice(2), 'hex')
    const combinedHex = `0x${SignedSet.fromWire(records, sig).toWire(false).toString('hex')}`
    expect(rrs).to.equal(combinedHex)
  })
})
