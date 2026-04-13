const baseUrl = process.env.AI_VERIFY_BASE_URL || 'http://127.0.0.1:3002';

const toAsciiSafeJson = (value: unknown) =>
  JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

const intradayResponse = await fetch(`${baseUrl}/api/stock/intraday-comment/600519`);
const intradayJson = await intradayResponse.json();

console.log(
  toAsciiSafeJson({
    type: 'intraday',
    status: intradayResponse.status,
    success: intradayJson.success,
    hasComment: Boolean(intradayJson.comment),
    bias: intradayJson.comment?.bias ?? null,
    comment: intradayJson.comment?.comment ?? null,
    provider: intradayJson.comment?.providerLabel ?? null,
  }),
);

const analysisResponse = await fetch(`${baseUrl}/api/stock/analysis/event-refresh`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    code: '600519',
    force: true,
  }),
});
const analysisJson = await analysisResponse.json();

console.log(
  toAsciiSafeJson({
    type: 'event-refresh',
    status: analysisResponse.status,
    success: analysisJson.success,
    triggered: analysisJson.triggered,
    hasAnalysis: Boolean(analysisJson.analysis),
    recommendation: analysisJson.analysis?.recommendation ?? null,
    confidence: analysisJson.analysis?.confidence ?? null,
    quickComment: analysisJson.analysis?.intradayQuickComment ?? null,
    provider: analysisJson.analysis?.meta?.aiProviderLabel ?? null,
  }),
);
