import { hexlify, randomBytes } from 'ethers'

import { Hex } from '@/interfaces/hex'
import { Key, KeystoreSignerInterface } from '@/interfaces/keystore'

/**
 * Storage generated with v6.9.0 and exported from the extension
 * Used to validate that the migration from CTR to GCM passes correctly with
 * real-world data.
 *
 * Contains 6 seeds, 6 PKs and 1 secret
 */
const CTR_STORAGE = {
  keystoreKeys: `[{"addr":"0xF36020c3694D1c64620137C0265Bb8281DA44Ff8","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0x5a5264f5ff974f5abf67f2a66ed718aa7dce8bfb1435e76ec675ca4576b94be2","meta":{"createdAt":1779368048361,"fromSeedId":"eddb4732-08df-4750-9fe2-b05626d69d7c"}},{"addr":"0xb7D5BF4C11FF77E560f7aD6505f967F93c953c07","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0xbc99cbbd60e832679a7f1649ae1f554dc60fde565f53449861e41b513818b675","meta":{"createdAt":1779368083005,"fromSeedId":"d506a4a4-204d-4fff-b867-161f1aebeaf3"}},{"addr":"0xE8C292360caBF52936eA0fD6Cd03E8a4f5864DC8","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0xa62ca1fefcccb0439f064e1ba1cd8fdcf7a582fadd258a475fe41e6954a886ac","meta":{"createdAt":1779368097409,"fromSeedId":"e2b3b4e0-a7ed-4a75-89c7-01a678ce89e9"}},{"addr":"0x77509C51caCdDC9EB7d563dcF93967b61f319147","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0xf604ff3a52dfd50ea0d3e2f8c9757f181ba406280029bee670c7a42d1682b35d","meta":{"createdAt":1779368110986,"fromSeedId":"a67f93c7-77eb-421f-adbb-e605a03e237c"}},{"addr":"0x831AAfe5EC7563e054cF36691A6174394B945F59","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0x2834432c0614f967cb71c8f83299e94255a322654862d487fa8f3a867f301819","meta":{"createdAt":1779368120706,"fromSeedId":"b0fa6864-adae-4c69-9b6f-046bf73344b3"}},{"addr":"0x72d9Cd4B2f614809101fc8537290Eb8828928811","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0x232056171d663e57753a3aff45f8fdcd48302a2bbb8740d4ad23c17ee621ebbf","meta":{"createdAt":1779368185039,"fromSeedId":"869b5619-4f0d-4ff9-8fd9-293c1a79ed40"}}]`,
  keystoreSeeds: `[{"id":"eddb4732-08df-4750-9fe2-b05626d69d7c","label":"Recovery Phrase 1","seed":"0x8c4fc81e0f10a5a8a58384a5d89eb6294b313496d62aed01916baf6cca8a2a929641a7674e20e26be440350fb09775ad7d419de5aad727876f4e4a7a8075b45a4c44d4e4ea6841","seedPassphrase":null,"hdPathTemplate":"m/44'/60'/0'/0/<account>"},{"id":"d506a4a4-204d-4fff-b867-161f1aebeaf3","label":"Recovery Phrase 2","seed":"0x8246d7085b42a3a4a988cbad8d95fa37477c2d87933fe9028039a329c2972f8dc211bc6b5d65e22aee59670ebd9c65ad7d4486f1e29b259e7c075a348279b4095a01c4fcf26b50bb3255611fc373a3ffdb4bbe9035184df259e399","seedPassphrase":null,"hdPathTemplate":"m/44'/60'/0'/0/<account>"},{"id":"e2b3b4e0-a7ed-4a75-89c7-01a678ce89e9","label":"Recovery Phrase 3","seed":"0x925bd61f4a0ce4b8ae839beb9197b63f497028c4d22be3188439a629cd8c2a85d348e86f5574f965e30c781db6d274e3624180f6aad52785630d5a34977fb3144a01d5e4f37a4ab73a55770bd638b1f49e44b0d1220e0cf246fa9274d3486007114b21ffd96cfda95b0b6de2880657bbd9f433677f2a06","seedPassphrase":null,"hdPathTemplate":"m/44'/60'/0'/0/<account>"},{"id":"a67f93c7-77eb-421f-adbb-e605a03e237c","label":"Recovery Phrase 4","seed":"0x915cd3185b0ba7aee69884bf9997fa32417d288bc47ce50e8b38ab66c8c53a84c445a76b4965b067e4427c11ad9f31e460469ce1efd53cd16e0b4f759664e6095e48d9a5e97a43a13a556f11dd32b8add249b8c0700449fc46fd9d74d7016c52135d3bbed67deafa5d1d2cb29e0655a4d4a73b22602612dc12625d7948b4b03f4f00f3e4bbd15c169e2d758f1780800d4222","seedPassphrase":null,"hdPathTemplate":"m/44'/60'/0'/0/<account>"},{"id":"b0fa6864-adae-4c69-9b6f-046bf73344b3","label":"Recovery Phrase 5","seed":"0x895bd05b5f03b6bfbfcc8da29d97be7a58702892d67ceb038c2da429ce80229b965ca1705b63fc6fad5e7a08b98674ad7d4790e9aac9299f6e0152349479a50e5b53d2a5fa7a56b82655701fc827f4eed247a1d8700e45fc4caf9869c1492e57134b29fbc738e8e65e0b2ca18a0142a5daba7e727f2005dc5c75116f4ebae072400cf6f4fe814511832b3ddc179d920843","seedPassphrase":null,"hdPathTemplate":"m/44'/60'/0'/0/<account>"},{"id":"869b5619-4f0d-4ff9-8fd9-293c1a79ed40","label":"Recovery Phrase 6","seed":"0x835bc8010f01b6aab180cbae808fbf344a313485d028a809893eb1618688218fd35de8674268f968e458350ebd8172f86b0883e3fec9279d2a194d759430a4084746dff1bf7e55a136052319c83ab0e89e58b0d133050cfb4cec9564d7016a4e00493dffd838e7e65d1c7fa7cb1a43a1d7b12c227e3d0ddc19625d6d49b8ac6b0902f3e2ad855511d02b65cc0e9b924943356cc5f9d13cb9f9eba01deb","seedPassphrase":"0xa523a8a366164c8070dbe208db5a72","hdPathTemplate":"m/44'/60'/0'/0/<account>"}]`,
  keyStoreUid:
    'd7cbabe583a25d5f8179b1e9d1db1a346e3fa466f67aeace76e72fee6a5829b0053cfeb0f290e89182fa3e2a869d3f26f9f9d77992898eb66c5ffc19221f6cb3',
  keystoreSecrets:
    '[{"id":"password","scryptParams":{"salt":"0xad6534e5303dc3eaef149860bfc93736f0b7df10f94fa4471546a606381445c8","N":131072,"r":8,"p":1,"dkLen":64},"aesEncrypted":{"cipherType":"aes-128-ctr","ciphertext":"0xcec1541581dee722d23f26c248a71149849ce8e3bd3d3988f7220aad656df7e2","iv":"0xc672552fa7d8b57e223f8817f9c32cec","mac":"0xac7e69ec2a012890837df1d3050a843e58eb9e3a9828fab7063bfa2980c9f022"}}]'
}

class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

class LedgerSigner {
  key

  constructor(_key: Key) {
    this.key = _key
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

export { CTR_STORAGE, InternalSigner, LedgerSigner }
