import { describe, expect, it } from "vitest";
import { mentionEmail, passwordResetEmail, verificationEmail } from "../../src/lib/mailer";

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

describe("mentionEmail", () => {
  const opts = { link: "https://linkroom.app/r/x7Kp2qLm", roomTitle: "Chapter 3", actorName: "Ana", body: "@Cleo look at this" };

  it("says who tagged you where, quotes the message and links back first", () => {
    const { subject, html, text } = mentionEmail(opts);
    expect(subject).toBe("Ana mentioned you in Chapter 3");
    expect(html.match(/href="([^"]+)"/)?.[1]).toBe(opts.link);
    expect(text).toContain(opts.link);
    expect(text).toContain("@Cleo look at this");
  });

  it("escapes everything people typed", () => {
    const { html } = mentionEmail({ ...opts, actorName: "<b>x</b>", roomTitle: "<script>", body: "<img src=x>" });
    expect(html).not.toMatch(/<b>|<script>|<img/);
  });

  it("shortens a long message", () => {
    const { text } = mentionEmail({ ...opts, body: "a".repeat(400) });
    expect(text).toContain(`${"a".repeat(280)}…`);
    expect(text).not.toContain("a".repeat(281));
  });
});

describe("passwordResetEmail", () => {
  const RESET = "https://linkroom.app/forgot-password?token_hash=abc";

  it("puts the reset link first, and says ignoring it keeps the password", () => {
    const { subject, html, text } = passwordResetEmail(RESET, "Ana");
    expect(subject).toBe("Reset your LinkRoom password");
    expect(html.match(/href="([^"]+)"/)?.[1]).toBe(RESET);
    expect(text).toContain(RESET);
    expect(text).toMatch(/^Hi Ana,/);
    expect(text).toMatch(/ignore this email/);
  });

  it("escapes the name", () => {
    expect(passwordResetEmail(RESET, "<b>x</b>").html).not.toContain("<b>x</b>");
  });
});
