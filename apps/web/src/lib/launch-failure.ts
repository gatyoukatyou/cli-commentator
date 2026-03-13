export type LaunchAttemptContext = {
  cmd: string;
  args: string[];
  cwd?: string;
};

export type LaunchFailureGuidance = {
  summary: string;
  hints: string[];
  diagnostics: string[];
};

function normalize(value: string): string {
  return value.toLowerCase();
}

export function getLaunchFailureGuidance(
  error: string,
  attempt?: LaunchAttemptContext | null
): LaunchFailureGuidance {
  const normalized = normalize(error);
  const diagnostics = [
    `cmd=${attempt?.cmd || "-"}`,
    `args=${attempt?.args?.join(" ") || "-"}`,
    `cwd=${attempt?.cwd || "-"}`,
    `error=${error}`,
  ];

  if (normalized.includes("working directory not found") || (normalized.includes("enoent") && normalized.includes("cwd"))) {
    return {
      summary: "作業ディレクトリが見つかりません。",
      hints: [
        "パスの大文字小文字が実際のディレクトリ名と一致しているか確認してください。",
        "そのディレクトリが本当に存在するか、対象ターミナルで `pwd` や `ls` で確認してください。",
      ],
      diagnostics,
    };
  }

  if (normalized.includes("working directory is not a directory")) {
    return {
      summary: "指定した作業ディレクトリは存在しますが、ディレクトリではありません。",
      hints: [
        "ファイルのパスではなく、リポジトリのディレクトリ自体を指定してください。",
      ],
      diagnostics,
    };
  }

  if (normalized.includes("eacces") || normalized.includes("eperm") || normalized.includes("permission denied")) {
    return {
      summary: "起動対象または作業ディレクトリの権限不足で失敗しています。",
      hints: [
        "対象ディレクトリやコマンドの読み取り・実行権限を確認してください。",
      ],
      diagnostics,
    };
  }

  if (normalized.includes("enoent")) {
    return {
      summary: "起動コマンドが見つかりません。",
      hints: [
        "Quick Launch の `コマンド` が PATH 上にあるか確認してください。",
        "`codex` や `claude` が見つからない場合は `Custom` に切り替えてフルパス指定を試してください。",
      ],
      diagnostics,
    };
  }

  return {
    summary: "CLI の起動時に予期しないエラーが発生しました。",
    hints: [
      "下の診断情報の `cmd` と `cwd` が意図した値か確認してください。",
      "再現する場合はこのエラー本文をそのまま確認材料にしてください。",
    ],
    diagnostics,
  };
}
