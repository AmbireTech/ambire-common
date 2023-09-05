/*
  fetch domainkey record (nodejs)
*/
const { promisify } = require("util");
const getKey = promisify(require("dkim/lib/get-key"));

export default function getPublicKey({ domain, selector }: any) {
  return getKey(domain, selector).then((key: any) => {
    const publicKey =
      "-----BEGIN PUBLIC KEY-----\n" +
      key.key.toString("base64") +
      "\n-----END PUBLIC KEY-----";

    return {
      domain,
      selector,
      publicKey
    };
  });
};
