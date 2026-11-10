import { NextResponse } from "next/server";
import { CheckinError, submitCheckin } from "@/src/services/guests";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  try {
    const r = await submitCheckin(token, body);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof CheckinError) {
      const status = e.code === "not_found" || e.code === "closed" ? 404 : e.code === "locked" ? 409 : 400;
      return NextResponse.json({ error: e.code, fields: e.fields }, { status });
    }
    throw e;
  }
}
