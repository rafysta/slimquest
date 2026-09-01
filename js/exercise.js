/* SlimQuest - 運動の記録
 *
 * 消費カロリーは METs 方式: METs × 体重(kg) × 時間(h) × 1.05
 * ホームの収支では「基礎消費(BMR×1.2)+ ここで記録した運動」を消費とする。
 * 活動係数を低め固定にしているので、運動を記録するほど収支に正しく反映される。
 */
'use strict';

const EX_PRESETS = [
  { type: '自転車(通勤)', icon: '🚲', mets: 6.0, min: 20 },
  { type: '水泳(ゆっくり)', icon: '🏊', mets: 6.0, min: 30 },
  { type: '水泳(しっかり)', icon: '🏊', mets: 8.3, min: 30 },
  { type: '社交ダンス', icon: '💃', mets: 4.8, min: 60 },
  { type: '腹筋・体幹', icon: '🧘', mets: 3.8, min: 10 },
  { type: '筋トレ', icon: '🏋️', mets: 5.0, min: 30 },
  { type: 'ウォーキング', icon: '🚶', mets: 3.5, min: 30 },
  { type: 'ジョギング', icon: '🏃', mets: 7.0, min: 30 },
  { type: '階段・掃除など', icon: '🧹', mets: 3.3, min: 20 }
];

const Exercise = {
  sel: null,

  /** これから記録する日。日記から入ったときだけ今日以外になる(食事記録と同じ作り) */
  targetDate: '',
  /** 運動画面の戻り先('home' / 'diary') */
  backTo: 'home',

  date() { return this.targetDate || Calc.today(); },
  isToday() { return this.date() === Calc.today(); },

  async byDate(date) {
    const list = await DB.byIndex('exercises', 'date', date);
    return list.sort((a, b) => (a.id || 0) - (b.id || 0));
  },

  async add(date, preset, minutes) {
    const w = Weight.current();
    const rec = {
      date,
      type: preset.type,
      mets: preset.mets,
      minutes: Number(minutes) || preset.min,
      auto: !!preset.auto
    };
    rec.kcal = Calc.exerciseKcal(rec.mets, w, rec.minutes);
    rec.id = await DB.add('exercises', rec);
    return rec;
  },

  remove(id) { return DB.del('exercises', Number(id)); },

  async burnedOn(date) {
    const list = await this.byDate(date);
    return list.reduce((s, e) => s + (e.kcal || 0), 0);
  },

  /**
   * 自転車通勤の自動計上。平日の初回起動時に1回だけ追加する。
   * 休みの日は日記から × を押して消せる。
   */
  async autoLogToday() {
    const cfg = Profile.autoCommute();
    if (!cfg || !cfg.on) return;
    const today = Calc.today();
    if (!Calc.isWeekday(today)) return;
    if (localStorage.getItem('sq_auto_last') === today) return;
    const list = await this.byDate(today);
    if (list.some((e) => e.auto)) {
      localStorage.setItem('sq_auto_last', today);
      return;
    }
    await this.add(today, {
      type: '自転車(通勤)', mets: 6.0, min: cfg.minutes, auto: true
    }, cfg.minutes);
    localStorage.setItem('sq_auto_last', today);
  },

  /* ---------- 画面 ---------- */

  /**
   * 運動の記録画面を開く。
   * from に 'diary' を渡すと日記で開いている日に記録し、戻るボタンも日記に返る
   * (運動も、あとから「そういえば一昨日プールに行った」と足せるようにするため)。
   */
  open(from) {
    this.backTo = from === 'diary' ? 'diary' : 'home';
    this.targetDate = from === 'diary' ? (Meals.diaryDate || Calc.today()) : Calc.today();
    showScreen('exercise');
  },

  /** 今日以外に記録するときだけ、どの日に入るかを目立たせる */
  renderDateNote() {
    const el = document.getElementById('ex-date-note');
    if (!el) return;
    if (this.isToday()) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = `📅 ${Calc.fmtShort(this.date())} の記録として追加します`;
      el.classList.remove('hidden');
    }
  },

  async render() {
    this.renderDateNote();
    const box = document.getElementById('ex-presets');
    box.innerHTML = EX_PRESETS.map((p, i) => `
      <button class="ex-btn" data-ex="${i}">
        <span class="ex-icon">${p.icon}</span>
        <span class="ex-name">${escapeHtml(p.type)}</span>
        <span class="ex-mets">${p.mets} METs</span>
      </button>`).join('');
    box.querySelectorAll('[data-ex]').forEach((b) => {
      b.addEventListener('click', () => this.select(Number(b.dataset.ex)));
    });
    this.select(this.sel === null ? 0 : this.sel);
    await this.renderToday();
  },

  select(i) {
    this.sel = i;
    const p = EX_PRESETS[i];
    document.querySelectorAll('#ex-presets [data-ex]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.ex) === i);
    });
    document.getElementById('ex-min').value = String(p.min);
    this.preview();
  },

  preview() {
    const p = EX_PRESETS[this.sel || 0];
    const min = Number(document.getElementById('ex-min').value) || 0;
    const kcal = Calc.exerciseKcal(p.mets, Weight.current(), min);
    document.getElementById('ex-preview').textContent = `${p.type} ${min}分 = 約 ${kcal} kcal`;
  },

  async commit() {
    const p = EX_PRESETS[this.sel || 0];
    const min = Number(document.getElementById('ex-min').value);
    if (!min || min <= 0) { appAlert('時間(分)を入力してください'); return; }
    const d = this.date();
    const rec = await this.add(d, p, min);
    showToast(this.isToday()
      ? `${p.type} ${min}分(${rec.kcal}kcal)を記録しました`
      : `${Calc.fmtShort(d)} に ${p.type} ${min}分(${rec.kcal}kcal)を記録しました`);
    await this.renderToday();
  },

  /** 記録先の日の一覧(今日とはかぎらない) */
  async renderToday() {
    const d = this.date();
    const list = await this.byDate(d);
    const total = list.reduce((s, e) => s + e.kcal, 0);
    document.getElementById('ex-total').textContent =
      `${this.isToday() ? '今日' : Calc.fmtShort(d)}の運動 ${total} kcal`;
    const box = document.getElementById('ex-today');
    box.innerHTML = list.length
      ? '<ul class="diary-list">' + list.map((e) => `
          <li>
            <span class="dl-name">${escapeHtml(e.type)} <small>${e.minutes}分${e.auto ? ' · 自動' : ''}</small></span>
            <span class="dl-kcal">${e.kcal}</span>
            <button class="dl-del" data-del="${e.id}">×</button>
          </li>`).join('') + '</ul>'
      : '<p class="empty small">まだ記録がありません</p>';
    box.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.remove(b.dataset.del);
        await this.renderToday();
      });
    });
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Exercise, EX_PRESETS };
