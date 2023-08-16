const { DNSProver } = require('@ensdomains/dnsprovejs')

export default async function lookup(selector: string, domain: string): Promise<any> {
  const textDomain = `${selector}._domainKey.${domain}`
  const prover = DNSProver.create('https://cloudflare-dns.com/dns-query')
  try {
    const res = await prover.queryWithProof('TXT', textDomain)
    return new Promise(resolve => resolve(res))
  } catch (error: any) {
    return new Promise(resolve => resolve(null))
  }
}