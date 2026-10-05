// 설정과 앱 정보(§10 SettingsStore). 즉시 저장 방식이다(§8.7). 쿠키 값은 Rust로 보내기만 하고 다시 받지 않는다.
//
// 오류는 두 갈래다. 설정 파일을 쓰지 못한 것(`settings`)은 B2 배너(`saveError`)로 띄우고 [다시 시도]가
// 마지막 패치를 다시 보낸다. 그 밖(잘못된 입력 등)은 부른 쪽이 그 자리에 보이도록 돌려준다.
import * as api from '../api';
import type { AppError, AppInfo, LegacyImportDto, SettingsDto, SettingsPatch } from '../bindings';

export class SettingsStore {
  dto: SettingsDto | null = $state(null);
  info: AppInfo | null = $state(null);
  /** B2: 설정 파일을 쓰지 못했다(`code === 'settings'`) */
  saveError: AppError | null = $state(null);
  /** 저장이 실패할 때 올린다. 컨트롤을 저장된 값으로 되돌리는 `{#key}`에 쓴다 */
  revision = $state(0);
  /** 마지막 가져오기의 경고(평문 쿠키 등). 사라지면 안 되므로 토스트가 아니라 설정 화면에 남긴다(§7.2) */
  legacyWarnings: string[] = $state([]);
  /** 첫 실행 가져오기 후보(D3)를 이번 실행에서 처리했는가(가져오기·나중에) */
  legacyPromptDone = $state(false);
  #failedPatch: SettingsPatch | null = null;

  /** 네이버 로그인 정보를 실제로 쓰고 있는가(오류 문구 분기, §9) */
  get cookiesEnabled(): boolean {
    return !!this.dto && this.dto.useNaverCookies && this.dto.naverCookiesSaved;
  }

  /** D3를 띄울 첫 실행 후보 */
  get legacyCandidate() {
    return this.legacyPromptDone ? null : (this.info?.legacyCandidate ?? null);
  }

  async load(): Promise<void> {
    const [dto, info] = await Promise.allSettled([api.getSettings(), api.appInfo()]);
    if (dto.status === 'fulfilled') this.dto = dto.value;
    if (info.status === 'fulfilled') this.info = info.value;
  }

  async refresh(): Promise<void> {
    try {
      this.dto = await api.getSettings();
    } catch {
      // 다음 load에서 다시 받는다
    }
  }

  /**
   * 즉시 저장. 성공하면 `null`, 실패하면 그 오류를 돌려준다(던지지 않는다).
   * `settings`(파일을 못 씀)는 B2 배너에도 올리고, 저장된 값으로 컨트롤을 되돌린다.
   */
  async patch(p: SettingsPatch): Promise<AppError | null> {
    try {
      this.dto = await api.updateSettings(p);
      this.saveError = null;
      this.#failedPatch = null;
      return null;
    } catch (e) {
      const err = e as AppError;
      if (err.code === 'settings') {
        this.saveError = err;
        this.#failedPatch = p;
      }
      this.revision++;
      return err;
    }
  }

  /** B2 [다시 시도]: 실패한 패치를 다시 보낸다 */
  async retrySave(): Promise<void> {
    const p = this.#failedPatch;
    if (p) await this.patch(p);
    else this.saveError = null;
  }

  dismissSaveError() {
    this.saveError = null;
  }

  /** 쿠키 저장. 값은 돌려받지 않는다(`naverCookiesSaved`만 바뀐다) */
  async setCookies(nidAut: string, nidSes: string): Promise<AppError | null> {
    return this.#run(() => api.setNaverCookies(nidAut, nidSes));
  }

  async clearCookies(): Promise<AppError | null> {
    return this.#run(() => api.clearNaverCookies());
  }

  /**
   * 옛 설정 가져오기. `dir`이 `null`이면 첫 실행 후보(D3)를 적용한다. 찾지 못하면 `null`.
   * 경고는 `legacyWarnings`에 남기고 설정을 다시 읽는다(최근 VOD·폴더·쿠키 상태).
   */
  async importLegacy(dir: string | null): Promise<LegacyImportDto | null> {
    const r = await api.importLegacy(dir);
    if (dir === null) this.legacyPromptDone = true;
    if (r) {
      this.legacyWarnings = r.warnings;
      await this.refresh();
    }
    return r;
  }

  async #run(f: () => Promise<SettingsDto>): Promise<AppError | null> {
    try {
      this.dto = await f();
      return null;
    } catch (e) {
      this.revision++;
      return e as AppError;
    }
  }
}

export const settings = new SettingsStore();
