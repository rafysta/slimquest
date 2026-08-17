/* SlimQuest - メニューDB(検索・頻出ランキング・登録)
 *
 * 検索対象は「同梱データ(foods.js)」+「自分で登録したメニュー(IndexedDB)」。
 * 使用回数は localStorage の sq_use に持つ(同梱データにも回数を付けたいため、
 * メニュー本体とは別管理にしている)。
 */
'use strict';

const Menus = {
  _custom: [],
  _loaded: false,

  /* ---------- 読み込み ---------- */

  async load() {
    this._custom = await DB.getAll('menus');
    this._loaded = true;
    return this._custom;
  },

  /** 同梱 + 自作。自作を先に置き、同名があれば自作を優先する */
  all() {
    const seen = new Set(this._custom.map((m) => Calc.norm(m.name)));
    return this._custom.concat(FOODS.filter((f) => !seen.has(Calc.norm(f.name))));
  },

  byId(id) {
    return this.all().find((m) => m.id === Number(id)) || null;
  },

  /* ---------- 使用履歴 ---------- */

  _use() {
    try { return JSON.parse(localStorage.getItem('sq_use') || '{}'); }
    catch (_) { return {}; }
  },
  _saveUse(u) { localStorage.setItem('sq_use', JSON.stringify(u)); },

  /** 記録するたびに呼ぶ。全体の回数と、食事区分ごとの回数を数える */
  touch(id, slot) {
    const u = this._use();
    const k = String(id);
    const e = u[k] || { n: 0, last: '', slots: {} };
    e.n += 1;
    e.last = Calc.today();
    if (slot) e.slots[slot] = (e.slots[slot] || 0) + 1;
    u[k] = e;
    this._saveUse(u);
  },

  useOf(id) {
    return this._use()[String(id)] || { n: 0, last: '', slots: {} };
  },

  /**
   * よく食べるもの。全体の回数に加えて、
   * その時間帯によく食べているもの・最近食べたものを上に出す。
   */
  frequent(slot, limit) {
    const u = this._use();
    const list = this.all()
      .map((m) => {
        const e = u[String(m.id)];
        if (!e || !e.n) return null;
        const slotN = (e.slots && e.slots[slot]) || 0;
        const days = e.last ? Calc.diffDays(e.last, Calc.today()) : 999;
        const recency = days <= 2 ? 4 : days <= 7 ? 2 : 0;
        return { menu: m, score: e.n + slotN * 3 + recency };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 12)
      .map((x) => x.menu);
    return list;
  },

  /**
   * 検索。名前と読みの両方を正規化して照合し、前方一致 → 部分一致 → 使用回数 の順に並べる。
   * 1〜2文字でも即座に候補が出るよう、全件を毎回走査する(件数が小さいので十分速い)。
   */
  search(q, limit) {
    const n = Calc.norm(q);
    if (!n) return [];
    const u = this._use();
    return this.all()
      .map((m) => {
        const s = Math.max(
          Calc.matchScore(Calc.norm(m.name), n),
          Calc.matchScore(Calc.norm(m.kana || ''), n)
        );
        if (!s) return null;
        const used = (u[String(m.id)] || {}).n || 0;
        return { menu: m, s, used };
      })
      .filter(Boolean)
      .sort((a, b) => (b.s - a.s) || (b.used - a.used) || a.menu.name.length - b.menu.name.length)
      .slice(0, limit || 30)
      .map((x) => x.menu);
  },

  /* ---------- 登録 ---------- */

  /** 新しいメニューを保存して、保存後のオブジェクト(id付き)を返す */
  async add(menu) {
    const rec = {
      name: String(menu.name || '').trim(),
      kana: Calc.norm(menu.kana || menu.name || ''),
      base: String(menu.base || '1人前').trim(),
      kcal: Math.round(Number(menu.kcal) || 0),
      p: Calc.r1(menu.p),
      f: Calc.r1(menu.f),
      c: Calc.r1(menu.c),
      origin: menu.origin || 'manual',
      createdAt: Calc.today()
    };
    if (menu.jan) rec.jan = String(menu.jan);
    if (menu.ingredients) rec.ingredients = menu.ingredients;
    if (menu.serves) rec.serves = Number(menu.serves);
    const id = await DB.add('menus', rec);
    rec.id = id;
    this._custom.push(rec);
    return rec;
  },

  async update(menu) {
    await DB.put('menus', menu);
    const i = this._custom.findIndex((m) => m.id === menu.id);
    if (i >= 0) this._custom[i] = menu;
    return menu;
  },

  async remove(id) {
    await DB.del('menus', Number(id));
    this._custom = this._custom.filter((m) => m.id !== Number(id));
    const u = this._use();
    delete u[String(id)];
    this._saveUse(u);
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Menus };
