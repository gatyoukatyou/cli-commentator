const nodes = Object.fromEntries([
  'phase', 'current-work', 'changed', 'decision', 'announcement', 'transcript', 'detail',
  'approval-panel', 'approval-heading', 'approval-title', 'approval-details', 'approval-state',
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
  if (!generationChanged && !recovering) return;
  connectionUnknown = false;
  snapshot = next;
  lastGeneration = snapshot.generation;
  if (previousGeneration >= 0 && generationChanged) {
    stopSpeech();
    detailVisible = false;
    nodes.detail.textContent = '';
    nodes.detail.hidden = true;
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

  const active = snapshot.status === 'running' || snapshot.status === 'awaiting-human';
  setAriaDisabled(nodes.start, connectionUnknown || active);
  setAriaDisabled(nodes.advance, connectionUnknown || snapshot.status !== 'running');
  setAriaDisabled(nodes['read-again'], connectionUnknown || !latest);
  setAriaDisabled(nodes['more-detail'], connectionUnknown);
  setAriaDisabled(nodes['stop-work'], connectionUnknown || snapshot.status === 'finished' || snapshot.status === 'stopped');

  const approval = snapshot.approval;
  nodes['approval-panel'].hidden = approval === null;
  if (approval) {
    nodes['approval-heading'].textContent = approval.status === 'pending' ? 'あなたの判断が必要です' : '判断の結果';
    nodes['approval-title'].textContent = approval.title;
    nodes['approval-details'].textContent = approval.details;
    const pending = approval.status === 'pending';
    for (const button of [nodes.approve, nodes.reject, nodes.hold]) {
      setAriaDisabled(button, connectionUnknown || !pending);
    }
    nodes['approval-state'].textContent = pending
      ? '返答待ちです。保留して、あとで判断することもできます。'
      : approval.status === 'cancelled'
        ? 'デモが停止したため、この判断は取り消されました。'
        : approval.status === 'approve'
          ? '承認を記録しました。実際の共有は行っていません。'
          : '拒否を記録しました。実際の共有は行っていません。';
  }

  if (generationChanged) {
    announce(`${snapshot.phaseLabel}。いまの作業、変わったこと、あなたの判断を更新しました。`);
  }
  if (recovering && !generationChanged) announce(`接続が戻りました。${snapshot.phaseLabel}の状態を確認しました。`);
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
  announce('音声を止めました。デモの進行状態は変わっていません。');
});
nodes['more-detail'].addEventListener('click', async () => {
  if (connectionUnknown) return;
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

void bootstrap();
