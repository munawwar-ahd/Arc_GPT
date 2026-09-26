import { Fragment, createElement, type ReactNode } from 'react';

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSafeLink(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(href);
}

function renderTextWithBreaks(value: string, keyPrefix: string): ReactNode[] {
  return value.split('\n').flatMap((part, index, parts) => {
    const nodes: ReactNode[] = [<Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>];
    if (index < parts.length - 1) {
      nodes.push(<br key={`${keyPrefix}-break-${index}`} />);
    }
    return nodes;
  });
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|\/[^)\s]*)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(...renderTextWithBreaks(value.slice(cursor, match.index), `${keyPrefix}-${tokenIndex}`));
    }

    const token = match[0];
    const tokenKey = `${keyPrefix}-token-${tokenIndex}`;
    tokenIndex += 1;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code className="arc-inline-code" key={tokenKey}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>);
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      nodes.push(<em key={tokenKey}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch && isSafeLink(linkMatch[2])) {
        nodes.push(
          <a href={linkMatch[2]} key={tokenKey} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(<Fragment key={tokenKey}>{token}</Fragment>);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < value.length) {
    nodes.push(...renderTextWithBreaks(value.slice(cursor), `${keyPrefix}-tail`));
  }

  return nodes;
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  return (
    line.trim() === '' ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:[-*_]\s*){3,}$/.test(line) ||
    /^\s*(?:[-+*]|\d+\.)\s+/.test(line) ||
    (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
  );
}

export function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="arc-code-block" key={`code-${blockIndex}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      blockIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2];
      const headingLevel = Math.min(level + 1, 6);
      blocks.push(
        createElement(
          `h${headingLevel}`,
          { className: 'arc-markdown-heading', key: `heading-${blockIndex}` },
          renderInline(heading, `heading-${blockIndex}`)
        )
      );
      blockIndex += 1;
      index += 1;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push(<hr className="arc-markdown-rule" key={`rule-${blockIndex}`} />);
      blockIndex += 1;
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote className="arc-markdown-quote" key={`quote-${blockIndex}`}>
          {renderInline(quoteLines.join('\n'), `quote-${blockIndex}`)}
        </blockquote>
      );
      blockIndex += 1;
      continue;
    }

    const listMatch = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*(?:[-+*]|\d+\.)\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List className="arc-markdown-list" key={`list-${blockIndex}`}>
          {items.map((item, itemIndex) => (
            <li key={`list-${blockIndex}-${itemIndex}`}>{renderInline(item, `list-${blockIndex}-${itemIndex}`)}</li>
          ))}
        </List>
      );
      blockIndex += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="arc-markdown-table-wrap" key={`table-${blockIndex}`}>
          <table className="arc-markdown-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`table-${blockIndex}-head-${cellIndex}`}>
                    {renderInline(cell, `table-${blockIndex}-head-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`table-${blockIndex}-row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`table-${blockIndex}-row-${rowIndex}-${cellIndex}`}>
                      {renderInline(row[cellIndex] ?? '', `table-${blockIndex}-row-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      blockIndex += 1;
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p className="arc-markdown-paragraph" key={`paragraph-${blockIndex}`}>
        {renderInline(paragraphLines.join('\n'), `paragraph-${blockIndex}`)}
      </p>
    );
    blockIndex += 1;
  }

  return <div className="arc-markdown">{blocks}</div>;
}
