"use client";
import { useEffect, useRef, useState } from "react";
import { CI } from "@/src/i18n/checkin";
import type { Locale } from "@/src/i18n/dict";

type Country = { code: string; name: string };
type Person = {
  firstName: string; lastName: string; sex: string; birthDate: string; nationality: string; sameAddress: boolean;
  street: string; postalCode: string; city: string; country: string; docType: string; docNumber: string; vehiclePlate: string;
};
type Row = { firstName: string; lastName: string; birthDate: string; nationality: string };

const emptyPerson = (i: number, p?: Partial<Person>): Person => ({
  firstName: "", lastName: "", sex: "", birthDate: "", nationality: "", sameAddress: i > 0,
  street: "", postalCode: "", city: "", country: "", docType: "", docNumber: "", vehiclePlate: "", ...p,
});
const emptyRow = (): Row => ({ firstName: "", lastName: "", birthDate: "", nationality: "" });

/** Unterschrift mit Finger oder Maus → PNG (data-URL) */
function SignaturePad({ label, hint, clearLabel, onChange, invalid }: { label: string; hint: string; clearLabel: string; onChange: (png: string | null) => void; invalid: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <div>
      <label>{label}</label>
      <canvas
        ref={ref}
        className={`sig-pad${invalid ? " invalid" : ""}`}
        aria-label={label}
        onPointerDown={(e) => {
          drawing.current = true;
          ref.current!.setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext("2d")!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="small muted">{hint}</span>
        <button type="button" className="btn secondary small" onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          dirty.current = false;
          onChange(null);
        }}>{clearLabel}</button>
      </div>
    </div>
  );
}

export function CheckinForm(props: {
  token: string; locale: Locale; hotelName: string; persons: number; groupMode: boolean; signatureRequired: boolean;
  submitted: boolean; verified: boolean; retentionYears: number; countries: Country[];
  prefill: { firstName?: string; lastName?: string };
}) {
  const x = CI[props.locale];
  const [done, setDone] = useState(props.submitted);
  const [people, setPeople] = useState<Person[]>(() =>
    Array.from({ length: props.groupMode ? 1 : props.persons }, (_, i) => emptyPerson(i, i === 0 ? props.prefill : undefined)));
  const [rows, setRows] = useState<Row[]>(() => (props.groupMode ? Array.from({ length: props.persons - 1 }, emptyRow) : []));
  const [signature, setSignature] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<Set<string>>(new Set());

  if (props.verified) return <p className="notice">{x.verified}</p>;
  if (done) {
    return (
      <div className="card">
        <h2>{x.thanks}</h2>
        <p>{x.thanksText}</p>
        <button className="btn secondary small" onClick={() => setDone(false)}>{x.correct}</button>
      </div>
    );
  }

  const setP = (i: number, k: keyof Person, v: string | boolean) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const setR = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const inv = (k: string) => (bad.has(k) ? { "aria-invalid": true as const, className: "invalid" } : {});

  const countrySelect = (id: string, value: string, onChange: (v: string) => void, required = true) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} {...inv(id)}>
      <option value="">{x.choose}</option>
      {props.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/checkin/${props.token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persons: people, participants: rows, signature: signature ?? undefined, confirm }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setDone(true); window.scrollTo({ top: 0 }); return; }
      setBad(new Set<string>(j.fields ?? []));
      setError(j.error === "locked" ? x.errLocked : j.error === "signature" ? x.errSignature : j.error === "confirm" ? x.errConfirm : j.error === "invalid" ? x.errInvalid : x.errGeneric);
    } catch {
      setError(x.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack checkin-form" noValidate>
      <p>{x.intro(props.hotelName)}</p>
      {props.groupMode ? <p className="small muted">{x.groupIntro}</p> : null}
      {people.map((p, i) => {
        const k = (f: string) => `persons.${i}.${f}`;
        return (
          <fieldset key={i} className="card">
            <legend>{x.person(i + 1)}</legend>
            <div className="form-grid">
              <div><label htmlFor={k("firstName")}>{x.firstName}</label><input id={k("firstName")} value={p.firstName} onChange={(e) => setP(i, "firstName", e.target.value)} autoComplete={i === 0 ? "given-name" : "off"} required {...inv(k("firstName"))} /></div>
              <div><label htmlFor={k("lastName")}>{x.lastName}</label><input id={k("lastName")} value={p.lastName} onChange={(e) => setP(i, "lastName", e.target.value)} autoComplete={i === 0 ? "family-name" : "off"} required {...inv(k("lastName"))} /></div>
              <div><label htmlFor={k("birthDate")}>{x.birthDate}</label><input id={k("birthDate")} type="date" value={p.birthDate} onChange={(e) => setP(i, "birthDate", e.target.value)} autoComplete={i === 0 ? "bday" : "off"} required {...inv(k("birthDate"))} /></div>
              <div><label htmlFor={k("sex")}>{x.sex} <span className="muted">({x.optional})</span></label>
                <select id={k("sex")} value={p.sex} onChange={(e) => setP(i, "sex", e.target.value)}>
                  <option value="">–</option><option value="f">{x.sexF}</option><option value="m">{x.sexM}</option><option value="x">{x.sexX}</option>
                </select></div>
              <div><label htmlFor={k("nationality")}>{x.nationality}</label>{countrySelect(k("nationality"), p.nationality, (v) => setP(i, "nationality", v))}</div>
            </div>
            {i > 0 ? (
              <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={p.sameAddress} onChange={(e) => setP(i, "sameAddress", e.target.checked)} {...inv(k("sameAddress"))} />{x.sameAddress}</label>
            ) : null}
            {i === 0 || !p.sameAddress ? (
              <div className="form-grid">
                <div style={{ gridColumn: "1 / -1" }}><label htmlFor={k("street")}>{x.street}</label><input id={k("street")} value={p.street} onChange={(e) => setP(i, "street", e.target.value)} autoComplete={i === 0 ? "street-address" : "off"} required {...inv(k("street"))} /></div>
                <div><label htmlFor={k("postalCode")}>{x.postalCode}</label><input id={k("postalCode")} value={p.postalCode} onChange={(e) => setP(i, "postalCode", e.target.value)} autoComplete={i === 0 ? "postal-code" : "off"} required {...inv(k("postalCode"))} /></div>
                <div><label htmlFor={k("city")}>{x.city}</label><input id={k("city")} value={p.city} onChange={(e) => setP(i, "city", e.target.value)} autoComplete={i === 0 ? "address-level2" : "off"} required {...inv(k("city"))} /></div>
                <div><label htmlFor={k("country")}>{x.country}</label>{countrySelect(k("country"), p.country, (v) => setP(i, "country", v))}</div>
              </div>
            ) : null}
            <div className="form-grid">
              <div><label htmlFor={k("docType")}>{x.docType}</label>
                <select id={k("docType")} value={p.docType} onChange={(e) => setP(i, "docType", e.target.value)} {...inv(k("docType"))}>
                  <option value="">{x.choose}</option><option value="passport">{x.passport}</option><option value="id_card">{x.idCard}</option>
                  <option value="residence_permit">{x.residencePermit}</option><option value="other">{x.otherDoc}</option>
                </select></div>
              <div><label htmlFor={k("docNumber")}>{x.docNumber}</label><input id={k("docNumber")} value={p.docNumber} onChange={(e) => setP(i, "docNumber", e.target.value)} autoComplete="off" {...inv(k("docNumber"))} />
                {i > 0 ? <span className="small muted">{x.docMinorHint}</span> : null}</div>
              {i === 0 ? <div><label htmlFor={k("vehiclePlate")}>{x.vehicle} <span className="muted">({x.optional})</span></label><input id={k("vehiclePlate")} value={p.vehiclePlate} onChange={(e) => setP(i, "vehiclePlate", e.target.value)} autoComplete="off" /></div> : null}
            </div>
          </fieldset>
        );
      })}

      {props.groupMode ? (
        <fieldset className="card">
          <legend>{x.participants}</legend>
          <p className="small muted" style={{ marginTop: 0 }}>{x.participantsHint}</p>
          {rows.map((r, i) => {
            const k = (f: string) => `participants.${i}.${f}`;
            return (
              <div key={i} className="participant-row">
                <input aria-label={`${x.firstName} ${i + 2}`} placeholder={x.firstName} value={r.firstName} onChange={(e) => setR(i, "firstName", e.target.value)} {...inv(k("firstName"))} />
                <input aria-label={`${x.lastName} ${i + 2}`} placeholder={x.lastName} value={r.lastName} onChange={(e) => setR(i, "lastName", e.target.value)} {...inv(k("lastName"))} />
                <input aria-label={`${x.birthDate} ${i + 2}`} type="date" value={r.birthDate} onChange={(e) => setR(i, "birthDate", e.target.value)} {...inv(k("birthDate"))} />
                {countrySelect(k("nationality"), r.nationality, (v) => setR(i, "nationality", v))}
                <button type="button" className="btn secondary small" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{x.removeRow}</button>
              </div>
            );
          })}
          {rows.length < props.persons - 1 ? <button type="button" className="btn secondary small" onClick={() => setRows((rs) => [...rs, emptyRow()])}>{x.addRow}</button> : null}
        </fieldset>
      ) : null}

      {props.signatureRequired ? (
        <div className="card"><SignaturePad label={x.signature} hint={x.signHint} clearLabel={x.clear} onChange={setSignature} invalid={bad.has("signature")} /></div>
      ) : null}

      <label className="check"><input type="checkbox" {...inv("confirm")} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{x.confirm}</label>
      <p className="small muted">{x.privacy(props.retentionYears)}</p>
      {error ? <p className="notice warn" role="alert">{error}</p> : null}
      <div><button className="btn" disabled={busy}>{busy ? x.sending : x.submit}</button></div>
    </form>
  );
}
