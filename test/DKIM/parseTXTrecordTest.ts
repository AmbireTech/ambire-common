import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import lookup from '../../src/libs/dns/lookup'
import { expect } from '../config'
const SignedSet = require('@ensdomains/dnsprovejs').SignedSet
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

let ambireAccountAddress: string
const ambireSets = [
  [
    '0x003008000002a30064e2a90064c6f9804f660000003000010002a30001080100030803010001c12d59ab483b77b17cddc0f969d997b01510103772b46baf02937e799c74bb7bf42dc308e175257e736f8b3ce2fd0ec7094e560f9347c56992e6329cca773d05cba262f17bb8fb3e5c6a101a352d06967eacb2982b85eeb29e6d32c1e7265cafcfd050fc24ff078bca0b97ea254d0e32193a678ca8f90626d0c5a7e1147ca80e6bc02e94a3cbb6c50bd56fb5153f2caaba12c4a5d55e78641193753b5cc1c531bfcfdc63c223dc777fff2d23d4a440bdfab5365c8b8226af27c00c09ed6e91738f51c544f44af739ec72aa1e336e6a9bc6d0f0988776d7090cdbee66f6a4dc2e7ab3054f33f9884cd75990fb8b32e0f63df0109d886bf58812db3f4e9f46210300003000010002a30001080101030803010001acffb409bcc939f831f7a1e5ec88f7a59255ec53040be432027390a4ce896d6f9086f3c5e177fbfe118163aaec7af1462c47945944c4e2c026be5e98bbcded25978272e1e3e079c5094d573f0e83c92f02b32d3513b1550b826929c80dd0f92cac966d17769fd5867b647c3f38029abdc48152eb8f207159ecc5d232c7c1537c79f4b7ac28ff11682f21681bf6d6aba555032bf6f9f036beb2aaa5b3778d6eebfba6bf9ea191be4ab0caea759e2f773a1f9029c73ecb8d5735b9321db085f1b8e2d8038fe2941992548cee0d67dd4547e11dd63af9c9fc1c5466fb684cf009d7197c2cf79e792ab501e6a8a1ca519af2cb9b5f6367e94c0d47502451357be1b5',
    '0x3434dfb92478dc71736446552e4455ac6b0976bf24d05ba87a9a3b3ad8c3a4ae41f06f2a56645cbe829d85946acfc2d26dbfc80a14436b6ea629968f95c9c38c780a90891ad4f6948c4f0e8ece68484bf0f53c0959eb4de8720ef217a149d58c5d09af043e9c4c3cf1e1174e95b12c82b8178496f9bedff1ce03009f5a04bd7edec62d0a950814771352c67d27114b7e00da30366abea8483933f1193b21f47b92bad63a7a78a905bb900d6890963cd19a7f566a4c40594a116a41a5d051e9b25258d866d628366d8181c5dadf810929a29f681738572f04feaee13e5bc0951ce02149a2b25ff204bcc1c96628d15c0d3a11a6b8d55761b755f3f985ad86d249'
  ],
  [
    '0x002b08010001518064e19dd064d06c402b0b0003636f6d00002b000100015180002478bd0802e2d3c916f6deeac73294e8268fb5885044a833fc5459588f4a9184cfc41a5766',
    '0x837b9dfc840353662d836840bd6356bd28ea5612f8d1f09f59bc2b3f76b285d8e4f05c719fa1be8ad48b9b967884aad68a9eeed25f1a68806dc93c4dcdd1b24e5a46d2e195e7f43f4b7b8a540db5f66dae57ede9c601075a96ecb38015784bdca557bb6cf2ddc9e021aa7dfbaba9f34fcb24f93ab338aa5ad3fe81dac3d880ce5b917d2dddf7e548950d488db4195de105e10cf539544d4a537f8193be4688096572c85f2a2befbb98b437d39dae35abcee156f4cb7becfdfbffdf3f2d71a9c60b68a090ce4f7165918d35ba78fb6b589fff5e910aa92beffa4ccaafbda719e5a0793e113d259086151e1a6ac95a626ab675e6a3c11e494d8e45ff51a163d0ee'
  ],
  [
    '0x003008010001518064d911c564c54a1978bd03636f6d0003636f6d00003000010001518000a80100030803010001a23f7b92ad3c27b8fb0cd3f6a6bda0e647c40c9849d251580d6efc90234d9dd2b03242a5aeacec23eaddd2c67bce3485cf9510554d23e7dee521603318c18e7a43425ee491ee04d2c56328bc4045404ea428be64f7ad0c1264f3e3b66265748fd14b7eedb81024bf67c20c13e604fa70a9abb9be3ac5089f17ef86e0c8eab694e99fa522875ec577c351e8ee6ac0c685f91e71435033ddf9cf05b036e52e1f1903636f6d0000300001000151800106010103080103c3ce574d98cbd9157e0d70d274b849ca0e0eed9affc5dccc9047496906655c35cb08b33c4d171b017ca356f4960262aa6293cdfae8b13b55b21c351cdfa7687d38ef07465f87f84d3ccdab8af24edebd6126bbfea877ed9ba2080fa2211f18dcaf34f69223b14e22ba03b27c3fb5a820cc7457d59ed23a23a23d63cd230494c96399efd566710d462e40ba36562f1b71f0626ca742fea81701affca10b4b0ed949dadb4d0d075ef65ba8c508ec168cb249af826d46ee8299d58885ecef62a1535cd3eec049baa664ded9f7c10653f421d8afc18147bc1ecd1755c74f2abb72627a101dddb29ca3dc30c953122876ff61c31e344f2766b2c08a4a367bf8a0fa3f',
    '0xb42bf9cabe7cfc0ef5646d5adb928fc7fd54c9dd44722559fe9700f1e10502534f3d9377a56f4d42516a9e8c719d40567a4d3825aefa24919767bbef0cefbcd538ebed919427131c7424c17e5e8c52b89935044ca6dff3d50e6a63bf38bb426a5914d599544f8f98cb8a5cc1d19720dcf1ca2a7d448cd491cd2bb305a82600bbf3fe54a93ebe2543eac488ecfe1f86569ab538d1c456f76426bb9d0d079246e2aedb0e07d34fb774bafb3986a41d99b7302df0e7b1d476ac1788d3909f813cca491896ef93bf0485245fe59cd6d15598b74ed9a9e04e29a08c937c5d47eeedf4346143d5956b75335d6ff26c22c0714de3f8ca7d9f3d13e42eeb0ca2726c1739'
  ],
  [
    '0x002b08020001518064d9ba9364d06fab116b03636f6d0006616d6269726503636f6d00002b000100015180002409430d02f6e1e68e40757e8ce03edbc8e0fa76370e5903cf435e7d056670f2abec6c8bba',
    '0x9f298ef65bd7b761e356ee9fce41d20720c8f046e6cad6b1bbd1b7110e801c723243b88a5ecda77a7ff64393ea4b059f42b6a1dd9e3b03c0d3144c5d76e879fde4d8d270fe1c76eb33117c2e042809cdc105ca5c640807c2b1a358a9d788e43be03a631798e530a93df27838d816ea8e16ec273b19e220904dc8360a103a9e1e3cc2c99db90fba1c595bdf660e11a77dbd30bf943e95acfeddaa210c8f1c7ee8'
  ],
  [
    '0x00300d0200000e10650c028c64bb970c094306616d6269726503636f6d0006616d6269726503636f6d000030000100000e1000440100030da09311112cf9138818cd2feae970ebbd4d6a30f6088c25b325a39abbc5cd1197aa098283e5aaf421177c2aa5d714992a9957d1bcc18f98cd71f1f1806b65e14806616d6269726503636f6d000030000100000e1000440101030d99db2cc14cabdc33d6d77da63a2f15f71112584f234e8d1dc428e39e8a4a97e1aa271a555dc90701e17e2a4c4b6f120b7c32d44f4ac02bd894cf2d4be7778a19',
    '0x0f04ead0f6ef1c939cc89604f6ec0bee6e1a47a4e27fb9f0bd712c46df4f5b76868b8561c0932c8239964db24aa0fbd9bc9fecb7ce868bd27da1bee7c394171c'
  ]
]

const ambireTxt = [
  '0x00100d040000012c64d2f42964d0350986c906616d6269726503636f6d0006676f6f676c650a5f646f6d61696e6b657906616d6269726503636f6d00001000010000012c019cff763d444b494d313b206b3d7273613b20703d4d494942496a414e42676b71686b6947397730424151454641414f43415138414d49494243674b434151454131726736375a74746c45306f587954523859507749615a54686a3455617a6e442b4d36446a34517352753873526f5050526843326269775050396f4d73453076363753676c5252496e596b6f6436396d414d557374706d776b49685577723377757a685a4663344945487673517849487a35754a497977567a646672527a7851776558612b6867444a533557756f7a654e6b6831686b686538472b4365564b7453375479734a314f6d43707a3643453634474935724a5a6a46306254714c6137589b73716d6e6469676a5132747055324e475a676c6166517171682b53363330465835704c5a386b6e56355533326e684545336d677377706c57496944496d456d51523879366e556a75646b4f57365749396670517343726b436969684a73374b72395165334a7568594767677132327448563235757632584c36374c48675575435a6f78705a714a76374c4c4f62514d6a5176307051494441514142',
  '0xc56936b12291d4043b79848370dd74442a0420fd4db39d74e95e95d7511b510ea85cc52f55aaa479283237132a96db0ab2d232b5fb2e217058e51aa100c6fef0'
]

function hexEncodeSignedSet(rrs: any, sig: any) {
  const ss = new SignedSet(rrs, sig)
  return [ss.toWire(), ss.signature.data.signature]
}

let dkimRecovery: any
describe('DKIM', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccountAddress = addr
  })
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

  // deploy RSASHA256Algorithm
  // call verify with youtube.email
  // make it work
  it('successfully deploy the DKIM Recovery', async function () {
    const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
        encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const exponent = Buffer.from(ethers.toBeHex(parsedContents[0].exponent).slice(2), 'hex')
    const modulus = Buffer.from(parsedContents[0].solidity.modulus.slice(2), 'hex')
    const sig = parsedContents[0].solidity.signature
    const hash = parsedContents[0].solidity.hash
    // const key = Buffer.concat([exponent, modulus])
    const key = ethers

    console.log(exponent)
    console.log(modulus)
    console.log(key)

    const data = ethers.toUtf8Bytes(parsedContents[0].processedHeader)
    const rsaSha256 = await ethers.deployContract('RSASHA256Algorithm')
    const result = await rsaSha256.verify(key, data, sig)
    // console.log(result)
    // console.log('---------------')
    // console.log(ethers.hexlify(exponent))
    // console.log(ethers.hexlify(modulus))

    const rsaSha256Other = await ethers.deployContract('RSASHA256')
    const result2 = await rsaSha256Other.verify(hash, sig, exponent, modulus)
    // console.log(result2)

    const testData = [
      // example.net.     3600  IN  DNSKEY  (256 3 8 AwEAAcFcGsaxxdgiuuGmCkVI
      //                  my4h99CqT7jwY3pexPGcnUFtR2Fh36BponcwtkZ4cAgtvd4Qs8P
      //                  kxUdp6p/DlUmObdk= );{id = 9033 (zsk), size = 512b}
      '0x0100030803010001c15c1ac6b1c5d822bae1a60a45489b2e21f7d0aa4fb8f0637a5ec4f19c9d416d476161dfa069a27730b6467870082dbdde10b3c3e4c54769ea9fc395498e6dd9',
      // www.example.net. 3600  IN  A  192.0.2.91
      '0x0001080300000e1070dbd880386d43802349076578616d706c65036e65740003777777076578616d706c65036e6574000001000100000e100004c000025b',
      // www.example.net. 3600  IN  RRSIG  (A 8 3 3600 20300101000000
      //               20000101000000 9033 example.net. kRCOH6u7l0QGy9qpC9
      //               l1sLncJcOKFLJ7GhiUOibu4teYp5VE9RncriShZNz85mwlMgNEa
      //               cFYK/lPtPiVYP4bwg==);{id = 9033}
      '0x91108e1fabbb974406cbdaa90bd975b0b9dc25c38a14b27b1a18943a26eee2d798a79544f519dcae24a164dcfce66c2532034469c1582bf94fb4f89560fe1bc2',
    ]

    const result3 = await rsaSha256.verify(testData[0], testData[1], testData[2])
    console.log(result3)
  });

  // it('successfully validate the dnssec and execute the txt', async function () {
  //   // const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
  //   //     encoding: 'ascii'
  //   // })
  //   // const parsedContents: any = await parseEmail(gmail)

  //   // const records = Buffer.from(ambireTxt[0].slice(2), 'hex')
  //   // const sig = Buffer.from(ambireTxt[1].slice(2), 'hex')
  //   // const answer = SignedSet.fromWire(records, sig)

  //   const rrsets = ambireSets.map(([set, sig]: any) => {
  //     return [
  //       Buffer.from(set.slice(2), 'hex'),
  //       Buffer.from(sig.slice(2), 'hex'),
  //     ]
  //   })
  //   rrsets.push([
  //     Buffer.from(ambireTxt[0].slice(2), 'hex'),
  //     Buffer.from(ambireTxt[1].slice(2), 'hex'),
  //   ])
  //   const res = await dkimRecovery.addDKIMKeyWithDNSSec(rrsets);
  // })
})
