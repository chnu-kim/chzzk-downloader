// 설정과 앱 정보(§10 SettingsStore). §15-14에서는 받기 화면이 쓰는 만큼만: 불러오기, 패치, 최근 VOD.
// 저장 실패(`settings`)는 `saveError`에 두고 B2 배너가 §15-16에서 보여 준다.
import * as api from '../api';
import type { AppError, AppInfo, SettingsDto, SettingsPatch } from '../bindings';

export class SettingsStore {
  dto: SettingsDto | null = $state(null);
  info: AppInfo | null = $state(null);
  saveError: AppError | null = $state(null);

  /** 네이버 로그인 정보를 실제로 쓰고 있는가(오류 문구 분기, §9) */
  get cookiesEnabled(): boolean {
    return !!this.dto && this.dto.useNaverCookies && this.dto.naverCookiesSaved;
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

  /** 즉시 저장. 실패하면 던지지 않고 `saveError`에 둔다. */
  async patch(p: SettingsPatch): Promise<boolean> {
    try {
      this.dto = await api.updateSettings(p);
      this.saveError = null;
      return true;
    } catch (e) {
      this.saveError = e as AppError;
      return false;
    }
  }
}

export const settings = new SettingsStore();
