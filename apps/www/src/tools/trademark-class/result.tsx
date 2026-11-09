import { asRecord, clip, text } from '../data';
import { EmptyResult, ResultNote } from '../ui';

export function TrademarkClassResult({ value }: { value: unknown }) {
  const root = asRecord(value);
  const data = asRecord(root.data);
  if (!Object.keys(data).length) {
    return <pre className="overflow-auto rounded-xl bg-ink p-3 text-xs text-paper">{JSON.stringify(value, null, 2)}</pre>;
  }
  const selected = text(data.selectedCategoryNumber);
  const categories = Array.isArray(data.categories) ? data.categories.map((item) => asRecord(item)) : [];
  const category = categories.find((item) => text(item.categoryNum) === selected);
  const sub = asRecord(data.subcategories);
  const records = Array.isArray(sub.records) ? sub.records.map((item) => asRecord(item)) : [];
  const meta = { total: Number(sub.total) || 0, pages: Number(sub.pages) || 0, current: Number(sub.current) || 0 };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-4 ring-1 ring-line">
        <p className="text-xs text-ink/50">当前分类</p>
        <p className="mt-1 text-xl font-medium">
          {selected ? `${selected} 类` : '匹配结果'}
          {category ? <span className="ml-2 text-base text-ink/70">{clip(category.categoryName, 20)}</span> : null}
        </p>
        {text(category?.tradeMarkCateGorytotal) ? (
          <p className="mt-1 text-xs text-ink/50">该类在美国的商标记录约 {text(category?.tradeMarkCateGorytotal)} 条</p>
        ) : null}
      </div>

      {records.length ? (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-paper text-ink/55">
              <tr>
                <th className="px-3 py-2 font-medium">小类项目</th>
                <th className="px-3 py-2 font-medium">所属大类</th>
                <th className="px-3 py-2 font-medium">类别号</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 50).map((row, index) => (
                <tr key={`${text(row.id)}-${index}`} className="border-t border-line/70 align-top odd:bg-white even:bg-paper/60">
                  <td className="max-w-[22rem] px-3 py-2">{clip(row.categoryNameEn || row.categoryName, 90)}</td>
                  <td className="px-3 py-2 text-ink/65">{text(row.parentCategoryNumName)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink/55">{text(row.parentCategoryNum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyResult>这个分类下没有返回小类项目，换个分类号或关键词试试。</EmptyResult>
      )}

      <p className="text-xs text-ink/45">
        共 {meta.total} 个小类 · 第 {meta.current || 1} / {meta.pages || 1} 页
      </p>
      <ResultNote>分类结果仅作参考，正式申请前建议由代理机构复核。</ResultNote>
    </div>
  );
}
