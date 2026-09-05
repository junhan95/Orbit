'use client';

import type { ReactNode } from 'react';

/**
 * 의존성 없는 경량 마크다운 렌더러.
 * 에이전트 답변(스트리밍 중 포함)을 안전하게 React 엘리먼트로 그립니다.
 * 지원: 제목 / 강조 / 인라인 코드 / 코드 블록 / 목록(중첩·체크박스) / 표 / 인용 / 구분선 / 링크 / 이미지
 * 원시 HTML 은 해석하지 않고 문자 그대로 출력하므로 XSS 위험이 없습니다.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(text)}</div>;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) { index += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker}{3,}\\s*$`).test(lines[index])) {
        body.push(lines[index]); index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre className="md-code" key={key++}>
          {fence[2] && <span className="md-code-lang">{fence[2]}</span>}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(level + 2, 6)}` as 'h3';
      nodes.push(<Tag className={`md-h md-h${level}`} key={key++}>{renderInline(heading[2])}</Tag>);
      index += 1;
      continue;
    }

    if (RULE.test(line)) { nodes.push(<hr className="md-hr" key={key++} />); index += 1; continue; }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && (QUOTE.test(lines[index]) || (body.length > 0 && lines[index].trim()))) {
        const match = QUOTE.exec(lines[index]);
        body.push(match ? match[1] : lines[index]);
        index += 1;
      }
      nodes.push(<blockquote className="md-quote" key={key++}>{renderBlocks(body.join('\n'))}</blockquote>);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[index + 1]).map(readAlign);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index])); index += 1;
      }
      nodes.push(
        <div className="md-table-wrap" key={key++}>
          <table className="md-table">
            <thead><tr>{header.map((cell, i) => <th key={i} style={{ textAlign: aligns[i] || 'left' }}>{renderInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{header.map((_, c) => <td key={c} style={{ textAlign: aligns[c] || 'left' }}>{renderInline(row[c] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const block: string[] = [];
      const baseIndent = first[1].length;
      const ordered = Boolean(first[3]);
      const sameKind = (candidate: string) => {
        const item = LIST_ITEM.exec(candidate);
        return Boolean(item) && Boolean((item as RegExpExecArray)[3]) === ordered;
      };
      while (index < lines.length) {
        const current = lines[index];
        if (!current.trim()) {
          const next = lines[index + 1] ?? '';
          if (!next.trim()) break;
          if (indentOf(next) <= baseIndent && !sameKind(next)) break;
          block.push(current); index += 1; continue;
        }
        const currentIndent = indentOf(current);
        if (currentIndent > baseIndent) { block.push(current); index += 1; continue; }
        if (LIST_ITEM.test(current) && currentIndent === baseIndent) {
          if (!sameKind(current)) break;
          block.push(current); index += 1; continue;
        }
        break;
      }
      nodes.push(renderList(block, baseIndent, key++));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !FENCE.test(lines[index]) && !HEADING.test(lines[index])
      && !RULE.test(lines[index]) && !QUOTE.test(lines[index]) && !LIST_ITEM.test(lines[index])) {
      paragraph.push(lines[index]); index += 1;
    }
    nodes.push(<p className="md-p" key={key++}>{renderInline(paragraph.join('\n'))}</p>);
  }

  return nodes;
}

function indentOf(line: string) { return line.length - line.trimStart().length; }
function splitRow(line: string) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()); }
function readAlign(cell: string): 'left' | 'center' | 'right' {
  const left = cell.startsWith(':'); const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function renderList(block: string[], baseIndent: number, key: number) {
  type Item = { checked: boolean | null; lines: string[] };
  const items: Item[] = [];
  let ordered = false;
  let startNumber = 1;

  for (const line of block) {
    const match = LIST_ITEM.exec(line);
    if (match && indentOf(line) === baseIndent) {
      if (match[3]) { ordered = true; if (!items.length) startNumber = Number(match[3]) || 1; }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(match[4]);
      items.push({ checked: task ? task[1].toLowerCase() === 'x' : null, lines: [task ? task[2] : match[4]] });
      continue;
    }
    if (!items.length) continue;
    items[items.length - 1].lines.push(line.slice(Math.min(baseIndent + 2, indentOf(line))));
  }

  const children = items.map((item, i) => {
    const content = renderBlocks(item.lines.join('\n'));
    const unwrapped = content.length === 1 && isParagraph(content[0]) ? (content[0] as { props: { children: ReactNode } }).props.children : content;
    return <li className={item.checked === null ? undefined : 'md-task'} key={i}>
      {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly />}
      {unwrapped}
    </li>;
  });

  return ordered
    ? <ol className="md-ol" start={startNumber} key={key}>{children}</ol>
    : <ul className="md-ul" key={key}>{children}</ul>;
}

function isParagraph(node: ReactNode) {
  return Boolean(node) && typeof node === 'object' && (node as { type?: unknown }).type === 'p';
}

const INLINE_SOURCE = [
  '(`+)([\\s\\S]*?)\\1',
  '!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '\\*\\*([\\s\\S]+?)\\*\\*',
  '__([\\s\\S]+?)__',
  '~~([\\s\\S]+?)~~',
  '\\*([^*\\n]+?)\\*',
  '(?<![\\w])_([^_\\n]+?)_(?![\\w])',
  '(https?://[^\\s<>()]+)',
].join('|');

function safeUrl(url: string) {
  return /^(https?:|mailto:|\/|#|data:image\/)/i.test(url) ? url : '#';
}

function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  let last = 0;
  let key = 0;
  let match = pattern.exec(source);

  while (match) {
    if (match.index > last) nodes.push(...withBreaks(source.slice(last, match.index), key++));
    const [, , code, imageAlt, imageUrl, linkText, linkUrl, strong1, strong2, strike, em1, em2, autolink] = match;

    if (code !== undefined) nodes.push(<code className="md-inline-code" key={key++}>{code.trim()}</code>);
    // oxlint-disable-next-line next/no-img-element -- User-supplied Markdown images have unknown dimensions and use native lazy loading.
    else if (imageUrl) nodes.push(<img className="md-img" src={safeUrl(imageUrl)} alt={imageAlt || ''} loading="lazy" key={key++} />);
    else if (linkUrl) nodes.push(<a className="md-link" href={safeUrl(linkUrl)} target="_blank" rel="noreferrer noopener" key={key++}>{renderInline(linkText)}</a>);
    else if (strong1 || strong2) nodes.push(<strong key={key++}>{renderInline(strong1 || strong2)}</strong>);
    else if (strike) nodes.push(<del key={key++}>{renderInline(strike)}</del>);
    else if (em1 || em2) nodes.push(<em key={key++}>{renderInline(em1 || em2)}</em>);
    else if (autolink) nodes.push(<a className="md-link" href={safeUrl(autolink)} target="_blank" rel="noreferrer noopener" key={key++}>{autolink}</a>);

    last = match.index + match[0].length;
    match = pattern.exec(source);
  }

  if (last < source.length) nodes.push(...withBreaks(source.slice(last), key++));
  return nodes;
}

function withBreaks(text: string, key: number): ReactNode[] {
  const parts = text.split('\n');
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<br key={`${key}-${i}`} />, part]));
}
