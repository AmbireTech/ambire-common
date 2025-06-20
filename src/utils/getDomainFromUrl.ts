import { parse } from 'tldts'

const getDomainFromUrl = (url: string) => {
  const domain = parse(url).domain

  if (domain) return domain

  try {
    const hostname = new URL(url).hostname
    const cleaned = hostname.startsWith('www.') ? hostname.slice(4) : hostname
    const parts = cleaned.split('.')

    if (parts.length >= 2) return parts.slice(-2).join('.')

    return cleaned
  } catch {
    return url
  }
}

export default getDomainFromUrl
