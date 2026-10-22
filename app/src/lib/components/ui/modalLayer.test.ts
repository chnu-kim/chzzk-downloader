// 공용 모달 층(range-editor.md RE1, RE-3 시험 4): 층 스택 + "맨 위 층 말고 body의 모든 자식은 inert"를 매번 다시 계산한다.
// 저장값 복원 방식이면 층이 생긴 역순으로 닫히지 않을 때 앱 전체가 inert로 남는다. 그 순서를 여기서 고정한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modalLayer, modalLayerDepth } from './modalLayer';

let app: HTMLElement;

function layer(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  // 실제 층은 컴포넌트 안에서 만들어져 body 밖(.app 안)에서 시작한다
  app.append(el);
  return el;
}

const inertIds = () => [...document.body.children].filter((c) => c.hasAttribute('inert')).map((c) => c.id || c.className);

beforeEach(() => {
  app = document.createElement('div');
  app.className = 'app';
  document.body.append(app);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('modalLayer', () => {
  it('붙으면 body 직속으로 옮기고 다른 자식은 inert로 만든다', () => {
    const a = layer('a');
    const off = modalLayer(a);
    expect(a.parentElement).toBe(document.body);
    expect(app).toHaveAttribute('inert');
    expect(a).not.toHaveAttribute('inert');
    off();
    expect(a.isConnected).toBe(false);
    expect(app).not.toHaveAttribute('inert');
  });

  it('층이 쌓이면 맨 위 층만 살아 있고 아래 층은 inert다. 위 층이 닫히면 아래 층이 되살아난다', () => {
    const a = layer('a');
    const b = layer('b');
    const offA = modalLayer(a);
    const offB = modalLayer(b);
    expect(b).not.toHaveAttribute('inert');
    expect(a).toHaveAttribute('inert');
    expect(app).toHaveAttribute('inert');
    offB();
    expect(a).not.toHaveAttribute('inert');
    expect(app).toHaveAttribute('inert');
    offA();
    expect(app).not.toHaveAttribute('inert');
  });

  it('층이 생긴 역순으로 닫히지 않아도 앱이 inert로 남지 않는다(편집 화면 → 대화상자 → 카드가 사라져 편집 화면이 먼저 닫힘)', () => {
    const editor = layer('editor');
    const dialog = layer('dialog');
    const offEditor = modalLayer(editor);
    const offDialog = modalLayer(dialog);
    // 카드가 사라지며 편집 화면이 먼저 떨어진다. 대화상자는 아직 맨 위다
    offEditor();
    expect(dialog).not.toHaveAttribute('inert');
    expect(app).toHaveAttribute('inert');
    offDialog();
    expect(app).not.toHaveAttribute('inert');
    expect(inertIds()).toEqual([]);
  });

  it('층이 붙기 전부터 있던 inert는 되돌릴 때 그대로 남는다(앱이 단 inert가 아닌 것)', () => {
    const other = document.createElement('div');
    other.id = 'other';
    other.setAttribute('inert', '');
    document.body.append(other);
    const a = layer('a');
    const off = modalLayer(a);
    expect(other).toHaveAttribute('inert');
    off();
    expect(other).toHaveAttribute('inert');
    expect(app).not.toHaveAttribute('inert');
  });

  it('값이 있는 inert 속성도 원래 값으로 되돌린다', () => {
    app.setAttribute('inert', 'until-found');
    const a = layer('a');
    const off = modalLayer(a);
    expect(app).toHaveAttribute('inert', '');
    off();
    expect(app).toHaveAttribute('inert', 'until-found');
  });

  it('층이 떨어질 때 연 요소로 포커스를 돌린다(맨 위 층이 닫혀 포커스를 받을 수 있을 때)', () => {
    const opener = document.createElement('button');
    app.append(opener);
    opener.focus();
    const a = layer('a');
    a.tabIndex = -1;
    const off = modalLayer(a);
    a.focus();
    expect(document.activeElement).toBe(a); // 포커스가 층 안으로 옮겨 갔다
    off();
    expect(document.activeElement).toBe(opener);
  });

  it('연 요소가 사라졌으면 포커스를 옮기지 않고 returnFocus가 대신한다', () => {
    const opener = document.createElement('button');
    app.append(opener);
    opener.focus();
    const a = layer('a');
    let called = 0;
    const off = modalLayer(a, { returnFocus: () => (called += 1) });
    opener.remove();
    off();
    expect(called).toBe(1);
  });

  it('깊이를 알린다(Esc 같은 처리기가 자기 층이 맨 위인지 볼 수 있다)', () => {
    expect(modalLayerDepth()).toBe(0);
    const a = layer('a');
    const b = layer('b');
    const offA = modalLayer(a);
    expect(modalLayerDepth()).toBe(1);
    const offB = modalLayer(b);
    expect(modalLayerDepth()).toBe(2);
    offA();
    offB();
    expect(modalLayerDepth()).toBe(0);
  });

  it('같은 정리를 두 번 불러도 한 번만 한다', () => {
    const a = layer('a');
    const off = modalLayer(a);
    off();
    off();
    expect(modalLayerDepth()).toBe(0);
    expect(app).not.toHaveAttribute('inert');
  });

  it('층이 떨어질 때 그 사이 body에서 사라진 자식은 기억에서 지운다(오래된 항목이 다음 층을 어지럽히지 않는다)', () => {
    const a = layer('a');
    const offA = modalLayer(a);
    app.remove();
    offA();
    const fresh = document.createElement('div');
    fresh.className = 'app2';
    document.body.append(fresh);
    const b = layer('b2');
    document.body.append(b);
    const offB = modalLayer(b);
    expect(fresh).toHaveAttribute('inert');
    offB();
    expect(fresh).not.toHaveAttribute('inert');
  });
});
