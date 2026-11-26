'use client';

import { Children, isValidElement, cloneElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders user-written Markdown (decision record 0019): GitHub-flavoured Markdown (headings,
 * lists, task lists, tables, code, links, quotes) with DevTrack styles.
 *
 * Safety: raw HTML in the text is dropped (`skipHtml`), never rendered, and react-markdown's
 * default URL filter removes `javascript:` and other unsafe link targets. Links open in a new
 * tab without passing the page as opener or referrer.
 *
 * `mentions` highlights `@username` for people the server resolved, like plain comments did.
 */
export function Markdown({
  children,
  mentions,
  className = '',
  imagesAsLinks = false,
}: {
  children: string;
  mentions?: ReadonlySet<string>;
  className?: string;
  /**
   * Shows images as links instead of loading them, for Markdown written by people outside
   * the team (request form files, 0022), so opening it never contacts their servers.
   */
  imagesAsLinks?: boolean;
}) {
  const mark = (nodes: ReactNode) => (mentions?.size ? highlightMentions(nodes, mentions) : nodes);
  const components: Components = {
    p: ({ children }) => <p>{mark(children)}</p>,
    li: ({ children, className }) => <li className={className}>{mark(children)}</li>,
    td: ({ children }) => <td>{mark(children)}</td>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    ...(imagesAsLinks
      ? {
          img: ({ src, alt }) =>
            typeof src === 'string' && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt ? `Image: ${alt}` : 'Image'}
              </a>
            ) : null,
        }
      : {}),
    // Task-list boxes are read-only here; the checklist (0018) is the interactive version.
    input: ({ type, checked }) =>
      type === 'checkbox' ? (
        <input type="checkbox" checked={Boolean(checked)} disabled readOnly />
      ) : null,
  };
  return (
    <div className={`dt-markdown ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const MENTION = /@([A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9])/g;

/** Wraps known `@username`s in plain-text children; leaves code and links alone. */
function highlightMentions(nodes: ReactNode, known: ReadonlySet<string>): ReactNode {
  return Children.map(nodes, (node) => {
    if (typeof node === 'string') {
      const parts: ReactNode[] = [];
      let last = 0;
      for (const match of node.matchAll(MENTION)) {
        if (!known.has(match[1]!.toLowerCase())) continue;
        parts.push(node.slice(last, match.index));
        parts.push(
          <span key={match.index} className="font-medium text-primary">
            {match[0]}
          </span>,
        );
        last = match.index! + match[0].length;
      }
      if (parts.length === 0) return node;
      parts.push(node.slice(last));
      return parts;
    }
    if (
      isValidElement<{ children?: ReactNode }>(node) &&
      node.type !== 'code' &&
      node.type !== 'a'
    ) {
      const inner = node.props.children;
      return inner === undefined
        ? node
        : cloneElement(node, undefined, highlightMentions(inner, known));
    }
    return node;
  });
}
