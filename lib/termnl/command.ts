/** Shell-like words without eval, interpolation, execution or variable expansion. */
export function commandWords(line: string): string[] {
  const words: string[] = []
  let current = '', quote = '', escaped = false
  for (const char of line.trim()) {
    if (escaped) { current += char; escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; else current += char; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) { if (current) { words.push(current); current = '' }; continue }
    current += char
  }
  if (quote || escaped) throw new Error('Close the quoted text and escape sequence')
  if (current) words.push(current)
  return words
}

/** `switches` are flags that take no value, such as --block. */
export function options(words: string[], switches: string[] = []) {
  const args: string[] = [], flags: Record<string, string> = {}
  for (let index = 0; index < words.length; index++) {
    if (words[index].startsWith('--')) {
      const key = words[index].slice(2)
      if (switches.includes(key)) { flags[key] = 'true'; continue }
      const value = words[++index]
      if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value`)
      flags[key] = value
    } else args.push(words[index])
  }
  return { args, flags }
}
