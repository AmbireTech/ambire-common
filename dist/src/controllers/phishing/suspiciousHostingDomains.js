"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUSPICIOUS_HOSTING_DOMAINS = void 0;
exports.SUSPICIOUS_HOSTING_DOMAINS = [
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
];
//# sourceMappingURL=suspiciousHostingDomains.js.map