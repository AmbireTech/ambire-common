// TODO: this file should be deleted

/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { arbNotDeployed } from '../../../test/config'
import { Key, KeystoreSigner } from '../../interfaces/keystore'

class LocalSigner implements KeystoreSigner {
  key: Key

  constructor(_key: Key) {
    this.key = _key
  }

  async signRawTransaction() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }

  async signTypedData() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }

  async signMessage() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }
}

export const localSigner = new LocalSigner({
  addr: arbNotDeployed.addr,
  type: 'internal',
  dedicatedToOneSA: true,
  meta: null,
  isExternallyStored: false
})
