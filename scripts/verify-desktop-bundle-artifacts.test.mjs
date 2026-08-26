import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_GITHUB_REPOSITORY,
  resolveAssetReference,
  resolveGithubToken,
  validateLatestJson,
} from "./verify-desktop-bundle-artifacts.mjs";

const [owner, repository] = EXPECTED_GITHUB_REPOSITORY.split("/");
const assetNames = {
  aarch64: "CLI.Commentator_0.2.2_aarch64.app.tar.gz",
  x64: "CLI.Commentator_0.2.2_x64.app.tar.gz",
};

function downloadUrl(assetName, tag = "untagged-test") {
  return `https://github.com/${owner}/${repository}/releases/download/${tag}/${assetName}`;
}

function apiUrl(assetId, apiOwner = owner, apiRepository = repository) {
  return `https://api.github.com/repos/${apiOwner}/${apiRepository}/releases/assets/${assetId}`;
}

function platformEntry(url, signature = "test-signature") {
  return { url, signature };
}

function createLatest({ urls = {}, signatures = {} } = {}) {
  const defaultUrls = {
    "darwin-aarch64": downloadUrl(assetNames.aarch64),
    "darwin-aarch64-app": downloadUrl(assetNames.aarch64),
    "darwin-x86_64": downloadUrl(assetNames.x64),
    "darwin-x86_64-app": downloadUrl(assetNames.x64),
  };

  return {
    path: "latest.json",
    data: {
      version: "0.2.2",
      notes: "test",
      pub_date: "2026-08-27T00:00:00.000Z",
      platforms: Object.fromEntries(
        Object.keys(defaultUrls).map((platform) => [
          platform,
          platformEntry(urls[platform] ?? defaultUrls[platform], signatures[platform] ?? "test-signature"),
        ])
      ),
    },
  };
}

function createEntries(names = [assetNames.aarch64, assetNames.x64]) {
  return [...names, "latest.json"].map((name) => ({
    path: name,
    stats: { isFile: () => true },
  }));
}

function metadataResponse(metadata) {
  return {
    ok: true,
    status: 200,
    json: async () => metadata,
  };
}

function metadataFor(assetId, assetName) {
  return {
    id: assetId,
    name: assetName,
    size: 123,
    state: "uploaded",
    browser_download_url: downloadUrl(assetName),
  };
}

test("accepts normal GitHub release download URLs", async () => {
  await assert.doesNotReject(() => validateLatestJson(createLatest(), createEntries()));
});

test("resolves a GitHub asset API URL through authenticated metadata", async () => {
  const url = apiUrl(12345);
  const requests = [];
  const result = await resolveAssetReference(url, {
    getToken: () => "unit-test-token",
    fetchImpl: async (requestUrl, options) => {
      requests.push({ requestUrl, options });
      return metadataResponse(metadataFor(12345, assetNames.aarch64));
    },
  });

  assert.equal(result.assetName, assetNames.aarch64);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestUrl, url);
  assert.equal(requests[0].options.headers.Authorization, "Bearer unit-test-token");
});

test("validates API-resolved names against local assets", async () => {
  const metadata = new Map([
    [apiUrl(12345), metadataFor(12345, assetNames.aarch64)],
    [apiUrl(67890), metadataFor(67890, assetNames.x64)],
  ]);
  const latest = createLatest({
    urls: {
      "darwin-aarch64": apiUrl(12345),
      "darwin-aarch64-app": apiUrl(12345),
      "darwin-x86_64": apiUrl(67890),
      "darwin-x86_64-app": apiUrl(67890),
    },
  });

  await assert.doesNotReject(() =>
    validateLatestJson(latest, createEntries(), {
      getToken: () => "unit-test-token",
      fetchImpl: async (url) => metadataResponse(metadata.get(url)),
    })
  );
});

test("rejects a non-numeric API asset ID", async () => {
  await assert.rejects(
    () =>
      validateLatestJson(
        createLatest({ urls: { "darwin-aarch64": apiUrl("not-a-number") } }),
        createEntries()
      ),
    /numeric asset ID/
  );
});

test("rejects an API URL for a different owner or repository", async () => {
  await assert.rejects(
    () =>
      validateLatestJson(
        createLatest({ urls: { "darwin-aarch64": apiUrl(12345, "other-owner", repository) } }),
        createEntries()
      ),
    /repository/
  );
});

test("rejects when API metadata names an asset absent locally", async () => {
  const aarch64Url = apiUrl(12345);
  await assert.rejects(
    () =>
      validateLatestJson(
        createLatest({
          urls: {
            "darwin-aarch64": aarch64Url,
            "darwin-aarch64-app": aarch64Url,
          },
        }),
        createEntries([assetNames.x64]),
        {
          getToken: () => "unit-test-token",
          fetchImpl: async () => metadataResponse(metadataFor(12345, assetNames.aarch64)),
        }
      ),
    /missing asset/
  );
});

test("rejects an unexpected URL host", async () => {
  await assert.rejects(
    () =>
      validateLatestJson(
        createLatest({ urls: { "darwin-aarch64": "https://example.invalid/releases/download/test/asset.tar.gz" } }),
        createEntries()
      ),
    /Unsupported GitHub asset URL host/
  );
});

test("rejects an empty updater signature", async () => {
  await assert.rejects(
    () => validateLatestJson(createLatest({ signatures: { "darwin-aarch64": "" } }), createEntries()),
    /signature must be a non-empty string/
  );
});

test("does not include an authentication token in API errors", async () => {
  const secret = "unit-test-secret-token";
  await assert.rejects(
    () =>
      resolveAssetReference(apiUrl(12345), {
        getToken: () => secret,
        fetchImpl: async () => {
          throw new Error(`network failure: ${secret}`);
        },
      }),
    (error) => {
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /metadata request failed/);
      return true;
    }
  );
});

test("uses release token, then GitHub token, then gh auth token", () => {
  let ghAuthCalls = 0;
  const execFileSyncImpl = () => {
    ghAuthCalls += 1;
    return "gh-auth-token";
  };

  assert.equal(
    resolveGithubToken({
      env: { GH_RELEASE_TOKEN: "release-token", GITHUB_TOKEN: "github-token" },
      execFileSyncImpl,
    }),
    "release-token"
  );
  assert.equal(
    resolveGithubToken({
      env: { GITHUB_TOKEN: "github-token" },
      execFileSyncImpl,
    }),
    "github-token"
  );
  assert.equal(resolveGithubToken({ env: {}, execFileSyncImpl }), "gh-auth-token");
  assert.equal(ghAuthCalls, 1);
});
