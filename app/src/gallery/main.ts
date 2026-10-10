// 디자인 갤러리 진입점(docs/design/system/governance.md §2.6). CHZZK_GALLERY=1 빌드에만 들어간다(vite.config.ts).
// 앱과 같은 CSS 순서(토큰 → ui.css → app.css)를 싣고 IPC·Tauri를 쓰지 않는다.
import { mount } from 'svelte';
import '../styles/tokens.css';
import '../styles/ui.css';
import '../app.css';
import Gallery from './Gallery.svelte';

// release-hygiene가 릴리스 dist에서 찾는 표식(scripts/ci/artifact-check.mjs GALLERY_MARK). 조각을 이어 이 파일 밖에서는 안 걸린다
export const GALLERY_MARK = 'chzzk-' + 'design-gallery';
document.documentElement.dataset.gallery = GALLERY_MARK;

const target = document.getElementById('gallery');
if (!target) throw new Error('#gallery 요소가 없다');
mount(Gallery, { target });
