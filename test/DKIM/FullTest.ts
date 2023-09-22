import { ethers } from 'hardhat'
import lookup from '../../src/libs/dns/lookup'
import { abiCoder, expect } from '../config'
const SignedSet = require('@ensdomains/dnsprovejs').SignedSet
import getPublicKey from '../../src/libs/dkim/getPublicKey'
import publicKeyToComponents from '../../src/libs/dkim/publicKeyToComponents'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import { getDKIMValidatorData, getPriviledgeTxn, getPriviledgeTxnWithCustomHash, getSignerKey } from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { wrapEthSign, wrapExternallyValidated } from '../ambireSign'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

function hexEncodeSignedSet(rrs: any, sig: any) {
  const ss = new SignedSet(rrs, sig)
  return [ss.toWire(), ss.signature.data.signature]
}

const gmailDomainName = '0832303232313230380a5f646f6d61696e6b657905676d61696c03636f6d0c'
const accInfoTuple = 'tuple(string, string, string, bytes, bytes, address, bool, uint32, uint32, bool, bool, uint32)';
const emailPrivValue = '0xfe564763e6c69427036277e09f47a1063bcc76422a8d215852ec20cbbf5753fb'

let dkimRecovery: any
let ambireAccountAddress: any
let account: any

describe('DKIM Bridge + unknown selector DKIM verification', function () {
  it('successfully deploy the DNSSEC contracts and DKIM Recovery', async function () {
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

    dkimRecovery = await contractFactory.deploy(
      await dnsSec.getAddress(),
      signer.address,
      signer.address
    )

    expect(await dkimRecovery.getAddress()).to.not.be.null
  })

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const domainName = Buffer.from(gmailDomainName, 'hex').toString('ascii').replace('20221208', '20221207')
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true,
      selector: domainName,
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully add a DNS key through addDKIMKeyWithDNSSec', async function () {
    const res = await lookup('20221208', 'gmail.com.dnssecbridge.ambire.com')
    const rrsets = res.proofs.map(({records, signature}: any) => hexEncodeSignedSet(records, signature))
    const set = hexEncodeSignedSet(res.answer.records, res.answer.signature)
    rrsets.push(set)
    await dkimRecovery.addDKIMKeyWithDNSSec(rrsets)

    // get the public key
    const ambireKey = await getPublicKey({domain: 'gmail.com.dnssecbridge.ambire.com', selector: '20221208'})
    const key = publicKeyToComponents(ambireKey.publicKey)
    const ambireExponent = ethers.hexlify(ethers.toBeHex(key.exponent))
    const ambireModulus = ethers.hexlify(key.modulus)

    // get the domainName
    const domainName = Buffer.from(gmailDomainName, 'hex').toString('ascii')
    const dkimHash = ethers.keccak256(abiCoder.encode(['tuple(string, bytes, bytes)'], [[domainName, ambireModulus, ambireExponent]]))
    const isResThere = await dkimRecovery.dkimKeys(dkimHash)
    expect(isResThere[0]).to.be.true
  })

  it('successfully uses the added DKIM key to trigger a recovery', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const domainName = Buffer.from(gmailDomainName, 'hex').toString('ascii').replace('20221208', '20221207')
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true,
      selector: domainName,
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true,
      selector: domainName,
      plain: true
    })
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const domainNameMeta = Buffer.from(gmailDomainName, 'hex').toString('ascii')
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        domainNameMeta,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const identifier = ethers.keccak256(abiCoder.encode(['address', accInfoTuple, sigMetaTuple], [
        ambireAccountAddress,
        identifierData,
        sigMetaValues
    ]))
    const secondSig = wrapEthSign(await relayer.signMessage(ethers.getBytes(identifier)))
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await account.execute(txns, finalSig)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(1, 32))

    // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('recovery already done')
  })
})
