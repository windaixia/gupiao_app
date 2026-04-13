const baseUrl = process.env.CHART_VERIFY_BASE_URL || 'http://127.0.0.1:3002';

const response = await fetch(`${baseUrl}/api/stock/600519`);
const json = await response.json();

console.log(
  JSON.stringify(
    {
      status: response.status,
      success: json.success,
      historical: (json.stock?.historical || []).length,
      intraday1m: (json.stock?.intraday1m || []).length,
      intraday5m: (json.stock?.intraday5m || []).length,
      chartPreview: (json.stock?.historical || []).slice(0, 3),
    },
    null,
    2,
  ),
);
