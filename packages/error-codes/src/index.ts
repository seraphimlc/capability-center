export type ErrorDef = {
  http: number;
  message: string;
  retryable: boolean;
};

export const ErrorCodes = {
  OK: { http: 200, message: "成功", retryable: false },
  VALIDATION_ERROR: { http: 400, message: "参数不正确", retryable: false },
  UNAUTHORIZED: { http: 401, message: "请先登录", retryable: false },
  FORBIDDEN: { http: 403, message: "没有权限执行此操作", retryable: false },
  NOT_FOUND: { http: 404, message: "资源不存在或已下线", retryable: false },
  CONFLICT: { http: 409, message: "状态冲突，请刷新后重试", retryable: true },
  CONFLICT_VERSION: { http: 409, message: "内容已在其他端更新，请刷新", retryable: true },
  RATE_LIMITED: { http: 429, message: "操作过于频繁，请稍后再试", retryable: true },
  MAINTENANCE: { http: 503, message: "系统维护中，请稍后再试", retryable: true },
  INTERNAL_ERROR: { http: 500, message: "服务繁忙，请稍后重试", retryable: true },
  DEPENDENCY_TIMEOUT: { http: 504, message: "上游处理超时，请重试", retryable: true },
  CONTENT_BLOCKED: { http: 400, message: "内容未通过安全审核", retryable: false },
  FEATURE_DISABLED: { http: 403, message: "功能未启用", retryable: false },
  IMPERSONATE_READ_ONLY: { http: 403, message: "代查为只读，不能修改数据", retryable: false },

  AUTH_INVALID_CREDENTIALS: { http: 401, message: "账号或密码错误", retryable: false },
  AUTH_USER_DISABLED: { http: 403, message: "账号已禁用，请联系管理员", retryable: false },
  AUTH_TOKEN_EXPIRED: { http: 401, message: "登录已过期，请重新登录", retryable: false },
  AUTH_REFRESH_REUSED: { http: 401, message: "登录状态异常，请重新登录", retryable: false },
  AUTH_PASSWORD_WEAK: { http: 400, message: "密码强度不足", retryable: false },
  AUTH_EMAIL_TAKEN: { http: 409, message: "邮箱已被注册", retryable: false },
  AUTH_RESET_TOKEN_INVALID: { http: 400, message: "重置链接无效或已过期", retryable: false },

  TENANT_SUSPENDED: { http: 403, message: "所属组织已停用", retryable: false },

  TOOL_NOT_PUBLISHED: { http: 404, message: "能力不存在或已下线", retryable: false },
  SCHEMA_INVALID: { http: 400, message: "参数不符合要求", retryable: false },
  FAVORITE_LIMIT: { http: 400, message: "收藏数量已达上限", retryable: false },

  INVOKE_REJECTED: { http: 400, message: "调用被拒绝", retryable: false },
  INVOKE_CANCELLED: { http: 409, message: "调用已取消", retryable: false },
  INVOKE_RUNNING: { http: 409, message: "调用进行中", retryable: true },
  CONNECTOR_UNAVAILABLE: { http: 503, message: "能力暂时不可用，请稍后重试", retryable: true },
  UPSTREAM_ERROR: { http: 502, message: "能力执行失败，请稍后重试", retryable: true },
  TOOL_NOT_ALLOWED_IN_SESSION: { http: 403, message: "当前会话未启用该技能", retryable: false },
  TOOL_CONFIRM_REQUIRED: { http: 202, message: "需要确认后才能调用", retryable: false },
  TOOL_CONFIRM_REJECTED: { http: 200, message: "已拒绝本次调用", retryable: false },
  IDEMPOTENCY_CONFLICT: { http: 409, message: "重复请求冲突", retryable: false },

  INSUFFICIENT_CREDITS: { http: 402, message: "积分不足，请联系管理员充值", retryable: false },
  WALLET_FROZEN: { http: 403, message: "钱包已冻结", retryable: false },
  HOLD_NOT_FOUND: { http: 404, message: "预留不存在", retryable: false },
  HOLD_EXPIRED: { http: 409, message: "预留已过期", retryable: false },
  LEDGER_DUPLICATE: { http: 409, message: "流水已存在", retryable: false },
  ADJUSTMENT_NOT_ALLOWED: { http: 400, message: "无法调账", retryable: false },

  CONVERSATION_NOT_FOUND: { http: 404, message: "会话不存在", retryable: false },
  AGENT_NOT_PUBLISHED: { http: 404, message: "助手不存在或未发布", retryable: false },
  AGENT_NO_MODEL: { http: 503, message: "助手暂不可用（未配置模型）", retryable: true },
  STREAM_ABORTED: { http: 499, message: "生成已停止", retryable: false },
  MAX_TOOL_ROUNDS: { http: 400, message: "本轮工具调用次数已达上限", retryable: false },
  MESSAGE_EMPTY: { http: 400, message: "消息不能为空", retryable: false },

  MODEL_UNAVAILABLE: { http: 503, message: "模型暂时不可用", retryable: true },
  MODEL_DEGRADED: { http: 200, message: "已切换备用模型", retryable: false },
  MODEL_CAPABILITY_MISMATCH: { http: 400, message: "当前模型不支持该能力", retryable: false },

  OSS_NOT_CONFIGURED: { http: 503, message: "文件服务未配置", retryable: true },
  FILE_TOO_LARGE: { http: 400, message: "文件过大", retryable: false },
  FILE_MIME_NOT_ALLOWED: { http: 400, message: "不支持的文件类型", retryable: false },
  STORAGE_QUOTA_EXCEEDED: { http: 403, message: "存储空间不足", retryable: false },
  FILE_NOT_READY: { http: 409, message: "文件未上传完成", retryable: true },
  FILE_NOT_FOUND: { http: 404, message: "文件不存在", retryable: false },

  TASK_NOT_FOUND: { http: 404, message: "任务不存在", retryable: false },
  TASK_CANCEL_NOT_ALLOWED: { http: 400, message: "当前状态不可取消", retryable: false },
  TASK_FAILED: { http: 500, message: "任务执行失败", retryable: true },

  API_KEY_INVALID: { http: 401, message: "无效的访问密钥", retryable: false },
  API_KEY_EXPIRED: { http: 401, message: "访问密钥已过期", retryable: false },
  API_KEY_REVOKED: { http: 401, message: "访问密钥已吊销", retryable: false },
  API_KEY_IP_DENIED: { http: 403, message: "IP 未授权", retryable: false },
  API_KEY_SCOPE_DENIED: { http: 403, message: "权限范围不足", retryable: false },
  API_KEY_ENV_MISMATCH: { http: 403, message: "环境不匹配", retryable: false },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ErrorCodes;

export function errorDef(code: string): ErrorDef {
  const found = (ErrorCodes as Record<string, ErrorDef>)[code];
  return found ?? ErrorCodes.INTERNAL_ERROR;
}
