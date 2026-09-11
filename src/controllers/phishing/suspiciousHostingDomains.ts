/**
 * Shared hosting platforms that legitimate DeFi protocols do not use as a primary domain.
 * Phishing attacks exploit these platforms because their well-known parent domain (e.g.
 * google.com, vercel.app) makes the URL appear trustworthy and bypasses most phishing filters.
 *
 * Attack example:
 *   A user searches for "Uniswap" — a sponsored search result points to
 *   sites.google.com/uniswap, a convincing fake hosted on Google Sites.
 *   The page embeds a wallet connector that requests a signature, stealing funds.
 *
 * HOW IT WORKS
 *
 * Two independent checks feed into getDappVerificationBanner():
 *
 * 1. Intrinsic status — the dApp's own domain, resolved by getDomainBlacklistedStatus().
 *    Priority: BLACKLISTED (phishing DB) > SUSPICIOUS_HOSTING (this list) > VERIFIED.
 *    Both lookups are string comparisons, so they run on the canonical hostname produced by
 *    getNormalizedHostnameFromUrl()/getDappIdFromUrl() — never on a raw URL hostname, which keeps
 *    the trailing dot of a fully-qualified host and would miss every entry in both lists.
 *
 * 2. Frame context — if a dApp is loaded as an iframe inside a tab whose top-level document is
 *    on a SUSPICIOUS_HOSTING or BLACKLISTED domain, #getFrameContextStatus() returns
 *    SUSPICIOUS_HOSTING. The top-frame origin is reported by the browser with every request, so
 *    it cannot be spoofed by the page. This is only used for the banner — never written to
 *    #dapps or storage, so the dApp's global status is not contaminated for unrelated sessions.
 *
 * 3. User trust — the user can mark a dApp hosted on one of these platforms as trusted, which
 *    silences the SUSPICIOUS_HOSTING warning for that dApp only (DappsController.trustDapp).
 *    Offered only where canBeTrustedByUser() holds, and it never silences BLACKLISTED or a
 *    dangerous frame context - both stay in force for a trusted dApp.
 *
 * Final priority in getDappVerificationBanner():
 *   dApp intrinsic BLACKLISTED  >  context SUSPICIOUS_HOSTING  >  dApp intrinsic SUSPICIOUS_HOSTING  >  VERIFIED
 *
 * Examples:
 *   Scenario                                                                     Result
 *   sites.google.com dApp (BLACKLISTED in phishing DB)                          intrinsic=BLACKLISTED → BLACKLISTED
 *   my-dapp.vercel.app (in this list, not in phishing DB)                       intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   ipfs.io dApp opened directly                                                intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   app.uniswap.org iframe inside a sites.google.com tab                        intrinsic=VERIFIED, context=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   app.uniswap.org opened directly (it is the tab's top frame)                 intrinsic=VERIFIED, context=undefined → VERIFIED
 *   app.uniswap.org iframe in sites.google.com, but uniswap is BLACKLISTED      intrinsic=BLACKLISTED wins → BLACKLISTED
 */
/**
 * The non-Google entries below are derived from an analysis of the eth-phishing-detect
 * blocklist, ranked by how many blocked phishing
 * entries are hosted on each shared platform. Only platforms that can serve an arbitrary
 * JS wallet connector (the actual eth_requestAccounts attack vector) and that legitimate
 * DeFi protocols never use as a primary domain are included.
 *
 * Deliberately EXCLUDED despite appearing in the report, to avoid false positives on
 * legitimate traffic and because they cannot host a wallet connector:
 *   - typeform.com, zendesk.com — form/support builders; cannot run a custom connector.
 *   - medium.com — publishing platform; no custom JS.
 *   - netlify.com — Netlify's own corporate site (the user-hosting suffix netlify.app IS listed).
 *   - s3.amazonaws.com, cloudfront.net — object storage / CDN that fronts large amounts of
 *     legitimate dApp assets; low blocklist share, high false-positive risk.
 *   - translate.goog — Google Translate proxy; would flag legitimate translated browsing.
 *   - page.link — Firebase Dynamic Links (deprecated redirect service), not a host.
 */
export type SuspiciousHostingDomain = {
  /**
   * The host the platform serves user content from. Matched against the dApp's hostname as that
   * host itself or any host under it, so an entry stands for the whole platform ("vercel.app"
   * covers "my-dapp.vercel.app").
   */
  hostSuffix: string
  /**
   * Whether the platform gives each dApp its own subdomain. If it does, the hostname is a boundary
   * the browser enforces - the smallest thing a user can meaningfully trust. If it does not,
   * unrelated dApps share one hostname and differ only by path (sites.google.com/dapp), which
   * keeps nothing out of a same-origin page.
   */
  isAppPerSubdomain: boolean
}

export const SUSPICIOUS_HOSTING_DOMAINS: SuspiciousHostingDomain[] = [
  // Google ecosystem
  { hostSuffix: 'sites.google.com', isAppPerSubdomain: false },
  { hostSuffix: 'docs.google.com', isAppPerSubdomain: false },
  { hostSuffix: 'drive.google.com', isAppPerSubdomain: false },
  { hostSuffix: 'forms.google.com', isAppPerSubdomain: false },
  { hostSuffix: 'sheets.google.com', isAppPerSubdomain: false },
  { hostSuffix: 'slides.google.com', isAppPerSubdomain: false },

  // JAMstack / static hosting
  { hostSuffix: 'vercel.app', isAppPerSubdomain: true },
  { hostSuffix: 'netlify.app', isAppPerSubdomain: true },
  { hostSuffix: 'bitballoon.com', isAppPerSubdomain: true }, // Netlify legacy
  { hostSuffix: 'pages.dev', isAppPerSubdomain: true },
  { hostSuffix: 'r2.dev', isAppPerSubdomain: true }, // Cloudflare R2 (public buckets serving static sites)
  { hostSuffix: 'workers.dev', isAppPerSubdomain: true }, // Cloudflare Workers
  { hostSuffix: 'github.io', isAppPerSubdomain: true }, // GitHub Pages
  { hostSuffix: 'gitlab.io', isAppPerSubdomain: true }, // GitLab Pages
  { hostSuffix: 'surge.sh', isAppPerSubdomain: true },

  // Firebase
  { hostSuffix: 'firebaseapp.com', isAppPerSubdomain: true },
  { hostSuffix: 'web.app', isAppPerSubdomain: true },

  // Cloud app / PaaS hosts
  { hostSuffix: 'azurewebsites.net', isAppPerSubdomain: true },
  { hostSuffix: 'onrender.com', isAppPerSubdomain: true },
  { hostSuffix: 'herokuapp.com', isAppPerSubdomain: true },
  { hostSuffix: 'railway.app', isAppPerSubdomain: true },
  { hostSuffix: 'glitch.me', isAppPerSubdomain: true },
  { hostSuffix: 'repl.co', isAppPerSubdomain: true },
  { hostSuffix: 'replit.app', isAppPerSubdomain: true },
  { hostSuffix: 'csb.app', isAppPerSubdomain: true }, // CodeSandbox

  // Docs hosting
  { hostSuffix: 'gitbook.io', isAppPerSubdomain: true },

  // Website builders
  { hostSuffix: 'webflow.io', isAppPerSubdomain: true },
  { hostSuffix: 'mystrikingly.com', isAppPerSubdomain: true },
  { hostSuffix: 'b12sites.com', isAppPerSubdomain: true },
  { hostSuffix: 'weebly.com', isAppPerSubdomain: true },
  { hostSuffix: 'weeblysite.com', isAppPerSubdomain: true },
  { hostSuffix: 'godaddysites.com', isAppPerSubdomain: true },
  { hostSuffix: 'umso.co', isAppPerSubdomain: true },
  { hostSuffix: 'jimdosite.com', isAppPerSubdomain: true },
  { hostSuffix: 'tilda.ws', isAppPerSubdomain: true },
  { hostSuffix: 'square.site', isAppPerSubdomain: true },
  { hostSuffix: 'flazio.com', isAppPerSubdomain: true },

  // Website / managed hosts
  { hostSuffix: 'pantheonsite.io', isAppPerSubdomain: true },
  { hostSuffix: 'plesk.page', isAppPerSubdomain: true },

  // Free web hosts
  { hostSuffix: '42web.io', isAppPerSubdomain: true },
  { hostSuffix: 'cprapid.com', isAppPerSubdomain: true },
  { hostSuffix: '000webhostapp.com', isAppPerSubdomain: true },

  // Blogging platforms
  { hostSuffix: 'blogspot.com', isAppPerSubdomain: true },
  { hostSuffix: 'wordpress.com', isAppPerSubdomain: true },

  // Dynamic DNS (abuse-prone, no legitimate DeFi usage)
  { hostSuffix: 'us.to', isAppPerSubdomain: true },
  { hostSuffix: 'duia.us', isAppPerSubdomain: true },
  { hostSuffix: 'mooo.com', isAppPerSubdomain: true },

  // IPFS / decentralized gateways
  { hostSuffix: 'ipfs.io', isAppPerSubdomain: true },
  { hostSuffix: 'dweb.link', isAppPerSubdomain: true },
  { hostSuffix: 'cf-ipfs.com', isAppPerSubdomain: true },
  { hostSuffix: 'on-fleek.app', isAppPerSubdomain: true },
  { hostSuffix: 'fleek.co', isAppPerSubdomain: true },
  { hostSuffix: 'mypinata.cloud', isAppPerSubdomain: true },
  { hostSuffix: '4everland.app', isAppPerSubdomain: true },
  { hostSuffix: 'w3s.link', isAppPerSubdomain: true },
  { hostSuffix: 'eth.link', isAppPerSubdomain: true }
]
