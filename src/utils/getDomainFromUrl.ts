import { parse } from 'tldts'

const getDomainFromUrl = (url: string) => {
  const domain = parse(url).domain

  if (domain) return domain

  return url
}

export default getDomainFromUrl
