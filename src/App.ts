/**
 * App 宿主：持有全局状态（设置、进度、音频、当前会话），负责路由与各视图切换。
 */

import { MorseAudio } from './core/audio.ts';
import { LESSONS, expandLesson, lessonById, type Lesson } from './core/lessons.ts';
import type { LessonItem } from './core/types.ts';
import { DEFAULT_SETTINGS, loadProgress, loadSettings, masteredChars, saveProgress, saveSettings, type AppSettings, type ProgressState } from './core/settings.ts';
import { PracticeEngine } from './core/practice.ts';
import { unsupportedChars } from './core/morse.ts';
import { toast } from './ui/dom.ts';

export type Tab = 'practice' | 'lessons' | 'stats' | 'settings' | 'help';

export interface View {
  render(root: HTMLElement): void;
  dispose?(): void;
}

export class App {
  settings: AppSettings;
  progress: ProgressState;
  audio: MorseAudio;
  engine: PracticeEngine | null = null;
  lesson: Lesson;
  itemIndex = 0;
  tab: Tab = 'practice';
  armed = false;
  private root!: HTMLElement;
  private currentView: View | null = null;
  private keyListeners = new Set<(ev: KeyboardEvent) => boolean>();

  constructor() {
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.audio = new MorseAudio({ toneHz: this.settings.toneHz, volume: this.settings.volume });
    this.lesson = lessonById(this.settings.lastLessonId) ?? LESSONS[0]!;
    this.itemIndex = Math.min(this.settings.lastItemIndex, Math.max(0, this.lesson.items.length - 1));
  }

  mount(root: HTMLElement): void {
    this.root = root;
    window.addEventListener('keydown', (ev) => {
      for (const fn of this.keyListeners) {
        if (fn(ev)) {
          ev.preventDefault();
          return;
        }
      }
    });
  }

  /** 注册全局快捷键，返回 true 表示已处理。 */
  onKey(fn: (ev: KeyboardEvent) => boolean): () => void {
    this.keyListeners.add(fn);
    return () => this.keyListeners.delete(fn);
  }

  saveSettings(patch: Partial<AppSettings> = {}): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.audio.setOptions({ toneHz: this.settings.toneHz, volume: this.settings.volume });
  }

  saveProgress(p: ProgressState): void {
    this.progress = p;
    saveProgress(p);
  }

  /** 当前课程展开后的条目（已替换呼号）。 */
  get items(): LessonItem[] {
    return expandLesson(this.lesson, this.settings.callsign);
  }

  get currentItem(): LessonItem {
    const items = this.items;
    return items[Math.min(this.itemIndex, items.length - 1)]!;
  }

  /** 开始一个条目：构造新的练习引擎。 */
  startEngine(itemIndex = this.itemIndex): PracticeEngine {
    this.itemIndex = itemIndex;
    this.saveSettings({ lastLessonId: this.lesson.id, lastItemIndex: itemIndex });
    const item = this.currentItem;
    const bad = unsupportedChars(item.text);
    if (bad.length) toast(`这些字符暂时没有码表：${bad.join(' ')}`, 'warn');
    const engine = new PracticeEngine({
      text: item.text,
      wpm: this.settings.wpm,
      knownChars: masteredChars(this.progress),
    });
    this.engine = engine;
    return engine;
  }

  setLesson(id: string, itemIndex = 0): void {
    const lesson = lessonById(id);
    if (!lesson) return;
    this.lesson = lesson;
    this.itemIndex = itemIndex;
    this.saveSettings({ lastLessonId: id, lastItemIndex: itemIndex });
  }

  /** 切换到某个 tab。 */
  go(tab: Tab): void {
    this.tab = tab;
    this.renderView();
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
  }

  /** 由外部（main.ts）设置视图工厂，避免循环依赖。 */
  viewFactory: ((tab: Tab, app: App) => View) | null = null;

  renderView(): void {
    this.currentView?.dispose?.();
    this.currentView = null;
    if (!this.viewFactory) return;
    const view = this.viewFactory(this.tab, this);
    this.currentView = view;
    this.root.innerHTML = '';
    view.render(this.root);
  }
}

export { DEFAULT_SETTINGS };
