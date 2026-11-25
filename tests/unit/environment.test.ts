import { describe, expect, it } from "vitest";
import { applyMailGuard } from "../../src/lib/environment";

const msg = { from: "a@pontivo.ch", to: "gast@example.ch", subject: "Bestätigung", html: "<p>Hallo</p>", text: "Hallo" };

describe("Mail-Schutz der Testumgebung", () => {
  it("ohne Umleitung unverändert", () => expect(applyMailGuard(msg, undefined)).toBe(msg));
  it("leitet um und nennt den ursprünglichen Empfänger", () => {
    const r = applyMailGuard(msg, "test@pontivo.ch");
    expect(r.to).toBe("test@pontivo.ch");
    expect(r.subject).toContain("gast@example.ch");
    expect(r.text).toContain("gast@example.ch");
    expect(r.html).toContain("gast@example.ch");
  });
  it("Mail an die Testadresse selbst bleibt unverändert", () => expect(applyMailGuard({ ...msg, to: "Test@pontivo.ch" }, "test@pontivo.ch").subject).toBe("Bestätigung"));
});

describe("Mail-Fänger (SMTP_URL)", () => {
  it("sendViaSmtp übergibt die Mail an den SMTP-Server", async () => {
    const net = await import("node:net");
    const { sendViaSmtp } = await import("../../src/email/send");
    const lines: string[] = [];
    const server = net.createServer((sock) => {
      sock.write("220 test\r\n");
      let data = false;
      sock.on("data", (b) => {
        const s = b.toString();
        lines.push(s);
        if (data) { if (s.includes("\r\n.\r\n")) { data = false; sock.write("250 ok\r\n"); } return; }
        if (/^DATA/i.test(s)) { data = true; sock.write("354 go\r\n"); }
        else if (/^QUIT/i.test(s)) sock.end("221 bye\r\n");
        else if (/^EHLO/i.test(s)) sock.write("250 ok\r\n");
        else sock.write("250 ok\r\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as import("node:net").AddressInfo).port;
    await sendViaSmtp(`smtp://127.0.0.1:${port}`, msg);
    server.close();
    expect(lines.join("")).toContain("gast@example.ch");
  });
});
