import { describe, expect, it } from "vitest";
import { buildExternalProfileLinks } from "../../frontend/src/lib/externalProfileLinks.js";

describe("buildExternalProfileLinks", () => {
  it("builds NA op.gg and u.gg URLs for a player with an NA1 tag", () => {
    const links = buildExternalProfileLinks({
      gameName: "REBLxKiller",
      tagLine: "NA1",
    });

    expect(links.opgg).toBe("https://op.gg/lol/summoners/na/REBLxKiller-NA1");
    expect(links.ugg).toBe("https://u.gg/lol/profile/na1/reblxkiller-na1/overview");
  });

  it("defaults to NA regardless of tag line", () => {
    const links = buildExternalProfileLinks({
      gameName: "Whiff",
      tagLine: "yup",
    });

    expect(links.opgg).toBe("https://op.gg/lol/summoners/na/Whiff-yup");
    expect(links.ugg).toBe("https://u.gg/lol/profile/na1/whiff-yup/overview");
  });

  it("accepts an explicit region override", () => {
    const links = buildExternalProfileLinks({
      gameName: "REBLxKiller",
      tagLine: "NA1",
      region: "na1",
    });

    expect(links.opgg).toBe("https://op.gg/lol/summoners/na/REBLxKiller-NA1");
    expect(links.ugg).toBe("https://u.gg/lol/profile/na1/reblxkiller-na1/overview");
  });

  it("returns null links for unsupported regions", () => {
    const links = buildExternalProfileLinks({
      gameName: "Faker",
      tagLine: "KR1",
      region: "kr1",
    });

    expect(links.opgg).toBeNull();
    expect(links.ugg).toBeNull();
  });
});
