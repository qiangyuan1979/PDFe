import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

/**
 * 读取当前应用版本号（来自 tauri.conf.json 的 version，打包时同一值写入 MSIX 清单）。
 * 在非 Tauri 环境（如浏览器预览）读取失败时返回 null。
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return version;
}
