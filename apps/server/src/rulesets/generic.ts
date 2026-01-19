import type { RuleSet } from "./types.js";

export const genericRuleset: RuleSet = {
  id: "generic",
  label: "Generic",
  rules: [
    // --- Search (highest priority for information gathering) ---
    {
      id: "generic.search",
      priority: 60,
      re: /\b(rg|grep|find|fd|ag|ack)\b/i,
      type: "search",
      summary: "該当箇所を検索している",
    },

    // --- Build (compilation, bundling) ---
    {
      id: "generic.build",
      priority: 55,
      re: /\b(vite\s+build|webpack|esbuild|rollup|parcel|tsc\s+--build|cargo\s+build|go\s+build|make\s+\w+|gradle\s+build|mvn\s+(compile|package|install)|dotnet\s+build)\b/i,
      type: "build",
      summary: "ビルドを実行している",
    },
    {
      id: "generic.build.output",
      priority: 55,
      re: /\b(built in|bundled?|compiled?|compiling|building|transpil)/i,
      type: "build",
      summary: "ビルド処理中",
    },

    // --- Test (test runners, type checking) ---
    {
      id: "generic.test",
      priority: 50,
      re: /\b(playwright|vitest|jest|mocha|ava|tap|pytest|cargo\s+test|go\s+test|dotnet\s+test|phpunit|rspec|minitest)\b/i,
      type: "test",
      summary: "テストを実行している",
    },
    {
      id: "generic.test.typecheck",
      priority: 50,
      re: /\b(typecheck|tsc|mypy|pyright|type-check)\b/i,
      type: "test",
      summary: "型チェックを実行している",
    },
    {
      id: "generic.test.output",
      priority: 50,
      re: /\b(PASS|FAIL|✓|✗|passed|failed)\s+\d+\s*(tests?|specs?|suites?)/i,
      type: "test",
      summary: "テスト結果が出ている",
    },

    // --- Lint/Format (code quality tools) ---
    {
      id: "generic.lint",
      priority: 45,
      re: /\b(eslint|prettier|biome|stylelint|tslint|standardjs)\b/i,
      type: "lint",
      summary: "Lint/Formatを実行している",
    },
    {
      id: "generic.lint.python",
      priority: 45,
      re: /\b(ruff|flake8|pylint|black|isort|autopep8|yapf)\b/i,
      type: "lint",
      summary: "Python Lint/Formatを実行している",
    },
    {
      id: "generic.lint.other",
      priority: 45,
      re: /\b(cargo\s+(fmt|clippy)|go\s+fmt|gofmt|golint|rubocop|rustfmt)\b/i,
      type: "lint",
      summary: "Lint/Formatを実行している",
    },
    {
      id: "generic.lint.output",
      priority: 45,
      re: /\b(\d+\s+(warning|error)s?\s+(found|fixed)|no\s+issues\s+found|all\s+files\s+pass)/i,
      type: "lint",
      summary: "Lint結果が出ている",
    },

    // --- GitHub (GitHub CLI operations) ---
    {
      id: "generic.github",
      priority: 40,
      re: /\bgh\s+(issue|pr|repo|release|workflow|run|gist|codespace)\b/i,
      type: "github",
      summary: "GitHub操作をしている",
    },

    // --- Dev Server (local development servers) ---
    {
      id: "generic.server",
      priority: 35,
      re: /\b(vite|next\s+dev|nuxt\s+dev|webpack\s+serve|webpack-dev-server|parcel\s+serve|serve|live-server|http-server)\b/i,
      type: "server",
      summary: "開発サーバーを起動している",
    },
    {
      id: "generic.server.listen",
      priority: 35,
      re: /\b(listening\s+on|server\s+(started|running)\s+(on|at)|ready\s+in|local:\s*http)/i,
      type: "server",
      summary: "サーバーが起動した",
    },

    // --- Git (version control) ---
    {
      id: "generic.git",
      priority: 30,
      re: /\bgit\s+(status|add|commit|push|pull|checkout|switch|merge|rebase|stash|reset|diff|log|branch|tag|fetch|clone)\b/i,
      type: "git",
      summary: "Git操作をしている",
    },
    {
      id: "generic.git.output",
      priority: 30,
      re: /\b(On branch|Your branch is|nothing to commit|Changes (not staged|to be committed)|Untracked files)/i,
      type: "git",
      summary: "Git状態を確認している",
    },

    // --- Package Management (dependency installation) ---
    {
      id: "generic.install.node",
      priority: 20,
      re: /\b(pnpm|npm|yarn|bun)\s+(add|install|i|remove|uninstall|update|upgrade|run|exec|dlx|create)\b/i,
      type: "install",
      summary: "パッケージ/スクリプトを処理している",
    },
    {
      id: "generic.install.python",
      priority: 20,
      re: /\b(pip|pip3|pipx|uv|poetry|pdm)\s+(install|uninstall|add|remove|sync|update)\b/i,
      type: "install",
      summary: "Pythonパッケージを処理している",
    },
    {
      id: "generic.install.other",
      priority: 20,
      re: /\b(cargo\s+(add|install|remove)|gem\s+(install|uninstall)|go\s+(get|install|mod)|composer\s+(install|require|update)|brew\s+(install|uninstall|upgrade))\b/i,
      type: "install",
      summary: "パッケージを処理している",
    },
    {
      id: "generic.install.output",
      priority: 20,
      re: /\b(packages?\s+(added|removed|updated|installed)|dependencies?\s+(installed|resolved)|Lockfile\s+is\s+up\s+to\s+date)/i,
      type: "install",
      summary: "パッケージ処理結果",
    },

    // --- Error (lowest priority - catch-all for errors) ---
    {
      id: "generic.error",
      priority: 10,
      re: /\b(execution\s+error|error:|Error:|ERROR|failed|Failed|FAILED|exception|Exception|EXCEPTION|panic|Panic|PANIC)\b/i,
      type: "error",
      summary: "エラーが出ている",
    },
    {
      id: "generic.error.typescript",
      priority: 10,
      re: /TS\d{4,5}:/,
      type: "error",
      summary: "TypeScriptエラーが出ている",
    },
    {
      id: "generic.error.stack",
      priority: 10,
      re: /^\s*at\s+[\w.]+\s+\(/,
      type: "error",
      summary: "スタックトレースが出ている",
    },
  ],
};
