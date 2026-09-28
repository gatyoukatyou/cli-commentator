const nodes = Object.fromEntries([
  'phase', 'current-work', 'changed', 'decision', 'announcement', 'transcript', 'detail',
  'page-title', 'mode-banner', 'codex-state-panel', 'turn-status', 'child-status', 'stop-requested', 'model', 'final-report',
  'approval-panel', 'approval-heading', 'approval-title', 'approval-details', 'approval-state',
  'approval-preview-block', 'approval-preview', 'approval-blocked-reason',
  'session-id', 'generation', 'operation-id', 'evidence',
  'start', 'advance', 'read-again', 'more-detail', 'speech-stop', 'approve', 'reject', 'hold', 'stop-work',
].map((id) => [id, document.getElementById(id)]));

let snapshot = null;
let csrfToken = '';
let lastGeneration = -1;
let speechSequence = 0;
let detailVisible = false;
let connectionUnknown = false;
let stateFetch = null;
let csrfFetch = null;

async function bootstrap() {
  schedulePolling();
  try {
    await refreshCsrf();
    await refreshState();
  } catch (error) {
    markConnectionUnknown(error);
  }
}

function schedulePolling() {
  window.setTimeout(async () => {
    try {
      await refreshState();
    } catch (error) {
      markConnectionUnknown(error);
    } finally {
      schedulePolling();
    }
  }, 1000);
}

async function refreshCsrf() {
  if (csrfToken) return csrfToken;
  if (!csrfFetch) {
    csrfFetch = (async () => {
      const response = await fetch('/api/csrf', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('操作用の準備を読み込めませんでした。');
      csrfToken = (await response.json()).csrfToken;
      return csrfToken;
    })().finally(() => { csrfFetch = null; });
  }
  return csrfFetch;
}

function refreshState() {
  if (!stateFetch) {
    stateFetch = (async () => {
      await refreshCsrf();
      const generationAtRequest = lastGeneration;
      const response = await fetch('/api/state', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('画面の状態を読み込めませんでした。');
      render(await response.json(), 'poll', generationAtRequest);
    })().finally(() => { stateFetch = null; });
  }
  return stateFetch;
}

async function post(path, body) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (result.snapshot) render(result.snapshot, 'operation');
    if (!response.ok) announce(result.message || '操作を受け付けられませんでした。最新の状態を確認してください。');
    else if (result.message) announce(result.message);
    return result;
  } catch (error) {
    markConnectionUnknown(error);
    return null;
  }
}

function render(next, source = 'state', generationAtRequest = lastGeneration) {
  const previousGeneration = lastGeneration;
  if (previousGeneration >= 0 && next.generation < previousGeneration) {
    if (source === 'poll' && previousGeneration <= generationAtRequest) {
      markConnectionUnknown('デモの状態記録が切り替わりました。前の状態を終了扱いせず、操作を止めています。新しい状態を表示するにはページを再読み込みしてください。');
    }
    return;
  }
  const generationChanged = previousGeneration !== next.generation;
  const recovering = connectionUnknown;
  const previousSnapshot = snapshot;
  const codexRefresh = next.source === 'codex';
  if (!generationChanged && !recovering && !codexRefresh) return;
  connectionUnknown = false;
  snapshot = next;
  lastGeneration = snapshot.generation;
  if (previousGeneration >= 0 && generationChanged) {
    stopSpeech();
    detailVisible = false;
    nodes.detail.textContent = '';
    nodes.detail.hidden = true;
  }

  const isCodex = snapshot.source === 'codex';
  nodes['page-title'].textContent = isCodex ? 'Codexとの実接続' : '架空の作業体験デモ';
  nodes['mode-banner'].textContent = isCodex
    ? 'Codexとの実接続・練習用ファイルの読み取りを行います。Codexの既存の認証・利用枠を使います（ChatGPTログインの場合はサブスク枠）。固定のsample.txtを読み取り、自由な依頼や作業場所は指定できません。'
    : 'これは架空の作業を使う体験デモです。実際のCLI実行・ファイル変更・共有は行いません。';
  document.title = isCodex ? 'Codexとの実接続 | CLI Commentator' : 'CLI Commentator 体験デモ';
  nodes['codex-state-panel'].hidden = !isCodex;
  if (isCodex) {
    const codex = snapshot.codex;
    nodes['turn-status'].textContent = turnStatusText(codex?.turnStatus);
    nodes['child-status'].textContent = childStatusText(codex?.childStatus);
    nodes['stop-requested'].textContent = codex?.childStatus === 'closed'
      ? '停止操作済み。接続の終了を確認しました。'
      : codex?.stopRequested ? '要求済み。終了はまだ確認中の場合があります。' : 'なし';
    nodes.model.textContent = codex?.model || '未指定';
    nodes['final-report'].textContent = codex?.finalReport || 'まだCodexからの最終報告はありません。';
  }

  nodes.phase.textContent = snapshot.phaseLabel;
  nodes['current-work'].textContent = snapshot.currentWork;
  nodes.changed.textContent = snapshot.changed;
  nodes.decision.textContent = snapshot.decision;
  nodes['session-id'].textContent = snapshot.sessionId || 'まだありません';
  nodes.generation.textContent = String(snapshot.generation);
  nodes['operation-id'].textContent = snapshot.currentOperationId || 'まだありません';

  const latest = snapshot.events.at(-1);
  if (generationChanged) {
    nodes.transcript.replaceChildren();
    if (latest) {
      for (const line of latest.dialogue) {
        const item = document.createElement('li');
        const role = document.createElement('strong');
        role.textContent = `${line.role}役`;
        const text = document.createElement('p');
        text.textContent = line.text;
        item.append(role, text);
        nodes.transcript.append(item);
      }
      nodes.evidence.textContent = latest.evidence.map((entry) => `${entry.id}: ${entry.statement}`).join(' ');
    } else {
      nodes.evidence.textContent = 'まだイベントはありません。';
    }
  }

  const active = snapshot.status === 'starting' || snapshot.status === 'running' || snapshot.status === 'awaiting-human' || snapshot.status === 'stopping';
  setAriaDisabled(nodes.start, connectionUnknown || !snapshot.capabilities.start || active);
  setAriaDisabled(nodes.advance, connectionUnknown || !snapshot.capabilities.advance || snapshot.status !== 'running');
  nodes.advance.textContent = isCodex ? '次へ進む（実接続では未対応）' : '次へ進む';
  setAriaDisabled(nodes['read-again'], connectionUnknown || !latest);
  setAriaDisabled(nodes['more-detail'], connectionUnknown);
  const codexCanStop = isCodex && snapshot.codex && snapshot.codex.childStatus !== 'closed' && !snapshot.codex.stopRequested;
  const canStop = snapshot.capabilities.stop && (isCodex ? codexCanStop : snapshot.status !== 'finished' && snapshot.status !== 'stopped');
  setAriaDisabled(nodes['stop-work'], connectionUnknown || !canStop);
  nodes['stop-work'].textContent = isCodex
    ? (snapshot.codex?.childStatus === 'closed'
      ? 'Codex接続は終了済み'
      : snapshot.codex?.stopRequested ? 'Codexの終了を確認中' : 'Codex接続を停止')
    : 'デモを停止';

  const approval = snapshot.approval;
  nodes['approval-panel'].hidden = approval === null;
  if (approval) {
    const canAccept = isCodex
      ? approval.canAccept === true && typeof approval.preview === 'string' && approval.preview.trim().length > 0
      : true;
    nodes['approval-heading'].textContent = approval.status === 'pending' ? 'あなたの判断が必要です' : '判断の結果';
    nodes['approval-title'].textContent = approval.title;
    nodes['approval-details'].textContent = approval.details;
    nodes['approval-preview-block'].hidden = !isCodex;
    nodes['approval-preview'].textContent = approval.preview || '対象のコマンドと作業場所を確認できません。';
    nodes['approval-blocked-reason'].textContent = canAccept
      ? '表示した対象を確認し、承認する場合は「Codexの要求を承認」を選んでください。'
      : approval.blockedReason || '対象のコマンドと作業場所を確認できないため、承認できません。拒否は選べます。';
    const pending = approval.status === 'pending';
    setAriaDisabled(nodes.approve, connectionUnknown || !snapshot.capabilities.humanDecision || !pending || !canAccept);
    setAriaDisabled(nodes.reject, connectionUnknown || !snapshot.capabilities.humanDecision || !pending);
    setAriaDisabled(nodes.hold, connectionUnknown || !snapshot.capabilities.hold || !pending);
    nodes.approve.textContent = isCodex ? 'Codexの要求を承認' : 'デモ内で承認';
    nodes.reject.textContent = isCodex ? 'Codexの要求を拒否' : 'デモ内で拒否';
    nodes.hold.textContent = isCodex ? '保留する（実接続では未対応）' : '保留する';
    nodes['approval-state'].textContent = pending
      ? isCodex
        ? (canAccept ? 'Codexからの確認待ちです。対象と理由を確認して返答してください。' : 'この要求は承認できません。確認できない点があるため、拒否できます。')
        : '返答待ちです。保留して、あとで判断することもできます。'
      : approval.status === 'cancelled'
        ? (isCodex ? '停止処理により、この要求は取り消されました。' : 'デモが停止したため、この判断は取り消されました。')
        : isCodex && approval.status === 'sent'
          ? '承認の返答をCodexへ送りました。コマンドが実行されたかはまだ未確認です。'
          : isCodex && approval.status === 'decline'
            ? '拒否の返答をCodexへ送りました。ターンの結果はまだ未確認です。'
            : isCodex && (approval.status === 'unknown' || approval.status === 'failed')
              ? '返答をCodexへ送れたか確認できません。状態不明として扱っています。'
              : approval.status === 'approve' || (isCodex && approval.status === 'accept') || (isCodex && approval.status === 'executed')
                ? (isCodex ? 'Codexの確認要求に承認を返しました。実作業の結果は別に確認してください。' : '承認を記録しました。実際の共有は行っていません。')
                : (isCodex ? 'Codexの確認要求を拒否しました。' : '拒否を記録しました。実際の共有は行っていません。');
  } else {
    nodes.approve.textContent = isCodex ? 'Codexの要求を承認' : 'デモ内で承認';
    nodes.reject.textContent = isCodex ? 'Codexの要求を拒否' : 'デモ内で拒否';
    nodes.hold.textContent = isCodex ? '保留する（実接続では未対応）' : '保留する';
    setAriaDisabled(nodes.approve, true);
    setAriaDisabled(nodes.reject, true);
    setAriaDisabled(nodes.hold, connectionUnknown || !snapshot.capabilities.hold);
  }

  if (generationChanged) {
    announce(isCodex
      ? 'Codexとの接続状況を更新しました。AIの作業とCodexとの接続を確認してください。'
      : `${snapshot.phaseLabel}。いまの作業、変わったこと、あなたの判断を更新しました。`);
  } else if (isCodex && previousSnapshot?.codex && snapshot.codex && (
    previousSnapshot.codex.turnStatus !== snapshot.codex.turnStatus
    || previousSnapshot.codex.childStatus !== snapshot.codex.childStatus
  )) {
    announce(`AIの作業は${turnStatusText(snapshot.codex.turnStatus)}、Codexとの接続は${childStatusText(snapshot.codex.childStatus)}です。`);
  }
  if (recovering && !generationChanged) announce(isCodex
    ? '接続が戻りました。Codexとの接続状況を確認しました。'
    : `接続が戻りました。${snapshot.phaseLabel}の状態を確認しました。`);
}

function turnStatusText(status) {
  return ({
    'not-started': '未開始',
    inProgress: '進行中',
    completed: '完了',
    failed: '失敗',
    interrupted: '中断',
    unknown: '不明',
  })[status] || '不明';
}

function childStatusText(status) {
  const text = ({
    'not-started': '未開始',
    starting: '準備中',
    running: '接続中',
    closing: '終了処理中',
    closed: '終了を確認',
    unknown: '不明',
  })[status] || '不明';
  return text;
}

function setAriaDisabled(button, disabled) {
  button.setAttribute('aria-disabled', String(disabled));
}

function announce(message) {
  nodes.announcement.textContent = message;
}

function markConnectionUnknown(error) {
  if (connectionUnknown) return;
  connectionUnknown = true;
  stopSpeech();
  nodes.phase.textContent = '状態不明（接続できません）';
  announce(typeof error === 'string'
    ? error
    : 'デモ画面との接続が切れました。終了したとは判断できません。状態を再取得しています。接続が戻らない場合はページを再読み込みしてください。');
  for (const button of [nodes.start, nodes.advance, nodes['read-again'], nodes['more-detail'], nodes.approve, nodes.reject, nodes.hold, nodes['stop-work']]) {
    setAriaDisabled(button, true);
  }
}

function stopSpeech() {
  speechSequence += 1;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function speakLatest() {
  if (connectionUnknown || nodes['read-again'].getAttribute('aria-disabled') === 'true') return;
  const latest = snapshot?.events.at(-1);
  if (!latest) return;
  if (!(('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window))) {
    announce('このブラウザーは音声合成に対応していません。画面の字幕をご利用ください。');
    return;
  }
  stopSpeech();
  const sequence = speechSequence;
  const utterances = latest.dialogue.map((line) => {
    const utterance = new SpeechSynthesisUtterance(`${line.role}役。${line.text}`);
    utterance.lang = 'ja-JP';
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ja')) || null;
    return utterance;
  });
  utterances.forEach((utterance, index) => {
    utterance.onend = () => {
      if (sequence !== speechSequence || index !== utterances.length - 1) return;
      announce('読み上げが終わりました。');
    };
    utterance.onerror = () => {
      if (sequence === speechSequence) announce('音声を再生できませんでした。字幕をご利用ください。');
    };
  });
  for (const utterance of utterances) window.speechSynthesis.speak(utterance);
  announce('実況と解説を読み上げています。');
}

nodes.start.addEventListener('click', () => {
  if (connectionUnknown || nodes.start.getAttribute('aria-disabled') === 'true') return;
  void post('/api/start', { expectedGeneration: snapshot?.generation ?? 0 });
});
nodes.advance.addEventListener('click', () => {
  if (connectionUnknown || nodes.advance.getAttribute('aria-disabled') === 'true') return;
  void post('/api/advance', { expectedGeneration: snapshot?.generation ?? -1 });
});
nodes['stop-work'].addEventListener('click', () => {
  if (connectionUnknown || nodes['stop-work'].getAttribute('aria-disabled') === 'true') return;
  void post('/api/stop', {});
});
nodes.hold.addEventListener('click', () => {
  if (connectionUnknown || nodes.hold.getAttribute('aria-disabled') === 'true') return;
  void post('/api/hold', {});
});
nodes.approve.addEventListener('click', () => decide('approve'));
nodes.reject.addEventListener('click', () => decide('reject'));
nodes['read-again'].addEventListener('click', speakLatest);
nodes['speech-stop'].addEventListener('click', () => {
  stopSpeech();
  announce(snapshot?.source === 'codex'
    ? '音声を止めました。作業の進行状態は変わっていません。'
    : '音声を止めました。デモの進行状態は変わっていません。');
});
nodes['more-detail'].addEventListener('click', async () => {
  if (connectionUnknown || nodes['more-detail'].getAttribute('aria-disabled') === 'true') return;
  const requestedGeneration = snapshot?.generation;
  const result = await post('/api/explain', { detail: true });
  if (
    result?.detail
    && !connectionUnknown
    && result.generation === requestedGeneration
    && snapshot?.generation === requestedGeneration
  ) {
    detailVisible = true;
    nodes.detail.textContent = `${result.detail} 根拠: ${result.evidence.map((entry) => entry.statement).join(' ') || 'まだ根拠はありません。'}`;
    nodes.detail.hidden = false;
  }
});

async function decide(decision) {
  if (connectionUnknown || nodes[decision].getAttribute('aria-disabled') === 'true' || !snapshot?.approval) return;
  await post('/api/decision', {
    sessionId: snapshot.sessionId,
    approvalId: snapshot.approval.approvalId,
    expectedGeneration: snapshot.approval.expectedGeneration,
    decision,
  });
}

for (const button of [nodes.start, nodes.advance, nodes['read-again'], nodes['more-detail'], nodes.approve, nodes.reject, nodes.hold, nodes['stop-work']]) {
  setAriaDisabled(button, true);
}

void bootstrap();
