/* SlimQuest - 手持ち食材リストと食材の入力履歴
 *
 * 「冷蔵庫に何があるか」を並べておくリスト。ここが献立提案(js/suggest.js)の起点になる。
 *
 * 食材名の入力は毎回タイプさせると続かないので、入力履歴(ingWords)を辞書として持ち、
 *   ・欄が空のとき  … よく使う食材をチップで出す(タップだけで追加)
 *   ・文字を入れたとき … 履歴 → 同梱食品(foods.js)の順に候補を出す
 * という2段構えにしている。この辞書は手持ち食材・買い物リスト・献立提案の3箇所で
 * 共有するので、どこで入力しても学習され、どこでも候補に出る。
 */
'use strict';

/* ---------- 食材の入力履歴(ingWords)---------- */

const IngWords = {
  _list: [],

  async load() {
    this._list = await DB.getAll('ingWords');
    return this._list;
  },

  all() { return this._list; },

  /** 食材名が使われるたびに呼ぶ(手持ち・買い物・提案の採用すべてから) */
  async touch(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const i = this._list.findIndex((x) => x.name === n);
    const rec = i >= 0 ? this._list[i] : { name: n, kana: '', useCount: 0, lastUsed: '' };
    rec.kana = Calc.norm(n);
    rec.useCount = (rec.useCount || 0) + 1;
    rec.lastUsed = Calc.today();
    if (i >= 0) this._list[i] = rec; else this._list.push(rec);
    await DB.put('ingWords', rec);
    return rec;
  },

  /** よく使う食材(回数 + 最近使ったか)。名前の配列を返す */
  frequent(limit) {
    return this._list
      .map((w) => {
        const days = w.lastUsed ? Calc.diffDays(w.lastUsed, Calc.today()) : 999;
        const recency = days <= 3 ? 3 : days <= 14 ? 1 : 0;
        return { name: w.name, score: (w.useCount || 0) + recency };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 12)
      .map((x) => x.name);
  },

  /**
   * 入力補完の候補。空なら「よく使う食材」、文字があれば
   * 履歴 → 同梱食品 の順に前方一致優先で返す(名前の重複は除く)。
   */
  suggest(q, limit) {
    const lim = limit || 12;
    const n = Calc.norm(q);
    const out = [];
    const seen = new Set();
    const push = (name) => {
      const k = Calc.norm(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(name);
    };

    if (!n) {
      this.frequent(lim).forEach(push);
      return out.slice(0, lim);
    }

    const score = (name, kana) => Math.max(
      Calc.matchScore(Calc.norm(name), n),
      Calc.matchScore(Calc.norm(kana || ''), n)
    );

    this._list
      .map((w) => ({ name: w.name, s: score(w.name, w.kana), u: w.useCount || 0 }))
      .filter((x) => x.s)
      .sort((a, b) => (b.s - a.s) || (b.u - a.u))
      .forEach((x) => push(x.name));

    (typeof FOODS === 'undefined' ? [] : FOODS)
      .map((f) => ({ name: f.name, s: score(f.name, f.kana) }))
      .filter((x) => x.s)
      .sort((a, b) => (b.s - a.s) || (a.name.length - b.name.length))
      .forEach((x) => push(x.name));

    return out.slice(0, lim);
  }
};

/* ---------- 手持ち食材リスト ---------- */

const Pantry = {
  _list: [],

  async load() {
    const all = await DB.getAll('pantry');
    this._list = all.sort((a, b) => (b.id || 0) - (a.id || 0));
    return this._list;
  },

  all() { return this._list; },
  names() { return this._list.map((x) => x.name); },
  count() { return this._list.length; },

  has(name) {
    const k = Calc.norm(name);
    return !!k && this._list.some((x) => Calc.norm(x.name) === k);
  },

  /** 同じものは二重に持たない(数量は管理しない。あるか無いかだけで十分) */
  async add(name) {
    const n = String(name || '').trim();
    if (!n || this.has(n)) return null;
    const rec = { name: n, kana: this.reading(n), addedAt: Calc.today() };
    rec.id = await DB.add('pantry', rec);
    this._list.unshift(rec);
    await IngWords.touch(n);
    return rec;
  },

  async remove(id) {
    await DB.del('pantry', Number(id));
    this._list = this._list.filter((x) => x.id !== Number(id));
  },

  async clear() {
    await DB.clear('pantry');
    this._list = [];
  },

  /**
   * 食材名の読み。同梱食品(foods.js)に名前か読みが一致するものがあればその読みを使う。
   * 「玉ねぎ」と「たまねぎ」のように表記が違っても同じ食材として扱えるようにするため。
   */
  reading(name) {
    const k = Calc.norm(name);
    if (!k) return '';
    const list = (typeof FOODS === 'undefined' ? [] : FOODS);
    const f = list.find((x) => Calc.norm(x.name) === k || Calc.norm(x.kana) === k);
    return f ? Calc.norm(f.kana) : k;
  },

  /**
   * 2つの食材名が同じものを指しているか。
   * AIは「豚肉」、手持ちは「豚こま切れ肉」のように粒度がずれるので、
   *   ① 完全一致  ② どちらかがどちらかを含む  ③ 文字が順番どおり現れる(飛ばし一致)
   * のいずれかで一致とみなす。③があるので「豚肉」が「豚こま切れ肉」に当たる。
   * 1文字の食材(米・塩・油)が何にでも当たらないよう、②③は2文字以上のときだけ許す。
   */
  same(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length < 2 || b.length < 2) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const sub = (needle, hay) => {
      if (needle.length >= hay.length) return false;
      let i = 0;
      for (const ch of hay) if (ch === needle[i]) i += 1;
      return i === needle.length;
    };
    return sub(a, b) || sub(b, a);
  },

  /** 提案の材料が手持ちにあるか。あればその手持ちレコードを返す */
  matches(ingName) {
    const k = Calc.norm(ingName);
    if (!k) return null;
    const kk = this.reading(ingName);
    return this._list.find((x) =>
      this.same(Calc.norm(x.name), k) || this.same(x.kana || Calc.norm(x.name), kk)) || null;
  },

  /* ---------- 画面 ---------- */

  render() {
    this.renderList();
    this.renderSuggest();
  },

  renderList() {
    const box = document.getElementById('pt-list');
    document.getElementById('pt-count').textContent =
      this._list.length ? `いま家にあるもの(${this._list.length})` : 'いま家にあるもの';
    if (!this._list.length) {
      box.innerHTML = '<p class="empty small">まだ何も入っていません。上の欄から追加してください。' +
        '一度入れた食材は次から候補に出るので、タップだけで足せます。</p>';
      return;
    }
    box.innerHTML = this._list.map((x) =>
      `<span class="chip"><span class="chip-t">${escapeHtml(x.name)}</span>` +
      `<button data-pt-del="${x.id}" aria-label="削除">×</button></span>`).join('');
    box.querySelectorAll('[data-pt-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.remove(b.dataset.ptDel);
        this.render();
      });
    });
  },

  renderSuggest() {
    const q = document.getElementById('pt-input').value.trim();
    const box = document.getElementById('pt-suggest');
    const list = IngWords.suggest(q, 14).filter((n) => !this.has(n));
    if (!list.length) {
      box.innerHTML = q
        ? '<p class="empty small">候補にありません。右の「追加」でそのまま登録できます。</p>'
        : '<p class="empty small">よく使う食材はここに並びます。</p>';
      return;
    }
    box.innerHTML = list.map((n) =>
      `<button class="chip add" data-pt-add="${escapeHtml(n)}">＋ ${escapeHtml(n)}</button>`).join('');
    box.querySelectorAll('[data-pt-add]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.add(b.dataset.ptAdd);
        document.getElementById('pt-input').value = '';
        this.render();
      });
    });
  },

  /** 入力欄の文字をそのまま追加する(候補になくても登録できるように) */
  async addTyped() {
    const el = document.getElementById('pt-input');
    const v = el.value.trim();
    if (!v) { appAlert('食材の名前を入力してください'); return; }
    if (this.has(v)) {
      showToast(`${v} はもう入っています`);
    } else {
      await this.add(v);
      showToast(`${v} を追加しました`);
    }
    el.value = '';
    this.render();
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Pantry, IngWords };
