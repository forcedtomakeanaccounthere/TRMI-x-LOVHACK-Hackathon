import { describe, expect, it } from "vitest";
import { verificationEmail } from "../../src/lib/mailer";

const LINK = "https://api.linkroom.app/api/auth/verify?token_hash=abc&type=email";

describe("verificationEmail", () => {
  it("puts the verify link first in the HTML and in the plain text", () => {
    const { subject, html, text } = verificationEmail(LINK, "Arun");
    expect(subject).toBe("Confirm your LinkRoom account");
    expect(html.match(/href="([^"]+)"/)?.[1]).toBe(LINK.replace("&", "&amp;"));
    expect(text).toContain(LINK);
    expect(text).toMatch(/^Hi Arun,/);
  });

  it("escapes the name, which the user typed", () => {
    const { html } = verificationEmail(LINK, `<img src=x onerror="alert(1)">`);
    expect(html).not.toContain("<img");
    expect(html).toContain("Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;,");
  });

  it("greets without a name", () => {
    expect(verificationEmail(LINK).text).toMatch(/^Hi,\n/);
  });
});
