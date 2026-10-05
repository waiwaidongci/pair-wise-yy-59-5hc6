/**
 * 发布清单写入端：模拟一个只追加（append-only）的远端登记册。
 *
 * - 写入失败时拒绝追加、返回错误，调用方负责保留草稿；
 * - 重试时以同一批次号再调一次；
 * - 登记册侧对批次号幂等：同一批次号只追加一次。
 */
import { appendManifest } from './domain';
import type { ManifestRegisterEntry, ManifestSnapshot } from './types';

export type AppendResponse =
  | { ok: true; appended: boolean; entry: ManifestRegisterEntry }
  | { ok: false; error: string };

export type ManifestRepository = {
  append(manifest: ManifestSnapshot, opts?: { fail?: boolean }): Promise<AppendResponse>;
};

export function createManifestRepository(
  readRegister: () => ManifestRegisterEntry[],
  writeRegister: (next: ManifestRegisterEntry[]) => void,
  clock: () => string,
  options: { delayMs?: number } = {}
): ManifestRepository {
  const delay = options.delayMs ?? 400;
  return {
    async append(manifest, opts) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (opts?.fail) {
        return { ok: false, error: '写入失败：登记册暂时不可用，草稿已保留' };
      }
      const result = appendManifest(readRegister(), { manifest, at: clock() });
      if (!result.ok) return { ok: false, error: result.error };
      writeRegister(result.register);
      return { ok: true, appended: result.appended, entry: result.entry! };
    }
  };
}
