import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A model's paragraph, drawn.
 *
 * The chat used to hand the model a vocabulary of blocks for everything,
 * prose included: a sentence was a string with `{{ref}}` placeholders that the
 * application resolved, and a figure the model typed itself was discarded
 * before the seller saw it. The guarantee was real — no number reached the
 * screen that could not be traced to a row — and the cost turned out to be
 * higher than the guarantee was worth. A model asked a comparative question
 * had no ref for the comparison, so it wrote the percentage, and the paragraph
 * carrying the answer was thrown away. What arrived instead was an empty
 * bubble.
 *
 * So prose is now prose. The model writes Markdown, the seller reads Markdown,
 * and figures are the model's own words. The other block kinds are unchanged
 * and still resolve every number from the fact table, which is where the
 * answer's arithmetic belongs — this renders the sentences around them.
 *
 * ## What is deliberately not supported
 *
 * Raw HTML. `react-markdown` ignores it unless `rehype-raw` is added, and it is
 * not added: a product title is data that reaches this component through the
 * model, and data that can inject markup is data that can inject anything.
 *
 * Links. A `[text](url)` renders as its text, without the href. The model has
 * no reason to send the seller off-site — navigation inside the dashboard is
 * the `nav.open` action, which is a button the seller presses — and a URL in a
 * model's answer more likely came from a product title or a customer comment
 * than from the model's own intent.
 */
export function Markdown({ children }: { readonly children: string }): ReactNode {
  return (
    <div className="flex flex-col gap-6 [font-variant-numeric:tabular-nums]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The design system, as Markdown nodes.
 *
 * Every element is mapped by hand rather than through a typography plugin,
 * because the surrounding panel is drawn at 11–13px on its own scale and a
 * stylesheet built for article text overrides all of it.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="m-0">{children}</p>,

  strong: ({ children }) => <strong className="font-medium text-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-faint line-through">{children}</del>,

  ul: ({ children }) => (
    <ul className="m-0 flex list-disc flex-col gap-3 pl-16 marker:text-faint">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="m-0 flex list-decimal flex-col gap-3 pl-16 marker:text-faint">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-2">{children}</li>,

  /* Three levels collapse to one weight. A heading inside a chat answer marks a
     section, not a document hierarchy, and the panel has no room for a scale. */
  h1: ({ children }) => <Heading>{children}</Heading>,
  h2: ({ children }) => <Heading>{children}</Heading>,
  h3: ({ children }) => <Heading>{children}</Heading>,
  h4: ({ children }) => <Heading>{children}</Heading>,
  h5: ({ children }) => <Heading>{children}</Heading>,
  h6: ({ children }) => <Heading>{children}</Heading>,

  blockquote: ({ children }) => (
    <blockquote className="m-0 border-l-2 border-line-2 pl-10 text-faint">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-0 border-t border-line" />,

  code: ({ children }) => (
    <code className="rounded-4 bg-raise px-3 py-px font-mono text-tiny text-text">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="m-0 overflow-x-auto rounded-6 bg-raise p-8 font-mono text-tiny">
      {children}
    </pre>
  ),

  /* A table wide enough to overflow scrolls inside itself; the panel does not. */
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line px-6 py-3 font-medium text-faint">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line-2 px-6 py-3 align-top">{children}</td>,

  /* See the note above: the text of a link, never the link. */
  a: ({ children }) => <span className="underline decoration-line underline-offset-2">{children}</span>,
  img: () => null,
};

function Heading({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="font-medium text-text">{children}</span>;
}
