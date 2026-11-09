import { parseRich, type Inline } from "@/src/domain/richtext";

function Inlines({ xs }: { xs: Inline[] }) {
  return (
    <>
      {xs.map((x, i) => {
        switch (x.t) {
          case "text": return <span key={i}>{x.v}</span>;
          case "b": return <strong key={i}><Inlines xs={x.c} /></strong>;
          case "i": return <em key={i}><Inlines xs={x.c} /></em>;
          case "u": return <u key={i}><Inlines xs={x.c} /></u>;
          case "mark": return <span key={i} className="hl"><Inlines xs={x.c} /></span>;
          case "a": {
            const external = /^https?:\/\//i.test(x.href);
            return <a key={i} href={x.href} {...(external ? { target: "_blank", rel: "noopener" } : {})}><Inlines xs={x.c} /></a>;
          }
        }
      })}
    </>
  );
}

/** Formatierten Text darstellen (Absätze, Listen, Zwischentitel, fett/kursiv/unterstrichen, Links) – ohne HTML aus den Daten */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((b, i) => {
        switch (b.kind) {
          case "p": return <p key={i}>{b.lines.map((l, k) => <span key={k}>{k ? <br /> : null}<Inlines xs={l} /></span>)}</p>;
          case "h": return <h3 key={i}><Inlines xs={b.c} /></h3>;
          case "ul": return <ul key={i} className="rich-list">{b.items.map((it, k) => <li key={k}><Inlines xs={it} /></li>)}</ul>;
          case "ol": return <ol key={i} className="rich-list">{b.items.map((it, k) => <li key={k}><Inlines xs={it} /></li>)}</ol>;
        }
      })}
    </>
  );
}
