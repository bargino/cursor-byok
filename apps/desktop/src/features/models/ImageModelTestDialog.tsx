import { useState } from "react";
import { FormField, TextInput } from "../../shared/ui/FormControls";
import { Modal } from "../../shared/ui/Modal";
import type { CursorModelTestState } from "./CursorModelTestResult";
import styles from "./CursorModelTestResult.module.scss";

export function ImageModelTestDialog({ name, state, testing, onTest, onCancel, onClose }: {
  name: string;
  state?: CursorModelTestState;
  testing: boolean;
  onTest: (prompt: string) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(() => state?.prompt ?? t("白色背景上的一个红苹果。"));
  const image = !testing && state?.status === "success" && state.result.kind === "image" ? state.result : null;
  return <Modal open title={t("生图测试：{model}", { model: name })}
    closeLabel={t("关闭")} onClose={onClose}
    submitLabel={testing ? t("取消测试") : t("生成测试图片")}
    submitDisabled={!testing && !prompt.trim()}
    onSubmit={testing ? onCancel : () => onTest(prompt.trim())}
  >
    <div className={styles.imageTest}>
      <FormField label={t("测试提示词")}>
        <TextInput value={prompt} disabled={testing} onChange={(event) => setPrompt(event.target.value)} />
      </FormField>
      <div aria-live="polite">
        {testing && t("正在生成测试图片…")}
        {!testing && state?.status === "cancelled" && t("测试已取消")}
        {!testing && state?.status === "error" && <span className={styles.imageError}>{t("测试失败：{error}", { error: state.error })}</span>}
        {image && <figure className={styles.imagePreview}>
          <figcaption>{t("图片已生成，耗时 {duration} ms", { duration: image.duration_ms })}</figcaption>
          <img src={`data:${image.mime_type};base64,${image.data_base64}`} alt={t("测试生成的图片")} />
        </figure>}
      </div>
    </div>
  </Modal>;
}
