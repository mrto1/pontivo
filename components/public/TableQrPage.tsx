import type { Hotel } from "@/src/db/schema";
import { Shell } from "./Shell";
import { AutoRefresh } from "./AutoRefresh";
import { formatChf } from "@/src/domain/money";
import { TQ } from "@/src/i18n/tableqr";
import type { Locale } from "@/src/i18n/dict";
import { feedbackOf, paymentByToken, reviewUrl, tableBill, tableByQr } from "@/src/services/table-pay";
import { notFound } from "next/navigation";
import { feedbackAction, orderTableAction, payTableAction } from "./table-qr-actions";
import { MenuPicker } from "./MenuPicker";
import { onlineMenu } from "@/src/services/online-orders";
import { getSettings } from "@/src/services/reservations";

/** Zahlung am Tisch per QR (SPEC 19.55): offene Posten wählen, Trinkgeld, bezahlen; danach Bewertung */
export async function TableQrPage({ hotel, locale, base, qr, sp }: { hotel: Hotel; locale: Locale; base: string; qr: string; sp: Record<string, string | string[] | undefined> }) {
  const t = TQ[locale];
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const found = await tableByQr(qr);
  if (!found || found.hotel.id !== hotel.id) notFound();
  const { table } = found;
  const ready = !!(hotel.stripeAccountId && hotel.stripeChargesEnabled);
  const z = one("z");
  const pay = z ? await paymentByToken(z) : null;
  const mine = pay && pay.hotelId === hotel.id && pay.tableId === table.id ? pay : null;
  const hidden = <><input type="hidden" name="qr" value={qr} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="base" value={base} /></>;
  if (mine) {
    const fb = mine.status === "paid" ? await feedbackOf(mine.id) : null;
    const url = fb && fb.stars >= 4 ? await reviewUrl(hotel.id) : "";
    return (
      <Shell hotel={hotel} locale={locale} base={base} path={`/am-tisch/${qr}`} noBookButton>
        <section className="stack pad32-560" data-testid="table-qr-done">
          {mine.status === "pending" ? <><AutoRefresh seconds={5} /><h1>{t.title(table.name)}</h1><p className="notice">{t.pending}</p></> : null}
          {mine.status === "failed" || mine.status === "cancelled" ? <><h1>{t.title(table.name)}</h1><p className="notice warn">{t.failed}</p></> : null}
          {mine.status === "paid" ? (
            <>
              <h1>{t.thanks}</h1>
              <p>{formatChf(mine.itemsRappen + mine.tipRappen)}{mine.tipRappen ? ` · ${t.tip} ${formatChf(mine.tipRappen)}` : ""}</p>
              {fb ? (
                <div className="stack">
                  <p className="notice">{t.feedbackDone}</p>
                  {url ? <><p>{t.rateGood}</p><p><a className="btn" href={url} rel="noopener noreferrer" target="_blank">{t.google}</a></p></> : null}
                </div>
              ) : (
                <form action={feedbackAction} className="card stack" data-testid="feedback-form">
                  {hidden}<input type="hidden" name="z" value={mine.publicToken} />
                  <h2>{t.rate}</h2>
                  <div className="seg" role="radiogroup" aria-label={t.rate}>
                    {[1, 2, 3, 4, 5].map((n) => <label key={n} className="btn secondary"><input type="radio" name="stars" value={n} required defaultChecked={n === 5} /> {"★".repeat(n)}</label>)}
                  </div>
                  <div><label htmlFor="fc">{t.rateComment}</label><textarea id="fc" name="comment" rows={3} maxLength={1000} /></div>
                  <div><button className="btn">{t.send}</button></div>
                </form>
              )}
            </>
          ) : null}
        </section>
      </Shell>
    );
  }
  const bill = ready ? await tableBill(hotel.id, table.id) : { lines: [], totalRappen: 0 };
  const orders = [...new Set(bill.lines.map((l) => l.orderId))];
  const ordering = !!(await getSettings(hotel.id)).qrOrdering;
  const menu = ordering ? await onlineMenu(hotel.id) : [];
  return (
    <Shell hotel={hotel} locale={locale} base={base} path={`/am-tisch/${qr}`} noBookButton>
      <section className="stack pad32-560" data-testid="table-qr">
        <h1>{menu.length ? table.name : t.title(table.name)}</h1>
        {one("msg") ? <p className="notice error" role="alert">{one("msg")}</p> : null}
        {one("bestellt") ? <p className="notice" role="status" data-testid="qr-ordered">{t.ordered}</p> : null}
        {one("abgebrochen") ? <p className="notice warn">{t.cancelled}</p> : null}
        {menu.length ? (
          <form action={orderTableAction} className="card stack" data-testid="qr-order-form">
            {hidden}
            <h2>{t.orderTitle}</h2>
            <p className="small muted m0">{t.orderHint}</p>
            <MenuPicker menu={menu} locale={locale} />
            <div><button className="btn">{t.orderSend}</button></div>
          </form>
        ) : null}
        {menu.length ? <h2>{t.payTitle}</h2> : null}
        {!ready ? <p className="notice warn">{t.off}</p> : !orders.length ? <p className={menu.length ? "small muted" : "notice"}>{menu.length ? t.payLater : t.none}</p> : orders.map((oid, n) => (
          <form key={oid} action={payTableAction} className="card stack" data-testid="pay-form">
            {hidden}<input type="hidden" name="orderId" value={oid} />
            <h2>{orders.length > 1 ? t.billOf(String(n + 1)) : t.open}</h2>
            <div className="stack">
              {bill.lines.filter((l) => l.orderId === oid).map((l) => (
                <div key={l.lineId} className="tq-line">
                  <label htmlFor={`q_${l.lineId}`}>{l.description}</label>
                  <span className="small muted">{formatChf(l.unitPriceRappen)}</span>
                  <input id={`q_${l.lineId}`} name={`q_${l.lineId}`} type="number" min={0} max={l.openQty} defaultValue={l.openQty} aria-label={l.description} />
                </div>
              ))}
            </div>
            <fieldset className="stack"><legend><strong>{t.tip}</strong> <span className="small muted">{t.tipHint}</span></legend>
              <div className="seg tq-tip" role="radiogroup" aria-label={t.tip}>
                {[["0", t.tipNone], ["5", "5 %"], ["10", "10 %"], ["15", "15 %"], ["custom", "…"]].map(([v, label]) => <label key={v} className="btn secondary"><input type="radio" name="tip" value={v} defaultChecked={v === "0"} /> {label}</label>)}
              </div>
              <div><label htmlFor={`tc-${oid}`}>{t.tipOther}</label><input id={`tc-${oid}`} name="tipCustom" inputMode="decimal" placeholder="0.00" /></div>
            </fieldset>
            <div><label htmlFor={`em-${oid}`}>{t.email}</label><input id={`em-${oid}`} name="email" type="email" maxLength={200} autoComplete="email" /><p className="small muted m0">{t.emailHint}</p></div>
            <div><button className="btn">{t.pay(formatChf(bill.lines.filter((l) => l.orderId === oid).reduce((a, l) => a + l.openQty * l.unitPriceRappen, 0)))}</button></div>
          </form>
        ))}
      </section>
    </Shell>
  );
}
