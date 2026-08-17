/* SlimQuest - 記録の連続日数と達成バッジ
 *
 * 続けるための仕掛けは軽くしている(ジェムやクエストは作らない)。
 * 「昨日も今日も記録した」という事実だけを見せる。
 */
'use strict';

const BADGES = [
  { id: 'first', icon: '🌱', name: 'はじめの一歩', desc: '初めて記録した' },
  { id: 'd7', icon: '🔥', name: '1週間つづいた', desc: '7日連続で記録' },
  { id: 'd30', icon: '🏅', name: '1ヶ月つづいた', desc: '30日連続で記録' },
  { id: 'd100', icon: '👑', name: '100日つづいた', desc: '100日連続で記録' },
  { id: 'w2', icon: '📉', name: '-2kg', desc: '開始から2kg減った' },
  { id: 'w5', icon: '📉', name: '-5kg', desc: '開始から5kg減った' },
  { id: 'w10', icon: '📉', name: '-10kg', desc: '開始から10kg減った' },
  { id: 'goal', icon: '🎯', name: '目標達成', desc: '目標体重に到達した' },
  { id: 'recipe', icon: '🍳', name: '初レシピ', desc: 'レシピを登録した' },
  { id: 'barcode', icon: '📷', name: '初スキャン', desc: 'バーコードで登録した' },
  { id: 'suggest', icon: '💡', name: '提案を採用', desc: 'メニュー提案から作った' },
  { id: 'photo10', icon: '🖼️', name: '記録は10枚', desc: 'お腹の写真を10枚撮った' }
];

const Streak = {
  data() {
    try {
      return JSON.parse(localStorage.getItem('sq_streak') ||
        '{"count":0,"best":0,"last":"","total":0}');
    } catch (_) { return { count: 0, best: 0, last: '', total: 0 }; }
  },

  save(d) { localStorage.setItem('sq_streak', JSON.stringify(d)); },

  /** 何か記録したときに呼ぶ。同じ日に何度呼んでも1日ぶんしか数えない */
  recordToday() {
    const d = this.data();
    const today = Calc.today();
    if (d.last === today) return d;
    d.count = (d.last && Calc.diffDays(d.last, today) === 1) ? d.count + 1 : 1;
    d.last = today;
    d.total = (d.total || 0) + 1;
    d.best = Math.max(d.best || 0, d.count);
    this.save(d);
    this.checkBadges();
    return d;
  },

  /** 表示用。最後の記録が今日でも昨日でもなければ連続は途切れている */
  current() {
    const d = this.data();
    if (!d.last) return 0;
    const gap = Calc.diffDays(d.last, Calc.today());
    return gap <= 1 ? d.count : 0;
  },

  /* ---------- バッジ ---------- */

  badges() {
    try { return JSON.parse(localStorage.getItem('sq_badges') || '{}'); }
    catch (_) { return {}; }
  },

  unlock(id) {
    const b = this.badges();
    if (b[id]) return false;
    b[id] = Calc.today();
    localStorage.setItem('sq_badges', JSON.stringify(b));
    const def = BADGES.find((x) => x.id === id);
    if (def && typeof showToast === 'function') {
      showToast(`${def.icon} バッジ「${def.name}」を獲得しました`);
    }
    return true;
  },

  checkBadges() {
    const d = this.data();
    if (d.total >= 1) this.unlock('first');
    if (d.count >= 7) this.unlock('d7');
    if (d.count >= 30) this.unlock('d30');
    if (d.count >= 100) this.unlock('d100');

    const p = Profile.get();
    const cur = Weight.current();
    if (p.startWeight) {
      const lost = p.startWeight - cur;
      if (lost >= 2) this.unlock('w2');
      if (lost >= 5) this.unlock('w5');
      if (lost >= 10) this.unlock('w10');
    }
    if (p.goalWeight && cur <= p.goalWeight) this.unlock('goal');
  },

  render() {
    const got = this.badges();
    const d = this.data();
    document.getElementById('badge-summary').textContent =
      `連続 ${this.current()} 日 · 最長 ${d.best || 0} 日 · 記録した日数 ${d.total || 0} 日`;
    document.getElementById('badge-list').innerHTML = BADGES.map((b) => `
      <div class="badge${got[b.id] ? ' got' : ''}">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-name">${escapeHtml(b.name)}</span>
        <span class="badge-desc">${got[b.id] ? escapeHtml(got[b.id]) : escapeHtml(b.desc)}</span>
      </div>`).join('');
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Streak, BADGES };
