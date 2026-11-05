/**
 * Measures how the impersonation check (src/libs/dapps/impersonation.ts) performs, so changes to its
 * rules or its list of apps can be compared with numbers:
 * - how many known phishing domains it catches (only by domain - the lists have no names or icons,
 *   so the real check catches more)
 * - how many popular, legitimate domains it flags by mistake
 *
 * Not part of CI - the lists are large and change daily. Download them first:
 * - phishing: https://cena.ambire.com/api/v3/scamchecker/data (or MetaMask's
 *   https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json)
 * - popular sites: https://tranco-list.eu/top-1m.csv.zip (unzipped)
 * - app catalog: https://api.llama.fi/protocols
 *
 * Run: npx ts-node scripts/benchmarkImpersonation.ts <phishing.json> <top-1m.csv> <protocols.json>
 */
import { readFileSync } from 'fs'
import { getDomain } from 'tldts'

import { getImpersonation } from '../src/libs/dapps/impersonation'

const SAMPLE_SIZE = 30

const normalizeHostname = (domain: string) => {
  const hostname = domain.toLowerCase().trim()
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname
}

const getHostname = (url: string) => {
  try {
    return normalizeHostname(new URL(url).hostname)
  } catch {
    return null
  }
}

/** Reads Ambire's scam checker response, MetaMask's config or a plain array of domains */
const readPhishingDomains = (path: string): string[] => {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const domains: string[] = Array.isArray(data) ? data : (data.domains ?? data.blacklist ?? [])
  return [...new Set(domains.map(normalizeHostname))]
}

/** Reads the hostnames from a Tranco list, where each line is "<rank>,<domain>" */
const readTrancoDomains = (path: string): string[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.split(',')[1])
    .filter((domain): domain is string => !!domain)
    .map(normalizeHostname)

const readCatalogHostnames = (path: string): Set<string> =>
  new Set(
    JSON.parse(readFileSync(path, 'utf8'))
      .map((protocol: { url?: string }) => (protocol.url ? getHostname(protocol.url) : null))
      .filter((hostname: string | null): hostname is string => !!hostname)
  )

const formatShare = (count: number, total: number) =>
  `${count} of ${total} (${((count / total) * 100).toFixed(3)}%)`

const run = () => {
  const [phishingPath, trancoPath, catalogPath] = process.argv.slice(2)
  if (!phishingPath || !trancoPath || !catalogPath) {
    console.error(
      'Usage: npx ts-node scripts/benchmarkImpersonation.ts <phishing.json> <top-1m.csv> <protocols.json>'
    )
    process.exit(1)
  }

  const phishingDomains = readPhishingDomains(phishingPath)
  const phishingSet = new Set(phishingDomains)
  const catalogHostnames = readCatalogHostnames(catalogPath)
  // Like the app, a site is in the catalog by its own hostname or by its root domain
  const isInAppCatalog = (hostname: string) =>
    catalogHostnames.has(hostname) || catalogHostnames.has(getDomain(hostname) ?? '')
  const check = (hostname: string) =>
    getImpersonation({ hostname, isInAppCatalog: isInAppCatalog(hostname) })

  const caught = phishingDomains.filter((domain) => !!check(domain))
  // Phishing sites that made it into the popular list are not false positives
  const popularDomains = readTrancoDomains(trancoPath).filter((domain) => !phishingSet.has(domain))
  const falsePositives = popularDomains.filter((domain) => !!check(domain))
  // Every catalog app checked as if it was not in the catalog, to see how apps fare on their own
  const catalogFalsePositives = [...catalogHostnames].filter(
    (hostname) => !!getImpersonation({ hostname, isInAppCatalog: false })
  )

  console.log(`Phishing domains caught: ${formatShare(caught.length, phishingDomains.length)}`)
  console.log(
    `Popular domains flagged: ${formatShare(falsePositives.length, popularDomains.length)}`
  )
  console.log(
    `Catalog apps flagged if not in the catalog: ${formatShare(
      catalogFalsePositives.length,
      catalogHostnames.size
    )}`
  )
  console.log(`\nPopular domains flagged (first ${SAMPLE_SIZE}):`)
  falsePositives
    .slice(0, SAMPLE_SIZE)
    .forEach((domain) => console.log(`  ${domain} -> ${check(domain)?.appName}`))
  console.log('\nCatalog apps flagged:')
  catalogFalsePositives.forEach((hostname) =>
    console.log(
      `  ${hostname} -> ${getImpersonation({ hostname, isInAppCatalog: false })?.appName}`
    )
  )
}

run()
