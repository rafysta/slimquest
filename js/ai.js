/* SlimQuest - AI検索(新規メニュー登録の補助)
 *
 * Anthropic API + Web検索ツールで「シリアル カロリー」のような検索を行い、
 * 商品・メニュー候補(名前 / 基準量 / カロリー / PFC)をリストで表示する。
 * 情報が足りないときはAIが追加の質問を返し、選択肢 or 自由入力で絞り込む。
 *
 * APIキーは設定画面から localStorage に保存する(通信は Anthropic API のみ)。
 * 通信が必要なのは新しいメニューの初回登録時だけで、記録自体は今まで通り
 * すべてオフラインで完結する。
 */
'use strict';

const AI = {
  MODEL: 'claude-sonnet-4-5',
  _KEY: 'sq_ai_key',

  getKey() { return localStorage.getItem(this._KEY) || ''; },
  setKey(k) {
    const v = String(k || '').trim();
    if (v) localStorage.setItem(this._KEY, v);
    else localStorage.removeItem(this._KEY);
  },
  hasKey() { return !!this.getKey(); },

  /**
   * 食品を調べる。answers は追加質問への回答 [{q, a}]。
   * 戻り値: { candidates: [{name, base, kcal, p, f, c, note}], questions: [{q, options}] }
   */
  async searchFood(query, answers) {
    const system = [
      'あなたは日本のダイエット記録アプリの食品データ登録アシスタントです。',
      'ユーザーが入力した食品・料理・市販品について、必要ならWeb検索で栄養成分を調べ、候補をJSONで返します。',
      '',
      'ルール:',
      '- 市販品・外食メニューは、メーカーや店の公式栄養成分表を優先して調べる。',
      '- 一般的な食材・料理でWeb検索が不要なら、日本食品標準成分表ベースの知識で答えてよい。',
      '- 候補は最大5件。base(基準量)は「よく食べる1回ぶん」を日本語で書く(例: 1食 40g / 1袋 / 200ml)。',
      '- kcalは整数、p/f/c(たんぱく質・脂質・炭水化物のg)は小数1桁。不明なら妥当な推定を入れ、noteに推定と書く。',
      '- noteには値の出どころを短く書く(例: 公式サイト / パッケージ表示 / 推定)。',
      '- 入力が曖昧で候補を絞れないとき(メーカー・味・サイズなどが不明)は、questionsに質問を最大2件入れる。各質問には代表的なoptionsを3〜5個付ける。',
      '- 質問を返す場合でも、代表的な候補が出せるならcandidatesにも入れてよい。回答済みの質問は繰り返さない。',
      '- 出力は次の形のJSONのみ。説明文・マークダウンは一切付けない。',
      '{"candidates":[{"name":"","base":"","kcal":0,"p":0,"f":0,"c":0,"note":""}],"questions":[{"q":"","options":[""]}]}'
    ].join('\n');

    let user = `調べたい食品: ${query}`;
    if (answers && answers.length) {
      user += '\n\nこれまでの質問と回答:\n' +
        answers.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.getKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }]
      })
    });

    if (!res.ok) {
      let msg = `APIエラー (${res.status})`;
      try {
        const e = await res.json();
        if (e && e.error && e.error.message) msg += `: ${e.error.message}`;
      } catch (_) { /* 本文がJSONでなくてもそのまま */ }
      if (res.status === 401) msg = 'APIキーが正しくありません。設定画面で確認してください。';
      throw new Error(msg);
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return this._parse(text);
  },

  /** 応答テキストからJSONを取り出す(前後に余計な文が付いていても耐える) */
  _parse(text) {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s < 0 || e <= s) throw new Error('AIの応答を読み取れませんでした。もう一度試してください。');
    let obj;
    try { obj = JSON.parse(text.slice(s, e + 1)); }
    catch (_) { throw new Error('AIの応答を読み取れませんでした。もう一度試してください。'); }
    return {
      candidates: Array.isArray(obj.candidates) ? obj.candidates.filter((c) => c && c.name) : [],
      questions: Array.isArray(obj.questions) ? obj.questions.filter((q) => q && q.q) : []
    };
  }
};

/* ---------- 新規メニュー画面のAI検索UI ---------- */

const AiUI = {
  _answers: [],
  _busy: false,

  box() { return document.getElementById('ai-box'); },

  reset() {
    this._answers = [];
    this._busy = false;
    const b = this.box();
    b.innerHTML = '';
    b.classList.add('hidden');
  },

  /** 「ネットで調べる」ボタンから */
  start() {
    const name = document.getElementById('mn-name').value.trim();
    if (!name) { appAlert('まず名前を入力してください(例: シリアル、フルグラ)'); return; }
    if (!AI.hasKey()) {
      appConfirm('AI検索を使うには Anthropic APIキーの設定が必要です。設定画面を開きますか?', 'AI検索')
        .then((ok) => { if (ok) showScreen('settings'); });
      return;
    }
    this._answers = [];
    this.run(name);
  },

  async run(query) {
    if (this._busy) return;
    this._busy = true;
    const b = this.box();
    b._query = query;
    b.classList.remove('hidden');
    b.innerHTML = '<p class="ai-status">🔍 調べています...(数秒〜十数秒かかります)</p>';
    try {
      const r = await AI.searchFood(query, this._answers);
      this._render(r);
    } catch (err) {
      b.innerHTML = `<p class="ai-status warn-text">⚠ ${escapeHtml(err.message)}</p>`;
    }
    this._busy = false;
  },

  _render(r) {
    const b = this.box();
    let html = '';

    if (r.candidates.length) {
      html += '<p class="ai-status">候補をタップすると下の欄に入ります。</p>';
      html += r.candidates.map((c, i) => `
        <button class="food-row" data-ai-pick="${i}">
          <span class="food-main">
            <span class="food-name">${escapeHtml(c.name)}</span>
            <span class="food-base">${escapeHtml(c.base || '')}${c.note ? ' · ' + escapeHtml(c.note) : ''}</span>
          </span>
          <span class="food-kcal">${Math.round(Number(c.kcal) || 0)}<small>kcal</small></span>
        </button>`).join('');
    }

    if (r.questions.length) {
      const q = r.questions[0];
      const opts = Array.isArray(q.options) ? q.options : [];
      b._q = q;
      html += `<div class="ai-q">
        <p>❓ ${escapeHtml(q.q)}</p>
        <div class="ai-opts">${opts.map((o, i) =>
          `<button class="ai-opt" data-ai-opt="${i}">${escapeHtml(o)}</button>`).join('')}</div>
        <div class="ai-free">
          <input type="text" id="ai-free-input" placeholder="自由に記述して絞り込む">
          <button class="ai-opt" id="ai-free-send">送信</button>
        </div>
      </div>`;
    }

    if (!html) html = '<p class="ai-status">候補が見つかりませんでした。名前を変えて試すか、手で入力してください。</p>';
    b.innerHTML = html;
    b._cands = r.candidates;

    b.querySelectorAll('[data-ai-pick]').forEach((el) => {
      el.addEventListener('click', () => this._pick(b._cands[Number(el.dataset.aiPick)]));
    });
    b.querySelectorAll('[data-ai-opt]').forEach((el) => {
      el.addEventListener('click', () => this._answer(b._q, (b._q.options || [])[Number(el.dataset.aiOpt)]));
    });
    const send = document.getElementById('ai-free-send');
    if (send) {
      send.addEventListener('click', () => {
        const v = document.getElementById('ai-free-input').value.trim();
        if (v) this._answer(b._q, v);
      });
    }
  },

  _answer(q, a) {
    if (!q || !a) return;
    this._answers.push({ q: q.q, a });
    this.run(this.box()._query);
  },

  /** 候補をフォームへ反映する(登録は今まで通りユーザーが確認して行う) */
  _pick(c) {
    if (!c) return;
    const nameEl = document.getElementById('mn-name');
    nameEl.value = c.name;
    nameEl.dataset.origin = 'ai';
    document.getElementById('mn-base').value = c.base || '1人前';
    document.getElementById('mn-kcal').value = Math.round(Number(c.kcal) || 0);
    document.getElementById('mn-p').value = Calc.r1(c.p);
    document.getElementById('mn-f').value = Calc.r1(c.f);
    document.getElementById('mn-c').value = Calc.r1(c.c);
    this.box().classList.add('hidden');
    showToast('入力しました。確認して登録してください');
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { AI, AiUI };
