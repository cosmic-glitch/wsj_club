import React from "react";

/**
 * The tiny bit of Markdown the content JSONs are allowed to use.
 *
 * Authored prose in `content/*.json` (a concept's `meaning` above all — the
 * long Feynman explanations) is written with `**bold**` and `*italic*`, because
 * that's simply how one writes emphasis in a text field. The handout used to
 * render those strings raw, so every marker showed up on the page as literal
 * asterisks ("That third category is called **antifragile**"). This module is
 * the one place that turns them into real emphasis, so any component rendering
 * authored prose gets it by using `<Rich>` / `<RichParagraphs>` instead of
 * dropping the string straight into JSX.
 *
 * Deliberately NOT a Markdown library and deliberately NOT
 * `dangerouslySetInnerHTML`: it parses into React elements, so authored content
 * can never inject markup. Only inline emphasis is supported — no links, lists,
 * or headings. Paragraphs come from blank lines (see `RichParagraphs`), which
 * is the convention the content files already follow.
 */

/** `**bold**` (checked first, so `**x**` never parses as two italics) or `*italic*`. */
const EMPHASIS = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/**
 * Parse one string's inline emphasis into React nodes.
 *
 * An unmatched marker (a stray asterisk, or a `*` used as a real asterisk) is
 * left exactly as typed rather than swallowed — losing a character would be
 * worse than showing one.
 */
export function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(EMPHASIS)) {
    const at = m.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    if (m[1] !== undefined) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else nodes.push(<em key={key++}>{m[2]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return nodes;
}

/** Inline authored prose (one paragraph's worth) with its emphasis rendered. */
export function Rich({ text }: { text: string }) {
  return <>{parseInline(text)}</>;
}

/**
 * Authored prose that may run to several paragraphs, split on blank lines —
 * the shape a concept's `meaning` uses. `className` applies to every paragraph;
 * `firstClassName` overrides it for the first (the cards give paragraph one a
 * larger top margin).
 */
export function RichParagraphs({
  text,
  className,
  firstClassName,
}: {
  text: string;
  className?: string;
  firstClassName?: string;
}) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} className={i === 0 ? (firstClassName ?? className) : className}>
          {parseInline(para)}
        </p>
      ))}
    </>
  );
}

/**
 * The same markers stripped back to plain text — for the places authored prose
 * is consumed by something that isn't the browser. The voice quiz feeds concept
 * meanings to the tutor and grader as the answer key (`lib/quiz-prompt.ts`), and
 * a model shouldn't have to reason about stray asterisks — or, worse, read one
 * aloud through TTS.
 */
export function stripMarkdown(text: string): string {
  return text.replace(EMPHASIS, (_, bold, italic) => bold ?? italic);
}
