import { asArray, asRecord, clip, text } from './data';
import { StatusPill } from './ui';

export function MarkTable({ records }: { records: unknown }) {
  const rows = asArray(records).slice(0, 50);
  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink/50">没有查到候选记录。</p>;
  }
  return (
    <div className="overflow-auto rounded-xl border border-line">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-paper text-ink/55">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-medium">商标</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">申请号</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">申请日</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">状态</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">持有人</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">类别</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const classes = Array.isArray(row.resultClassNum) ? row.resultClassNum.map((item) => text(item)).filter(Boolean).join(', ') : text(row.resultClassNum);
            return (
              <tr key={`${text(row.remarkNumber)}-${index}`} className="border-t border-line/70 align-top odd:bg-white even:bg-paper/60">
                <td className="max-w-[12rem] px-3 py-2 font-medium">{clip(row.allSimilarRemark || row.similarRemark, 40)}</td>
                <td className="whitespace-nowrap px-3 py-2">{text(row.remarkNumber)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink/60">{text(row.applyDate)}</td>
                <td className="px-3 py-2">
                  <StatusPill value={row.twoStatusNameNew || row.oneStatusNameNew} />
                  {row.statusZhNew ? <span className="mt-1 block max-w-[16rem] text-[11px] leading-4 text-ink/45">{clip(row.statusZhNew, 90)}</span> : null}
                </td>
                <td className="max-w-[12rem] px-3 py-2 text-ink/70" title={text(row.ownerName)}>
                  {clip(row.ownerName, 36)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink/60">{classes || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function recordTotal(data: unknown): { total: number; pages: number; current: number; size: number } {
  const row = asRecord(data);
  return {
    total: Number(row.total) || 0,
    pages: Number(row.pages) || 0,
    current: Number(row.current) || 0,
    size: Number(row.size) || 0,
  };
}
