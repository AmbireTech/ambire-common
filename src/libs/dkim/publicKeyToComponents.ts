const NodeRSA = require("node-rsa")

export default function publicKeyToComponents(publicKey: any) {
  const parsed = new NodeRSA(publicKey)

  const { e: exponent, n: modulus } = parsed.exportKey("components-public")

  return {
    exponent,
    modulus
  }
}
