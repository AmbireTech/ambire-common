const { ethers } = require("ethers")
const fetch = require("node-fetch")
const { DNSProver } = require('@ensdomains/dnsprovejs')

async function getData(domain, type) {
    const domainName = 'cyberciti.biz.'
    const doOp = true
    const result = await fetch(`https://dns.google/resolve?name=${domainName}&do=${doOp}&type=${type}`)
    const json = await result.json()
    const data = json.Answer[json.Answer.length - 1].data.split(' ')
    return ethers.hexlify(ethers.toUtf8Bytes(data[data.length - 1]))
}

async function run() {
    const textDomain = 'Google._domainKey.Ambire.com'
    const prover = DNSProver.create("https://cloudflare-dns.com/dns-query")
    const result = await prover.queryWithProof('TXT', textDomain)
    console.log(result)

    // const domainName = '20221208._domainkey.gmail.com'
    // const type = 'TXT'
    // const result = await fetch(`https://cloudflare-dns.com/dns-query?name=${domainName}&type=${type}`, {
    //     headers: {
    //         'Accept': 'application/dns-json'
    //     }
    // })
    // const json = await result.json()
    // console.log(json)

    // const domainName = 'cyberciti.biz.'
    // const domainName = 'Google._domainKey.Ambire.com'
    // const type = 'TXT'
    // const doValue = true
    // const result = await fetch(`https://dns.google/resolve?name=${domainName}&type=${type}&do=${doValue}`, {
    //     headers: {
    //         'Accept': 'application/dns-json'
    //     }
    // })
    // const json = await result.json()
    // console.log(json)
}

run()