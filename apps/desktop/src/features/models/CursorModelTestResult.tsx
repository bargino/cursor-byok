import type { ModelConnectivityResult } from "../../shared/api";
import { Icon } from "../../shared/ui/Icon";
import { TooltipTrigger } from "../../shared/ui/TooltipTrigger";
import { informationOutlineIcon } from "../../shared/ui/icons";
import styles from "./CursorModelTestResult.module.scss";

export type CursorModelTestState = { prompt?: string } & (
  | { status: "success"; result: ModelConnectivityResult }
  | { status: "error"; error: string }
  | { status: "cancelled" }
);

export function CursorModelTestResult({ state, testing = false, compact = false }: {
  state?: CursorModelTestState;
  testing?: boolean;
  /** 列表行内的紧凑徽标形态:未测试时不渲染,详情放入悬浮提示。 */
  compact?: boolean;
}) {
  if (testing) {
    return compact
      ? <span className={`${styles.compact} ${styles.testing}`}>{t("测试中…")}</span>
      : <div className={`${styles.root} ${styles.testing}`}><span className={styles.summary}>{t("测试中…")}</span></div>;
  }
  if (!state) {
    return compact ? null : <div className={`${styles.root} ${styles.idle}`}><span className={styles.summary}>{t("未测试")}</span></div>;
  }
  if (state.status === "cancelled") {
    return compact
      ? <span className={`${styles.compact} ${styles.idle}`}>{t("测试已取消")}</span>
      : <div className={`${styles.root} ${styles.idle}`}><span className={styles.summary}>{t("测试已取消")}</span></div>;
  }

  const success = state.status === "success";
  const labels = success ? successLabels(state.result) : {
    summary: t("错误：{error}", { error: state.error }),
    badge: t("测试失败"),
    detail: t("测试失败：{error}", { error: state.error }),
  };

  if (compact) {
    return <TooltipTrigger label={labels.detail}>
      <span className={`${styles.compact} ${success ? styles.success : styles.error}`}>
        {labels.badge}
        <Icon icon={informationOutlineIcon} size="1em" />
      </span>
    </TooltipTrigger>;
  }

  return <div className={`${styles.root} ${success ? styles.success : styles.error}`}>
    <span className={styles.summary}>{labels.summary}</span>
    <TooltipTrigger label={labels.detail}><button type="button" className={styles.details}>{t("查看详情")}<Icon icon={informationOutlineIcon} size="1.1em" /></button></TooltipTrigger>
  </div>;
}

function successLabels(result: ModelConnectivityResult) {
  if (result.kind === "image") {
    return {
      summary: t("图片已生成"),
      badge: t("图片已生成"),
      detail: t("图片已生成，耗时 {duration} ms", { duration: result.duration_ms }),
    };
  }
  const speed = Number.isFinite(result.tokens_per_second) ? result.tokens_per_second.toFixed(1) : "0.0";
  return {
    summary: t("速度：{speed} tokens/s", { speed }),
    badge: `${speed} tokens/s`,
    detail: t("速度 {speed} tokens/s · 首字 {firstText} ms · 总耗时 {duration} ms · 输出 {tokens} tokens{estimated} · 返回：{output}", {
      speed,
      firstText: result.first_valid_response_ms ?? "--",
      duration: result.duration_ms,
      tokens: result.output_tokens,
      estimated: result.tokens_estimated ? t("（估算）") : "",
      output: result.output || "--",
    }),
  };
}
