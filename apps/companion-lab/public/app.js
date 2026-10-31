const nodes = Object.fromEntries([
  'phase', 'current-work', 'changed', 'decision', 'announcement', 'transcript', 'detail',
  'page-title', 'mode-banner', 'codex-state-panel', 'turn-status', 'child-status', 'stop-requested', 'model', 'final-report',
  'approval-panel', 'approval-heading', 'approval-title', 'approval-details', 'approval-state',
  'approval-preview-block', 'approval-preview', 'approval-blocked-reason',
  'controls-heading',
  'session-id', 'generation', 'operation-id', 'evidence',
  'start', 'advance', 'read-again', 'more-detail', 'speech-stop', 'approve', 'reject', 'hold', 'stop-work',
  'single-key-toggle', 'auto-voice-toggle', 'speak-detail-toggle',
].map((id) => [id, document.getElementById(id)]));

let snapshot = null;
let csrfToken = '';
let lastGeneration = -1;
let lastStateAnnouncement = '';
let speechSequence = 0;
let speechStopCount = 0;
let speakDetailEpoch = 0;
let lastAutoVoiceKey = null;
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
    if (!response.ok) {
      announce(result.message || '操作を受け付けられませんでした。最新の状態を確認してください。');
    } else if (result.message) {
      lastStateAnnouncement = result.message;
      announce(result.message);
    }
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
      const isCodexMode = snapshot?.source === 'codex' || next.source === 'codex';
      markConnectionUnknown(isCodexMode
        ? '状態記録が切り替わりました。前の作業を完了や終了として扱わず、操作を止めています。新しい状態を表示するにはページを再読み込みしてください。'
        : 'デモの状態記録が切り替わりました。前の状態を終了扱いせず、操作を止めています。新しい状態を表示するにはページを再読み込みしてください。');
    }
    return;
  }
  const generationChanged = previousGeneration !== next.generation;
  const recovering = connectionUnknown;
  const previousSnapshot = snapshot;
  const codexStateChanged = next.source === 'codex' && hasCodexStateChanged(previousSnapshot, next);
  if (!generationChanged && !recovering && !codexStateChanged) return;
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
  nodes['controls-heading'].textContent = isCodex ? '作業の操作' : 'デモの操作';
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
  const unrecoverableUnknown = isCodex && snapshot.status === 'unknown' && snapshot.codex?.childStatus !== 'closed';
  nodes.start.textContent = isCodex
    ? (snapshot.status === 'not-started' ? '練習タスクを開始' : active ? '練習タスクを実行中' : 'もう一度実行')
    : '開始 / もう一度体験';
  setAriaDisabled(nodes.start, connectionUnknown || !snapshot.capabilities.start || active || unrecoverableUnknown);
  setControlVisible(nodes.advance, snapshot.capabilities.advance);
  nodes.advance.textContent = '次へ進む';
  setAriaDisabled(nodes.advance, connectionUnknown || !snapshot.capabilities.advance || snapshot.status !== 'running');
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
  setControlVisible(nodes.hold, snapshot.capabilities.hold);
  nodes.hold.textContent = '保留する';
  if (approval) {
    nodes.approve.disabled = false;
    nodes.reject.disabled = false;
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
    nodes.approve.disabled = true;
    nodes.reject.disabled = true;
    setAriaDisabled(nodes.approve, true);
    setAriaDisabled(nodes.reject, true);
    setAriaDisabled(nodes.hold, true);
  }
  releaseHiddenFocus();

  const nextAnnouncement = isCodex
    ? buildCodexAnnouncement(snapshot, recovering && !generationChanged)
    : recovering && !generationChanged
      ? `接続が戻りました。${snapshot.phaseLabel}の状態を確認しました。`
      : `${snapshot.phaseLabel}。いまの作業、変わったこと、あなたの判断を更新しました。`;
  if (recovering || generationChanged || codexStateChanged) {
    if (source !== 'poll' || nextAnnouncement !== lastStateAnnouncement) {
      lastStateAnnouncement = nextAnnouncement;
      announce(nextAnnouncement);
    }
  }
  maybeSpeakAutoVoice(snapshot, false);
}

function hasCodexStateChanged(previous, next) {
  if (!previous || previous.source !== 'codex' || !previous.codex || !next.codex) return true;
  return previous.codex.turnStatus !== next.codex.turnStatus
    || previous.codex.childStatus !== next.codex.childStatus
    || previous.codex.stopRequested !== next.codex.stopRequested
    || previous.codex.model !== next.codex.model
    || previous.codex.finalReport !== next.codex.finalReport;
}

function buildCodexAnnouncement(current, recoveredOnly) {
  const stateMessage = describeCodexStateAnnouncement(current);
  return recoveredOnly ? `接続が戻りました。${stateMessage}` : stateMessage;
}

function describeCodexStateAnnouncement(current) {
  const codex = current.codex;
  const childClosed = codex?.childStatus === 'closed';
  switch (current.status) {
    case 'not-started':
      return '練習タスクは未開始です。「練習タスクを開始」で始められます。';
    case 'starting':
      return codex?.threadId
        ? '安全設定を確認し、練習タスクを開始しました。'
        : '練習タスクの準備を開始しました。安全設定を確認しています。';
    case 'running':
      if (current.approval?.status === 'sent') {
        return '承認の返答を送りました。実行結果を確認しています。';
      }
      if (current.approval?.status === 'decline') {
        return '拒否の返答を送りました。AIの作業結果を確認しています。';
      }
      if (codex?.finalReport) {
        return 'AIから回答を受け取りました。作業完了の通知を待っています。';
      }
      return `${current.phaseLabel}。${current.currentWork}`;
    case 'awaiting-human':
      return current.approval?.canAccept
        ? 'AIから実行確認が届きました。対象を確認して承認または拒否を選んでください。'
        : 'AIから実行確認が届きましたが、承認できない内容です。拒否または停止を選んでください。';
    case 'stopping':
      return '停止を依頼しました。AIの作業停止とCodex接続の終了を確認しています。';
    case 'finished':
      if (childClosed) {
        return 'AIの回答完了とCodex接続の終了を確認しました。内容の正しさは未確認です。';
      }
      if (codex?.stopRequested) {
        return 'AIの回答作業は完了しています。Codexとの接続終了を確認しています。';
      }
      return 'AIから回答を受け取りました。内容の正しさは未確認で、Codexとの接続は続いています。';
    case 'interrupted':
      if (childClosed) {
        return 'AIの作業停止とCodex接続の終了を確認しました。';
      }
      return codex?.stopRequested
        ? 'AIの作業停止を確認しました。Codexとの接続終了を確認しています。'
        : 'AIの作業停止を確認しました。Codexとの接続終了を別に確認しています。';
    case 'failed':
      if (childClosed) {
        return 'AIの作業失敗とCodex接続の終了を確認しました。';
      }
      return codex?.stopRequested
        ? 'AIの作業に失敗しました。Codexとの接続終了を確認しています。'
        : 'AIの作業に失敗しました。Codexとの接続は続いています。';
    case 'stopped':
      return '作業開始前に停止し、Codex接続の終了を確認しました。';
    case 'unknown':
    default:
      return childClosed
        ? 'Codex接続は終了しましたが、AIの作業完了は未確認です。成功とは扱っていません。'
        : 'Codexとの接続状態を確認できません。作業の完了や停止は未確認です。';
  }
}

function autoVoiceKeyFor(current, connectionLost) {
  if (connectionLost) return 'connection-lost';
  if (!current) return 'no-state';
  const codex = current.codex;
  return [
    current.source,
    current.status,
    codex?.turnStatus ?? '',
    codex?.childStatus ?? '',
    current.approval?.status ?? '',
    codex?.stopRequested ? 'stop-requested' : '',
  ].join('|');
}

function buildAutoVoiceMessage(current) {
  if (!current) return null;
  const codex = current.codex;
  const childClosed = codex?.childStatus === 'closed';
  const turnConfirmed = codex?.turnStatus === 'completed'
    || codex?.turnStatus === 'failed'
    || codex?.turnStatus === 'interrupted';
  if (childClosed && !turnConfirmed && current.status !== 'stopped') {
    return 'Codexとの接続終了を確認しました。AIの作業結果は未確認です。';
  }
  switch (current.status) {
    case 'starting':
      return 'AIとの接続準備を開始しました。';
    case 'running':
      if (current.approval?.status === 'sent' || current.approval?.status === 'decline') return null;
      return 'AIの作業を開始しました。';
    case 'awaiting-human':
      return '承認待ちです。AIから実行確認が届いています。';
    case 'stopping':
      return '作業停止を依頼しました。';
    case 'finished':
      if (childClosed) {
        return 'AIの回答完了とCodex接続の終了を確認しました。内容の正しさは未確認です。';
      }
      if (codex?.stopRequested) {
        return 'AIから回答を受け取りました。内容の正しさは未確認で、Codexとの接続終了を確認しています。';
      }
      if (current.source !== 'codex') return 'デモが終了しました。';
      return 'AIから回答を受け取りました。内容の正しさは未確認で、Codex接続は続いています。';
    case 'interrupted':
      return childClosed
        ? 'AIの作業停止とCodex接続の終了を確認しました。'
        : 'AIの作業停止を確認しました。Codex接続は続いています。';
    case 'failed':
      return childClosed
        ? 'AIの作業失敗とCodex接続の終了を確認しました。'
        : 'AIの作業に失敗しました。Codex接続は続いています。';
    case 'stopped':
      return current.source === 'codex'
        ? '作業開始前に停止し、Codex接続の終了を確認しました。'
        : '体験デモを停止しました。';
    case 'unknown':
      return childClosed
        ? 'Codex接続の終了を確認しました。AIの作業結果は未確認です。'
        : '状態を確認できません。AIの作業完了や停止は未確認です。';
    default:
      return null;
  }
}

function maybeSpeakAutoVoice(current, connectionLost) {
  if (!nodes['auto-voice-toggle'] || nodes['auto-voice-toggle'].checked !== true) return;
  const key = autoVoiceKeyFor(current, connectionLost);
  if (key === lastAutoVoiceKey) return;
  lastAutoVoiceKey = key;
  const message = connectionLost
    ? '接続状態を確認できません。AIの作業完了や停止は未確認です。'
    : buildAutoVoiceMessage(current);
  if (message) speakText(message);
}

function isSingleKeyEnabled() {
  return Boolean(nodes['single-key-toggle'] && nodes['single-key-toggle'].checked === true);
}

function isEditableContentAttribute(value) {
  return value !== null && value !== 'false';
}

function isTypingTarget(target) {
  if (!target) return false;
  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'OPTION') return true;
  if (target.isContentEditable === true) return true;
  if (typeof target.getAttribute === 'function' && isEditableContentAttribute(target.getAttribute('contenteditable'))) return true;
  if (typeof target.closest === 'function') {
    const editable = target.closest('[contenteditable]');
    if (editable && typeof editable.getAttribute === 'function' && isEditableContentAttribute(editable.getAttribute('contenteditable'))) {
      return true;
    }
  }
  return false;
}

function announceAvailableControls() {
  const available = (node) => Boolean(node) && !node.hidden && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  const parts = ['「音声を止める」（Escapeキー）'];
  if (available(nodes['read-again'])) parts.push('「もう一度読む」（jキー）');
  if (available(nodes['more-detail'])) parts.push('「詳しく説明」（kキー）');
  if (available(nodes.start)) parts.push(`「${nodes.start.textContent}」`);
  if (available(nodes.advance)) parts.push('「次へ進む」');
  if (available(nodes['stop-work'])) parts.push(`「${nodes['stop-work'].textContent}」`);
  if (available(nodes.approve)) parts.push(`「${nodes.approve.textContent}」`);
  if (available(nodes.reject)) parts.push(`「${nodes.reject.textContent}」`);
  if (available(nodes.hold)) parts.push('「保留する」');
  const message = `いま使える操作は${parts.join('、')}です。hキーでこの案内を繰り返します。開始・承認・拒否・作業停止・次へ進む・保留は単一キーでは実行しません。`;
  announce(message);
  if (('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window)) {
    speakText(message);
  }
}

function handleSingleKey(event) {
  if (!event || !isSingleKeyEnabled()) return;
  if (event.defaultPrevented) return;
  if (event.repeat === true) return;
  if (event.isComposing === true || event.keyCode === 229) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
  const key = typeof event.key === 'string' ? event.key : '';
  if (key === 'j') {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    speakLatest();
    return;
  }
  if (key === 'k') {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    void showDetail();
    return;
  }
  if (key === 'h') {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    announceAvailableControls();
    return;
  }
  if (key === 'Escape') {
    stopSpeechWithNotice();
  }
}

async function showDetail() {
  if (connectionUnknown || nodes['more-detail'].getAttribute('aria-disabled') === 'true') return null;
  const requestedGeneration = snapshot?.generation;
  const requestedSessionId = snapshot?.sessionId ?? null;
  const requestedSpeechSequence = speechSequence;
  const requestedSpeechStopCount = speechStopCount;
  const requestedSpeakDetailEpoch = speakDetailEpoch;
  const speakDetailAtRequest = Boolean(nodes['speak-detail-toggle'] && nodes['speak-detail-toggle'].checked === true);
  const result = await post('/api/explain', { detail: true });
  if (
    !result?.detail
    || connectionUnknown
    || result.generation !== requestedGeneration
    || snapshot?.generation !== requestedGeneration
    || (snapshot?.sessionId ?? null) !== requestedSessionId
    || speechStopCount !== requestedSpeechStopCount
  ) return result;
  detailVisible = true;
  nodes.detail.textContent = snapshot.source === 'codex'
    ? result.detail
    : `${result.detail} 根拠: ${result.evidence.map((entry) => entry.statement).join(' ') || 'まだ根拠はありません。'}`;
  nodes.detail.hidden = false;
  const speakDetailNow = speakDetailAtRequest
    && Boolean(nodes['speak-detail-toggle'] && nodes['speak-detail-toggle'].checked === true)
    && speakDetailEpoch === requestedSpeakDetailEpoch
    && speechSequence === requestedSpeechSequence;
  if (speakDetailNow) speakText(result.detail);
  return result;
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

function setControlVisible(button, visible) {
  button.hidden = !visible;
  button.disabled = !visible;
}

function releaseHiddenFocus() {
  const activeElement = document.activeElement;
  if (!activeElement || activeElement === document.body || activeElement === document.documentElement) return;
  const hiddenByAncestor = typeof activeElement.closest === 'function' && Boolean(activeElement.closest('[hidden]'));
  if (!activeElement.hidden && !activeElement.disabled && !hiddenByAncestor) return;
  const fallback = [nodes.start, nodes['more-detail'], nodes['stop-work'], nodes['read-again'], nodes['speech-stop']]
    .find((candidate) => candidate && !candidate.hidden && !candidate.disabled && !(typeof candidate.closest === 'function' && candidate.closest('[hidden]')));
  if (fallback && typeof fallback.focus === 'function') {
    fallback.focus();
  } else if (typeof activeElement.blur === 'function') {
    activeElement.blur();
  }
}

function announce(message) {
  nodes.announcement.textContent = message;
}

function markConnectionUnknown(error) {
  if (connectionUnknown) return;
  connectionUnknown = true;
  stopSpeech();
  nodes.phase.textContent = '状態不明（接続できません）';
  const defaultMessage = snapshot?.source === 'codex'
    ? '画面とサーバーの接続が切れました。AIの作業が完了や終了したとは判断できません。状態を再取得しています。接続が戻らない場合はページを再読み込みしてください。'
    : snapshot?.source === 'simulation'
      ? 'デモ画面との接続が切れました。終了したとは判断できません。状態を再取得しています。接続が戻らない場合はページを再読み込みしてください。'
      : '画面との接続を確認できません。完了や終了とは判断していません。状態を再取得しています。接続が戻らない場合はページを再読み込みしてください。';
  const message = typeof error === 'string' ? error : defaultMessage;
  lastStateAnnouncement = message;
  announce(message);
  maybeSpeakAutoVoice(snapshot, true);
  for (const button of [nodes.start, nodes.advance, nodes['read-again'], nodes['more-detail'], nodes.approve, nodes.reject, nodes.hold, nodes['stop-work']]) {
    setAriaDisabled(button, true);
  }
}

function stopSpeech() {
  speechSequence += 1;
  speechStopCount += 1;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function cancelSpeechPlayback() {
  speechSequence += 1;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function stopSpeechWithNotice() {
  stopSpeech();
  announce(snapshot?.source === 'codex'
    ? '音声を止めました。AIの作業やCodexとの接続は止まっていません。'
    : '音声を止めました。デモの進行状態は変わっていません。');
}

function speakText(text) {
  if (!text) return;
  if (!(('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window))) {
    announce('このブラウザーは音声合成に対応していません。画面の案内をご利用ください。');
    return;
  }
  stopSpeech();
  const sequence = speechSequence;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ja')) || null;
  utterance.onerror = () => {
    if (sequence === speechSequence) announce('音声を再生できませんでした。画面の案内をご利用ください。');
  };
  window.speechSynthesis.speak(utterance);
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
nodes['speech-stop'].addEventListener('click', stopSpeechWithNotice);
nodes['more-detail'].addEventListener('click', showDetail);
nodes['single-key-toggle'].addEventListener('change', () => {
  announce(nodes['single-key-toggle'].checked === true
    ? '単一キー操作を有効にしました。jで読み上げ、kで詳しく説明、hで操作の案内、Escapeで音声を止めます。開始・承認・拒否・作業停止はキーでは実行しません。'
    : '単一キー操作を無効にしました。ボタンで操作してください。');
});
nodes['auto-voice-toggle'].addEventListener('change', () => {
  if (nodes['auto-voice-toggle'].checked === true) {
    lastAutoVoiceKey = autoVoiceKeyFor(snapshot, connectionUnknown);
    announce('自動読み上げを有効にしました。次に確認できた重要な変化から読み上げます。');
  } else {
    lastAutoVoiceKey = null;
    announce('自動読み上げを無効にしました。');
  }
});
nodes['speak-detail-toggle'].addEventListener('change', () => {
  if (nodes['speak-detail-toggle'].checked === true) {
    announce('「詳しく説明」を音声でも読み上げます。');
  } else {
    speakDetailEpoch += 1;
    cancelSpeechPlayback();
    announce('「詳しく説明」は画面への表示だけにします。');
  }
});
document.addEventListener('keydown', handleSingleKey);

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
