function isUnderstandableName(name: string): boolean {
  const forbiddenWords = ['Ambire', 'Identity', 'Safe', 'Proxy', 'Diamond']
  if (name.endsWith('able')) return false
  if (forbiddenWords.some((fw) => name.toLowerCase().includes(fw.toLowerCase()))) return false
  return true
}

export { isUnderstandableName }
