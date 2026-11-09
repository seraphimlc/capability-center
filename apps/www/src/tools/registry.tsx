import type { ToolFormDef } from './types';
import { TrademarkSimilarForm } from './trademark-similar/form';
import { TrademarkSimilarResult } from './trademark-similar/result';
import { TrademarkDetailForm } from './trademark-detail/form';
import { TrademarkDetailResult } from './trademark-detail/result';
import { TrademarkClassForm } from './trademark-class/form';
import { TrademarkClassResult } from './trademark-class/result';

/**
 * Dedicated forms, one per capability. This is intentionally a static map,
 * not a schema renderer: a capability without an entry has no user-facing form.
 */
export const TOOL_FORMS: Record<string, ToolFormDef> = {
  'trademark-similar-search': { Form: TrademarkSimilarForm, Result: TrademarkSimilarResult },
  'trademark-detail': { Form: TrademarkDetailForm, Result: TrademarkDetailResult },
  'trademark-nice-class': { Form: TrademarkClassForm, Result: TrademarkClassResult },
};

export function getToolForm(key: string): ToolFormDef | null {
  return TOOL_FORMS[key] ?? null;
}

export function hasToolForm(key: string): boolean {
  return Boolean(TOOL_FORMS[key]);
}
