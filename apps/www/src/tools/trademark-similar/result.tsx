import { asRecord, text } from '../data';
import { MarkTable, recordTotal } from '../mark-table';
import { ResultNote } from '../ui';

export function TrademarkSimilarResult({ value }: { value: unknown }) {
  const data = asRecord(asRecord(value).data);
  const meta = recordTotal(data);
  const records = data.records;
  if (!Object.keys(data).length) {
    return <pre className="overflow-auto rounded-xl bg-ink p-3 text-xs text-paper">{JSON.stringify(value, null, 2)}</pre>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-ink px-2.5 py-1 text-paper">共 {meta.total} 条</span>
        <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">
          第 {meta.current || 1} / {meta.pages || 1} 页
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-line">本次返回 {Array.isArray(records) ? records.length : 0} 条</span>
        <span className="text-ink/45">查询：{text(asRecord(asRecord(value).query).keyword)}</span>
      </div>
      <MarkTable records={records} />
      <ResultNote>
        仅展示本次返回的记录，完整结果可在调用记录中查看。近似结果是按名称检索到的候选，不代表可以注册或不存在侵权风险，不构成法律意见。
      </ResultNote>
    </div>
  );
}
