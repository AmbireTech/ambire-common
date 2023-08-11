import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { abiCoder, expect } from '../config'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated } from '../ambireSign'
import { getPriviledgeTxn } from '../helpers'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

function getValidatorData(parsedContents: any, signer: any) {
  return abiCoder.encode([
    'tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'
    ,
  ], [[
    'borislavdevlabs@gmail.com',
    'borislav.ickov@gmail.com',
    parsedContents[0].selector,
    ethers.hexlify(parsedContents[0].modulus),
    ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
    signer.address,
    false,
    0,
    0,
    false,
    false,
    0,
  ]])
}

function getSignerKey(validatorAddr: any, validatorData: any) {
  const hash = ethers.keccak256(abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData]))
  const signerKey = `0x${hash.slice(hash.length - 40, hash.length)}`
  return {signerKey, hash}
}

let dkimRecovery: any
let ambireAccountAddress: string
let account: any

describe('DKIM sigMode Both', function () {
  it('successfully deploy the DKIM Recovery', async function () {
    const [signer] = await ethers.getSigners()

    const dnsSec = await ethers.deployContract('DNSSECImpl', ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d00002b000100000e10000404fefdfd'])

    const rsaSha256 = await ethers.deployContract('RSASHA256Algorithm')
    await dnsSec.setAlgorithm(8, await rsaSha256.getAddress())

    // other algo
    const rsaSha256Other = await ethers.deployContract('RSASHA256')

    const p256SHA256Algorithm = await ethers.deployContract('P256SHA256Algorithm')
    await dnsSec.setAlgorithm(13, await p256SHA256Algorithm.getAddress())

    const digest = await ethers.deployContract('SHA256Digest')
    await dnsSec.setDigest(2, await digest.getAddress())

    const contractFactory = await ethers.getContractFactory("DKIMRecoverySigValidator", {
      libraries: {
        RSASHA256: await rsaSha256Other.getAddress(),
      },
    })
    dkimRecovery = await contractFactory.deploy(await dnsSec.getAddress(), signer.address, signer.address)
    expect(await dkimRecovery.getAddress()).to.not.be.null
  })

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer)
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully validate a DKIM signature', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, txns]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const innerSig = abiCoder.encode([
      'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)',
      'bytes',
      'bytes'
    ], [
      [
        ethers.toBeHex(0, 1),
        [
          `${parsedContents[0].selector}._domainKey.gmail.com`,
          ethers.hexlify(parsedContents[0].modulus),
          ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
        ],
        parsedContents[0].processedHeader,
        newSigner.address,
        ethers.toBeHex(1, 32)
      ],
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await account.execute(txns, finalSig)
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(1, 32))
  })
})
