/* SlimQuest - 買い物リスト
 *
 * 献立提案で「足りない材料」だけがここに溜まり、手で足すこともできる。
 * 買い物のあいだはチェックを付けていき、帰ってきたら
 * 「チェックしたものを手持ちに移す」の1タップで手持ち食材リストへ移す。
 * 買った物がそのまま次の献立提案の材料になる、という一周を作るのが目的。
 *
 * チェック済みは消さずに下へ沈める(買い忘れの確認ができるように)。
 */
'use strict';

const Shopping = {
  _list: [],

  async load() {
    this._list = await DB.getAll('shopping');
    return this._list;
  },

  all() { return this._list; },

  /** 未チェックが上・チェック済みが下。同じ区分の中では追加した順 */
  sorted() {
    return this._list.slice().sort((a, b) =>
      (a.checked ? 1 : 0) - (b.checked ? 1 : 0) || (a.id || 0) - (b.id || 0));
  },

  remaining() { return this._list.filter((x) => !x.checked).length; },

  /** 同じ名前の未チェックが既にあれば足さない(提案を続けて採用しても重複しない) */
  async add(name, amount, source) {
    const n = String(name || '').trim();
    if (!n) return null;
    const k = Calc.norm(n);
    const dup = this._list.find((x) => !x.checked && Calc.norm(x.name) === k);
    if (dup) return dup;
    const rec = {
      name: n,
      amount: String(amount || ''),
      checked: false,
      addedAt: Calc.today(),
      source: source || 'manual'
    };
    rec.id = await DB.add('shopping', rec);
    this._list.push(rec);
    await IngWords.touch(n);
    return rec;
  },

  async toggle(id) {
    const x = this._list.find((v) => v.id === Number(id));
    if (!x) return null;
    x.checked = !x.checked;
    await DB.put('shopping', x);
    return x;
  },

  async remove(id) {
    await DB.del('shopping', Number(id));
    this._list = this._list.filter((x) => x.id !== Number(id));
  },

  async clearChecked() {
    const checked = this._list.filter((x) => x.checked);
    for (const x of checked) await DB.del('shopping', x.id);
    this._list = this._list.filter((x) => !x.checked);
    return checked.length;
  },

  /** チェックしたものを手持ち食材へ移す(買ってきた = 家にある) */
  async moveCheckedToPantry() {
    const checked = this._list.filter((x) => x.checked);
    let moved = 0;
    for (const x of checked) {
      if (await Pantry.add(x.name)) moved += 1;
      await DB.del('shopping', x.id);
    }
    this._list = this._list.filter((x) => !x.checked);
    return { moved, removed: checked.length };
  },

  /* ---------- 画面 ---------- */

  render() {
    this.renderList();
    this.renderSuggest();
  },

  renderList() {
    const box = document.getElementById('sp-list');
    const list = this.sorted();
    document.getElementById('sp-count').textContent =
      list.length ? `買うもの(のこり ${this.remaining()} / ${list.length})` : '買うもの';
    if (!list.length) {
      box.innerHTML = '<p class="empty small">まだ何もありません。上の欄から追加するか、' +
        '献立の提案で「これにする」を選ぶと、足りない材料がここに入ります。</p>';
      return;
    }
    box.innerHTML = '<ul class="shop-list">' + list.map((x) => `
      <li class="${x.checked ? 'done' : ''}">
        <button class="shop-check" data-sp-tg="${x.id}" aria-label="チェック">${x.checked ? '☑' : '☐'}</button>
        <span class="shop-name">${escapeHtml(x.name)}${x.amount ? ` <small>${escapeHtml(x.amount)}</small>` : ''}</span>
        ${x.source === 'suggest' ? '<span class="shop-tag">献立</span>' : ''}
        <button class="dl-del" data-sp-del="${x.id}" aria-label="削除">×</button>
      </li>`).join('') + '</ul>';

    box.querySelectorAll('[data-sp-tg]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.toggle(b.dataset.spTg);
        this.renderList();
      });
    });
    box.querySelectorAll('[data-sp-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.remove(b.dataset.spDel);
        this.renderList();
      });
    });
  },

  renderSuggest() {
    const q = document.getElementById('sp-input').value.trim();
    const box = document.getElementById('sp-suggest');
    const list = IngWords.suggest(q, 12)
      .filter((n) => !this._list.some((x) => !x.checked && Calc.norm(x.name) === Calc.norm(n)));
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map((n) =>
      `<button class="chip add" data-sp-add="${escapeHtml(n)}">＋ ${escapeHtml(n)}</button>`).join('');
    box.querySelectorAll('[data-sp-add]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.add(b.dataset.spAdd, '', 'manual');
        document.getElementById('sp-input').value = '';
        this.render();
      });
    });
  },

  async addTyped() {
    const el = document.getElementById('sp-input');
    const v = el.value.trim();
    if (!v) { appAlert('買うものを入力してください'); return; }
    await this.add(v, '', 'manual');
    el.value = '';
    this.render();
    showToast(`${v} を追加しました`);
  },

  async onMoveToPantry() {
    if (!this._list.some((x) => x.checked)) {
      appAlert('買えたものにチェックを付けてから押してください');
      return;
    }
    const r = await this.moveCheckedToPantry();
    this.render();
    showToast(r.moved
      ? `${r.moved}件を手持ち食材に移しました`
      : 'すべて手持ちにあったのでリストから消しました');
  },

  async onClearChecked() {
    const n = this._list.filter((x) => x.checked).length;
    if (!n) { appAlert('チェックが付いているものがありません'); return; }
    if (!await appConfirm(`チェックした${n}件をリストから消します。`, '買い物リスト')) return;
    await this.clearChecked();
    this.render();
    showToast(`${n}件を消しました`);
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Shopping };
