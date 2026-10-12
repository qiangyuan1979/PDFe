import { useEffect, useState } from "react";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import { getDocProperties, setDocProperties, refreshUndoRedo } from "../../lib/ipc";
import type { DocProperties } from "../../lib/ipc";

const FIELDS: { key: keyof DocProperties; labelKey: string }[] = [
  { key: "title", labelKey: "标题" },
  { key: "author", labelKey: "作者" },
  { key: "subject", labelKey: "主题" },
  { key: "keywords", labelKey: "关键词" },
  { key: "creator", labelKey: "创建者" },
  { key: "producer", labelKey: "生产者" },
];

const EMPTY: DocProperties = {
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
  producer: "",
};

export default function MetadataPanel() {
  const docId = useApp((s) => s.docId);
  const updatePages = useApp((s) => s.updatePages);
  const markDirty = useApp((s) => s.markDirty);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const t = useT();

  const [props, setProps] = useState<DocProperties>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProps(EMPTY);
    if (docId === null) return;
    let alive = true;
    getDocProperties(docId)
      .then((p) => {
        if (alive) setProps(p);
      })
      .catch((e) => {
        if (alive) errorToast(e);
      });
    return () => {
      alive = false;
    };
  }, [docId, errorToast]);

  const onChange = (key: keyof DocProperties, value: string) => {
    setProps((p) => ({ ...p, [key]: value }));
  };

  const onSave = async () => {
    if (docId === null) return;
    setBusy(true);
    try {
      const info = await setDocProperties(docId, props);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已更新文档属性"));
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  if (docId === null) {
    return (
      <div className="task-body">
        <p className="placeholder">{t("需先打开一个 PDF 文档")}</p>
      </div>
    );
  }

  return (
    <div className="task-body">
      <p className="placeholder">
        {t("编辑文档信息字典。留空的字段会在保存时从文档中移除。")}
      </p>

      {FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`meta-${f.key}`}>{t(f.labelKey)}</label>
          <input
            id={`meta-${f.key}`}
            type="text"
            value={props[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            disabled={busy}
          />
        </div>
      ))}

      <div className="task-footer">
        <button className="btn-primary" onClick={onSave} disabled={busy}>
          {busy ? t("保存中…") : t("保存属性")}
        </button>
      </div>
    </div>
  );
}
