/* SlimQuest - IndexedDB ヘルパー
 *
 * ストア一覧(Phase 1 以降も形は変えない。将来の機能ぶんも最初から作っておく):
 *   menus     メニューDB      {id, name, kana, kcal, p, f, c, base, origin, jan?, ingredients?, serves?, useCount, lastUsed}
 *   meals     食事記録        {id, date, slot, menuId, name, kcal, p, f, c, factor}
 *   weights   体重            {date, weight, bodyFat}         ※keyPath=date(1日1件)
 *   exercises 運動            {id, date, type, mets, minutes, kcal, auto}
 *   photos    お腹の写真      {id, date, blob, w, h}
 *   shopping  買い物リスト    {id, name, amount, checked, addedAt, source}
 *   pantry    手持ち食材      {id, name, kana, addedAt}
 *   ingWords  食材入力履歴    {name, kana, useCount, lastUsed}  ※keyPath=name
 */
'use strict';

const DB = {
  NAME: 'slimquest',
  VERSION: 1,
  _p: null,

  /** DBを開く(初回はストアを作成)。以降は同じPromiseを使い回す */
  open() {
    if (this._p) return this._p;
    this._p = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const mk = (name, opts) =>
          db.objectStoreNames.contains(name) ? null : db.createObjectStore(name, opts);

        const menus = mk('menus', { keyPath: 'id', autoIncrement: true });
        if (menus) menus.createIndex('jan', 'jan', { unique: false });

        const meals = mk('meals', { keyPath: 'id', autoIncrement: true });
        if (meals) meals.createIndex('date', 'date', { unique: false });

        mk('weights', { keyPath: 'date' });

        const ex = mk('exercises', { keyPath: 'id', autoIncrement: true });
        if (ex) ex.createIndex('date', 'date', { unique: false });

        const ph = mk('photos', { keyPath: 'id', autoIncrement: true });
        if (ph) ph.createIndex('date', 'date', { unique: false });

        mk('shopping', { keyPath: 'id', autoIncrement: true });
        mk('pantry', { keyPath: 'id', autoIncrement: true });
        mk('ingWords', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDBを開けません'));
    });
    return this._p;
  },

  /** 1件の読み書きをPromiseで包む共通処理 */
  async _tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('中断されました'));
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve();
      }
    });
  },

  get(store, key) { return this._tx(store, 'readonly', (s) => s.get(key)); },
  getAll(store) { return this._tx(store, 'readonly', (s) => s.getAll()); },
  put(store, value) { return this._tx(store, 'readwrite', (s) => s.put(value)); },
  add(store, value) { return this._tx(store, 'readwrite', (s) => s.add(value)); },
  del(store, key) { return this._tx(store, 'readwrite', (s) => s.delete(key)); },
  clear(store) { return this._tx(store, 'readwrite', (s) => s.clear()); },

  /** インデックスで完全一致の複数件を取得 */
  byIndex(store, index, value) {
    return this._tx(store, 'readonly', (s) => s.index(index).getAll(value));
  },

  /** インデックスで範囲(lower〜upper、両端含む)の複数件を取得。日記のカレンダーで1ヶ月ぶんを引く */
  byIndexRange(store, index, lower, upper) {
    return this._tx(store, 'readonly',
      (s) => s.index(index).getAll(IDBKeyRange.bound(lower, upper)));
  },

  /** 複数件をまとめて保存(1トランザクション) */
  async putAll(store, values) {
    if (!values.length) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      values.forEach((v) => os.put(v));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};
