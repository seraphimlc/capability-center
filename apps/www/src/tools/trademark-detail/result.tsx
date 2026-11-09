import { asRecord, clip, text } from '../data';
import { MarkTable } from '../mark-table';
import { EmptyResult, KeyValue, ResultNote } from '../ui';

export function TrademarkDetailResult({ value }: { value: unknown }) {
  const data = asRecord(asRecord(value).data);
  if (!Object.keys(data).length) {
    return <pre className="overflow-auto rounded-xl bg-ink p-3 text-xs text-paper">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (text(data.mode) === 'candidates') {
    const candidates = asRecord(data.candidates);
    return (
      <div className="space-y-3">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          只提供了名称，下面是候选列表。选中申请号后，用「按申请号 / 注册号」可以查完整详情。
        </p>
        <MarkTable records={candidates.records} />
        <ResultNote>结果来自公开商标数据，不构成法律意见。</ResultNote>
      </div>
    );
  }

  const detail = asRecord(data.detail);
  if (!Object.keys(detail).length) {
    return <EmptyResult>这次查询没有返回详情，请确认申请号或稍后重试。</EmptyResult>;
  }
  const classes = Array.isArray(detail.resultClassNum) ? detail.resultClassNum.map((item) => text(item)).filter(Boolean).join('、') : text(detail.resultClassNum);
  const image = text(detail.imageUrl || detail.ossImageUrl);
  const goods = Array.isArray(detail.remarkSmallCategory) ? detail.remarkSmallCategory.map((item) => text(item)).join('；') : text(detail.goodsAndServices);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xl font-medium">{text(detail.allSimilarRemark || detail.similarRemark) || '商标详情'}</p>
        <p className="mt-1 text-sm text-ink/55">
          申请号 {text(detail.remarkNumber) || '—'}
          {detail.registrationNumber ? ` · 注册号 ${text(detail.registrationNumber)}` : ''}
        </p>
        {image ? (
          <a className="mt-2 inline-block text-xs text-moss underline" href={image} target="_blank" rel="noreferrer">
            查看商标图样
          </a>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-white p-4">
        <KeyValue label="当前状态" value={detail.twoStatusNameNew || detail.oneStatusNameNew} />
        <KeyValue label="申请日期" value={detail.applyDate} />
        <KeyValue label="注册日期" value={detail.registrationDate} />
        <KeyValue label="尼斯分类" value={classes} />
        <KeyValue label="持有人" value={detail.ownerName} />
        <KeyValue label="律师 / 代理人" value={detail.attorneyName} />
        <KeyValue label="首次使用" value={detail.firstUseDate} />
        <KeyValue label="商业使用" value={detail.commerceUseDate} />
        <KeyValue label="状态说明" value={clip(detail.statusZhNew, 240)} wide />
        <KeyValue label="商品 / 服务" value={clip(goods, 400)} wide />
        <KeyValue label="商标描述" value={clip(detail.descriptionOfMark, 240)} wide />
      </dl>
      <ResultNote>结果来自公开商标数据，仅用于初步排查，不构成法律意见。</ResultNote>
    </div>
  );
}
