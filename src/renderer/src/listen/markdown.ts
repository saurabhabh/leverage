/** Just enough Markdown for AI summaries. Parsed to data and rendered as React text: never raw HTML. */
export type ListItem = { task: boolean; done: boolean; text: string }
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ListItem[] }

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    const last = blocks[blocks.length - 1]
    if (!line) {
      blocks.push({ kind: 'paragraph', text: '' })
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line)
    if (heading) blocks.push({ kind: 'heading', text: heading[1] })
    else if (item) {
      const li = { task: item[1] !== undefined, done: !!item[1] && item[1] !== ' ', text: item[2] }
      if (last?.kind === 'list') last.items.push(li)
      else blocks.push({ kind: 'list', items: [li] })
    } else if (last?.kind === 'paragraph' && last.text) last.text += ` ${line}`
    else blocks.push({ kind: 'paragraph', text: line })
  }
  return blocks.filter((b) => b.kind !== 'paragraph' || b.text)
}

export function inline(text: string): { bold: boolean; text: string }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      /^\*\*[^*]+\*\*$/.test(part)
        ? { bold: true, text: part.slice(2, -2) }
        : { bold: false, text: part }
    )
}
