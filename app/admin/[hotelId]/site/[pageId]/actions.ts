"use server";
import { addBlock, deleteBlock, moveBlock, photoLibrary, updateBlock, updatePageMeta } from "@/src/services/site";
import { isLocale, LOCALES, type Locale } from "@/src/i18n/dict";
import { translatePage } from "@/src/services/translate";
import type { BlockType } from "@/src/domain/blocks";
import { blockFromForm, l10n } from "@/src/domain/block-form";
import { hotelAction, type ActionOptions } from "@/src/lib/hotel-action";
import { s } from "@/src/lib/form";

/** Zurück in den Editor: Sprache bleibt, `at` lässt die Vorschau zum bearbeiteten Baustein springen */
function opts(f: FormData, blockId = ""): ActionOptions {
  return {
    page: `site/${s(f, "pageId")}`,
    role: "manager",
    keep: { at: blockId, lang: isLocale(s(f, "editLang")) ? s(f, "editLang") : "" },
    anchor: blockId ? `#b-${blockId}` : "",
  };
}

export async function saveMeta(f: FormData) {
  await hotelAction(f, { ...opts(f), ok: "Seite gespeichert" }, ({ hotel, actor }) =>
    updatePageMeta(hotel.id, s(f, "pageId"), {
      title: l10n(f, "title"),
      navLabel: l10n(f, "nav"),
      slug: s(f, "slug"),
      showInNav: f.get("showInNav") === "on",
      published: f.get("published") === "on",
      seo: Object.fromEntries(LOCALES.map((l) => [l, { title: s(f, `seoTitle.${l}`) || undefined, description: s(f, `seoDesc.${l}`) || undefined }])) as never,
    }, actor).then(() => undefined));
}

export async function saveBlock(f: FormData) {
  const blockId = s(f, "blockId");
  await hotelAction(f, { ...opts(f, blockId), ok: "Baustein gespeichert" }, async ({ hotel, actor }) => {
    const alts = new Map((await photoLibrary(hotel)).map((p) => [p.url, p.alt]));
    await updateBlock(hotel.id, s(f, "pageId"), blockId, blockFromForm(f, s(f, "type") as BlockType, blockId, alts), actor);
  });
}

export async function translateAction(f: FormData) {
  const blockId = s(f, "blockId");
  await hotelAction(f, opts(f, blockId), async ({ hotel, actor }) => {
    const only = { blockId: blockId || undefined, lang: isLocale(s(f, "onlyLang")) ? (s(f, "onlyLang") as Locale) : undefined };
    const n = await translatePage(hotel, s(f, "pageId"), s(f, "mode") === "all" ? "all" : "missing", actor, only);
    return n ? `${n} Feld(er) übersetzt – bitte kurz gegenlesen` : "Nichts zu übersetzen: alle Felder sind schon ausgefüllt";
  });
}

export async function blockAction(f: FormData) {
  const blockId = s(f, "blockId");
  const action = s(f, "action");
  await hotelAction(f, opts(f, action === "delete" ? "" : blockId), async ({ hotel, actor }) => {
    if (action === "up" || action === "down") await moveBlock(hotel.id, s(f, "pageId"), blockId, action === "up" ? -1 : 1, actor);
    else if (action === "delete") await deleteBlock(hotel.id, s(f, "pageId"), blockId, actor);
    return action === "delete" ? "Baustein entfernt" : "Verschoben";
  });
}

export async function newBlockAction(f: FormData) {
  await hotelAction(f, { ...opts(f), fail: "Nicht möglich" }, async ({ hotel, actor }) => {
    const id = await addBlock(hotel.id, s(f, "pageId"), s(f, "type") as BlockType, actor);
    return { to: `/admin/${hotel.id}/site/${s(f, "pageId")}?msg=${encodeURIComponent("Baustein hinzugefügt – jetzt ausfüllen")}#b-${id}` };
  });
}
