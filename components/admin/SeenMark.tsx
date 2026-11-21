"use client";
import { useEffect } from "react";
import { markSeenAction } from "@/app/admin/seen-actions";
import type { SeenKind } from "@/src/domain/unseen";

/** Beim Öffnen einer Liste: «gesehen» für diese Person speichern; die Zahlen im Menü werden danach neu geladen */
export function SeenMark({ hotelId, kind }: { hotelId: string; kind: SeenKind }) {
  useEffect(() => { void markSeenAction(hotelId, kind); }, [hotelId, kind]);
  return null;
}
