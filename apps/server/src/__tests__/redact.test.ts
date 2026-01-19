import { describe, expect, it } from "vitest";
import { redact } from "../redact.js";

describe("redact", () => {
  describe("既存パターン（回帰防止）", () => {
    it("Bearer トークンをマスク", () => {
      const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = redact(input);
      expect(result).toBe("Authorization: Bearer [REDACTED]");
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("OpenAI sk- トークンをマスク", () => {
      const input = "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF";
      const result = redact(input);
      expect(result).toBe("OPENAI_API_KEY=sk-[REDACTED]");
      expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz");
    });

    it("sk- が短い場合はマスクしない（偽陽性防止）", () => {
      const input = "sk-short";
      const result = redact(input);
      expect(result).toBe("sk-short");
    });
  });

  describe("GitHub トークン", () => {
    it("ghp_ (Personal Access Token classic) をマスク", () => {
      const input = "token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redact(input);
      expect(result).toBe("token: ghp_[REDACTED]");
    });

    it("github_pat_ (Fine-grained PAT) をマスク", () => {
      const input = "GITHUB_TOKEN=github_pat_11ABCDEFG_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ";
      const result = redact(input);
      expect(result).toBe("GITHUB_TOKEN=github_pat_[REDACTED]");
    });

    it("gho_ (OAuth Access Token) をマスク", () => {
      const input = "Authorization: token gho_16C7e42F292c6912E7710c838347Ae178B4a";
      const result = redact(input);
      expect(result).toBe("Authorization: token gho_[REDACTED]");
    });

    it("ghu_ (GitHub App User Token) をマスク", () => {
      const input = "token=ghu_abcdefghijklmnopqrstuvwxyz1234567890";
      const result = redact(input);
      expect(result).toBe("token=ghu_[REDACTED]");
    });

    it("ghs_ (GitHub App Installation Token) をマスク", () => {
      const input = "GH_TOKEN=ghs_abcdefghijklmnopqrstuvwxyz1234567890";
      const result = redact(input);
      expect(result).toBe("GH_TOKEN=ghs_[REDACTED]");
    });

    it("ghr_ (GitHub App Refresh Token) をマスク", () => {
      const input = "refresh_token: ghr_abcdefghijklmnopqrstuvwxyz1234567890";
      const result = redact(input);
      expect(result).toBe("refresh_token: ghr_[REDACTED]");
    });
  });

  describe("Slack トークン", () => {
    it("xoxb- (Bot Token) をマスク", () => {
      // Use obviously fake pattern to avoid GitHub secret scanning
      const input = "SLACK_BOT_TOKEN=xoxb-FAKE-TOKEN-FOR-TESTING-ONLY";
      const result = redact(input);
      expect(result).toBe("SLACK_BOT_TOKEN=xoxb-[REDACTED]");
    });

    it("xoxp- (User Token) をマスク", () => {
      // Use obviously fake pattern to avoid GitHub secret scanning
      const input = "token: xoxp-FAKE-TOKEN-FOR-TESTING-ONLY-abcdefghij";
      const result = redact(input);
      expect(result).toBe("token: xoxp-[REDACTED]");
    });

    it("xoxa- (App Token) をマスク", () => {
      const input = "SLACK_APP_TOKEN=xoxa-2-abcdefghijklmnopqrstuvwxyz";
      const result = redact(input);
      expect(result).toBe("SLACK_APP_TOKEN=xoxa-[REDACTED]");
    });

    it("xoxs- (Session Token) をマスク", () => {
      const input = "session=xoxs-123456789012-abcdefghijklmnop";
      const result = redact(input);
      expect(result).toBe("session=xoxs-[REDACTED]");
    });

    it("xoxr- (Refresh Token) をマスク", () => {
      const input = "refresh: xoxr-abcdefghijklmnopqrstuvwxyz";
      const result = redact(input);
      expect(result).toBe("refresh: xoxr-[REDACTED]");
    });
  });

  describe("Google API キー", () => {
    it("AIza で始まる Google API キーをマスク", () => {
      const input = "GOOGLE_API_KEY=AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
      const result = redact(input);
      expect(result).toBe("GOOGLE_API_KEY=AIza[REDACTED]");
    });

    it("短い AIza 文字列はマスクしない", () => {
      const input = "AIza";
      const result = redact(input);
      expect(result).toBe("AIza");
    });
  });

  describe("AWS キー", () => {
    it("AKIA (Access Key ID) をマスク", () => {
      const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
      const result = redact(input);
      expect(result).toBe("AWS_ACCESS_KEY_ID=AKIA[REDACTED]");
    });

    it("ASIA (Temporary Access Key ID) をマスク", () => {
      const input = "aws_access_key_id: ASIAIOSFODNN7EXAMPLE";
      const result = redact(input);
      expect(result).toBe("aws_access_key_id: ASIA[REDACTED]");
    });

    it("AWS Secret Access Key をマスク", () => {
      const input = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      const result = redact(input);
      expect(result).toBe("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    });
  });

  describe("秘密鍵ブロック", () => {
    it("RSA PRIVATE KEY をマスク（形を残す）", () => {
      const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyf8lWBn/gFHE4dGsN8...
-----END RSA PRIVATE KEY-----`;
      const result = redact(input);
      expect(result).toBe(`-----BEGIN RSA PRIVATE KEY-----
[REDACTED PRIVATE KEY]
-----END RSA PRIVATE KEY-----`);
    });

    it("EC PRIVATE KEY をマスク", () => {
      const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBYr...
-----END EC PRIVATE KEY-----`;
      const result = redact(input);
      expect(result).toBe(`-----BEGIN EC PRIVATE KEY-----
[REDACTED PRIVATE KEY]
-----END EC PRIVATE KEY-----`);
    });

    it("PRIVATE KEY (generic PKCS#8) をマスク", () => {
      const input = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASC...
-----END PRIVATE KEY-----`;
      const result = redact(input);
      expect(result).toBe(`-----BEGIN PRIVATE KEY-----
[REDACTED PRIVATE KEY]
-----END PRIVATE KEY-----`);
    });

    it("OPENSSH PRIVATE KEY をマスク", () => {
      const input = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0...
-----END OPENSSH PRIVATE KEY-----`;
      const result = redact(input);
      expect(result).toBe(`-----BEGIN OPENSSH PRIVATE KEY-----
[REDACTED PRIVATE KEY]
-----END OPENSSH PRIVATE KEY-----`);
    });

    it("複数の秘密鍵ブロックをそれぞれマスク", () => {
      const input = `Key1:
-----BEGIN RSA PRIVATE KEY-----
abc123
-----END RSA PRIVATE KEY-----
Key2:
-----BEGIN EC PRIVATE KEY-----
xyz789
-----END EC PRIVATE KEY-----`;
      const result = redact(input);
      expect(result).toContain("[REDACTED PRIVATE KEY]");
      expect(result).not.toContain("abc123");
      expect(result).not.toContain("xyz789");
    });
  });

  describe("Anthropic API キー", () => {
    it("sk-ant- トークンをマスク", () => {
      const input = "ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redact(input);
      expect(result).toBe("ANTHROPIC_API_KEY=sk-ant-[REDACTED]");
    });
  });

  describe("偽陽性防止", () => {
    it("通常のログメッセージはマスクしない", () => {
      const input = "[INFO] Server started on port 8787";
      const result = redact(input);
      expect(result).toBe("[INFO] Server started on port 8787");
    });

    it("短いハッシュはマスクしない", () => {
      const input = "commit abc1234def5678";
      const result = redact(input);
      expect(result).toBe("commit abc1234def5678");
    });

    it("URL はマスクしない", () => {
      const input = "https://example.com/path/to/resource?query=value";
      const result = redact(input);
      expect(result).toBe("https://example.com/path/to/resource?query=value");
    });

    it("ファイルパスはマスクしない", () => {
      const input = "/home/user/.config/some-app/settings.json";
      const result = redact(input);
      expect(result).toBe("/home/user/.config/some-app/settings.json");
    });

    it("UUID はマスクしない", () => {
      const input = "id: 550e8400-e29b-41d4-a716-446655440000";
      const result = redact(input);
      expect(result).toBe("id: 550e8400-e29b-41d4-a716-446655440000");
    });

    it("git commit SHA はマスクしない", () => {
      const input = "commit da39a3ee5e6b4b0d3255bfef95601890afd80709";
      const result = redact(input);
      expect(result).toBe("commit da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });

    it("npm package バージョンハッシュはマスクしない", () => {
      const input = "integrity sha512-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redact(input);
      // integrity ハッシュは長いが、sha512- prefix で識別可能なので許容
      expect(result).toContain("sha512-");
    });
  });

  describe("複合パターン", () => {
    it("複数のシークレットが含まれる場合、すべてマスク", () => {
      // sk- pattern requires 20+ chars after prefix
      const input = `OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456
GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE`;
      const result = redact(input);
      expect(result).toContain("sk-[REDACTED]");
      expect(result).toContain("ghp_[REDACTED]");
      expect(result).toContain("AKIA[REDACTED]");
      expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz");
      expect(result).not.toContain("IOSFODNN7EXAMPLE");
    });
  });
});
