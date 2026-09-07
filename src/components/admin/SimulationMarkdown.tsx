// Renders the simulator's report.md / compare.md in the page. The reports
// use a small, known markdown subset (headings, tables, paragraphs, lists,
// blockquotes, inline code / bold / italic), so a tiny renderer keeps one
// source of truth (src/lib/sim/report.ts) without a markdown dependency.

import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|&nbsp;)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok === "&nbsp;") out.push(" ");
    else if (tok.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded px-1 font-mono text-[12px]" style={{ background: "var(--ink-100)" }}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function stripHtml(cell: string): string {
  return cell.replace(/<sub>(.*?)<\/sub>/g, "($1)").replace(/<[^>]+>/g, "");
}

export function SimulationMarkdown({ md }: { md: string }) {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const next = (): string => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line === "---") {
      blocks.push(<hr key={next()} className="my-6" style={{ borderColor: "var(--border)" }} />);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level === 1 ? "mt-2 text-2xl" : level === 2 ? "mt-8 text-xl" : level === 3 ? "mt-6 text-base font-semibold" : "mt-4 text-sm font-semibold";
      blocks.push(<div key={next()} className={cls}>{inline(stripHtml(h[2]!), next())}</div>);
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(lines[i++]!);
      const cells = (r: string): string[] => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cells(rows[0]!);
      const align = rows[1] ? cells(rows[1]).map((c) => (c.endsWith(":") ? "right" : "left")) : header.map(() => "left");
      const body = rows.slice(2).map(cells);
      blocks.push(
        <div key={next()} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse font-sans text-[13px]">
            <thead>
              <tr>
                {header.map((c, j) => (
                  <th key={j} className="border-b px-2 py-1.5 text-xs font-medium" style={{ textAlign: align[j] as "left" | "right", color: "var(--fg-subtle)", borderColor: "var(--border-strong)" }}>
                    {inline(stripHtml(c), `h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b px-2 py-1" style={{ textAlign: align[j] as "left" | "right", borderColor: "var(--border)", whiteSpace: "nowrap" }}>
                      {inline(stripHtml(c), `c${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(
        <blockquote key={next()} className="my-3 border-l-2 pl-3 font-sans text-[13px]" style={{ borderColor: "var(--brand)", color: "var(--fg-muted)" }}>
          {inline(line.slice(2), next())}
        </blockquote>,
      );
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i]!)) items.push(lines[i++]!.slice(2));
      blocks.push(
        <ul key={next()} className="my-2 list-disc pl-5 font-sans text-[13px]">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={next()} className="my-3 overflow-x-auto rounded-lg p-3 font-mono text-[12px]" style={{ background: "var(--ink-100)" }}>{code.join("\n")}</pre>);
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#|\||>|-|\*|`{3}|---)/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={next()} className="my-2 font-sans text-[13px] leading-relaxed" style={{ color: "var(--fg)" }}>{inline(stripHtml(para.join(" ")), next())}</p>);
  }
  return <div className="max-w-none">{blocks}</div>;
}
