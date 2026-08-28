"use client";

import { Fragment, type ReactNode } from "react";

import { parseInline, type Inline } from "@/lib/answerText";

/**
 * Renders the answer bank's markdown dialect.
 *
 * Shared between the answer body and the source panel so a passage looks the
 * same in both places -- the panel quotes the answer's own paragraph, and it
 * would be odd for the Arabic in it to be set one way in the thread and another
 * way in the drawer.
 */
interface Props {
  text: string;
  /**
   * How to draw a `[n]` marker. Omitted in the source panel, where the marker
   * would point at the drawer the reader is already looking at, so it is
   * dropped rather than rendered as a dead number.
   */
  renderCite?: (ordinal: number, key: string) => ReactNode;
}

export function RichText({ text, renderCite }: Props) {
  return <>{render(parseInline(text), "r", renderCite)}</>;
}

function render(
  nodes: Inline[],
  prefix: string,
  renderCite: Props["renderCite"],
): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${prefix}-${i}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.text}</Fragment>;
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {render(node.children, key, renderCite)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic">
            {render(node.children, key, renderCite)}
          </em>
        );
      case "arabic":
        return (
          <span
            key={key}
            lang="ar"
            dir="rtl"
            className={node.block ? "arabic-block" : "arabic-inline"}
          >
            {node.text}
          </span>
        );
      case "code":
        return (
          <code key={key} className="rounded px-1 text-[0.9em]">
            {node.text}
          </code>
        );
      case "cite":
        return renderCite ? (
          <Fragment key={key}>{renderCite(node.ordinal, key)}</Fragment>
        ) : null;
    }
  });
}
