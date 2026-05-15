import { hexlify, randomBytes } from 'ethers'

import { Hex } from '@/interfaces/hex'
import { Key, KeystoreSignerInterface } from '@/interfaces/keystore'

const CTR_STORAGE = {
  keystoreKeys:
    '[{"addr":"0x839C335cAB515fc782e6c038694A2e59699c7D19","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0xd0d931041809ad8eb77b30ff9650fc928390bc169231de2c610c1d4427e81163","meta":{"createdAt":1777451801628,"fromSeedId":"1e970047-eeef-4eaa-babc-b91a797a8b76"}},{"addr":"0xc96671Fdc8bE556A023aabf5F0DeD354ADB68A54","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0x51475183e8f79662f46d922544fcbf036ccd9f8516e1555f226cabe9d60530ca","meta":{"createdAt":1777451825091,"fromSeedId":"39527f8b-461d-49b8-bd1f-cd95f73fe017"}},{"addr":"0x085f8A348f6fBc6F8d8FC3f1e427473436506D65","type":"internal","label":"Key 1","dedicatedToOneSA":false,"privKey":"0x5e4dfbe1927eb5ff9cafb0e66d20900629fc6bfca006ffa90b174238013d3518","meta":{"createdAt":1777451843593}}]',
  keystoreSeeds:
    '[{"id":"1e970047-eeef-4eaa-babc-b91a797a8b76","label":"Recovery Phrase 1","seed":"0xf864f22bd31b7b9d4829c992f8e3ad0acf9e599000f93152188766f728bfc58fe9267f6c3df5493ca15234cd4a68c3efe3de9c770ef6237be6777aef2cec3c22926c37da289d47c4234ac6285f","seedPassphrase":null,"hdPathTemplate":"m/44\'/60\'/0\'/0/<account>"},{"id":"39527f8b-461d-49b8-bd1f-cd95f73fe017","label":"Recovery Phrase 2","seed":"0xf86cf563df197ac9432ac8c1e4eeb34fde8455d302b7314f0e9235f164bec6c1f06f65797cfa0821af4a7bd40468c6a6f3de81720dbb737ffd6876bc2cbb3b29db712cd33bd35181215ddb3749a32b304c1e7ae4c4c4627f5b02d1dc8dea1de2aac9c1b2d364dddf5463e9411e96cdaf7a64e566f75c0e0cf5683e84dbf204fa3e02a4265394f023e4f6bb7cfb0d5670391c83ba898ac7db68","seedPassphrase":null,"hdPathTemplate":"m/44\'/60\'/0\'/0/<account>"}]',
  keyStoreUid:
    'd7cbabe583a25d5f8179b1e9d1db1a346e3fa466f67aeace76e72fee6a5829b0053cfeb0f290e89182fa3e2a869d3f26f9f9d77992898eb66c5ffc19221f6cb3',
  keystoreSecrets:
    '[{"id":"password","scryptParams":{"salt":"0x799b6874d437835bbc70923bae6c96fd01c1537d3e9843129844a97c765d74e5","N":131072,"r":8,"p":1,"dkLen":64},"aesEncrypted":{"cipherType":"aes-128-ctr","ciphertext":"0xd5412529c15a166b29034b1af62eeb80e5ac7f0692aa97ec699f74fdbfa58fe3","iv":"0xb00c604ea3ba6c676ab115b37d6d5c2b","mac":"0x4a6f0355c8e0ef6a579ac5e766b2fd54585f393c7ff860ea0279a073ab3361bd"}}]'
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

  // eslint-disable-next-line @typescript-eslint/no-empty-function
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
