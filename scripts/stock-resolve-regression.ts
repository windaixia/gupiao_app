const baseUrl = process.env.STOCK_TEST_BASE_URL || 'http://127.0.0.1:3002';

const cases = [
  { input: '贵州茅台', expectedCode: '600519.SS' },
  { input: '宁德时代', expectedCode: '300750.SZ' },
  { input: '东山精密', expectedCode: '002384.SZ' },
  { input: '京东方A', expectedCode: '000725.SZ' },
  { input: '紫金矿业', expectedCode: '601899.SS' },
  { input: '赛力斯', expectedCode: '601127.SS' },
];

const failures: string[] = [];

for (const item of cases) {
  try {
    const response = await fetch(`${baseUrl}/api/stock/${encodeURIComponent(item.input)}`);
    const data = await response.json();
    const actualCode = data?.stock?.code;

    if (!response.ok || actualCode !== item.expectedCode) {
      failures.push(`${item.input}: expected ${item.expectedCode}, got ${actualCode || `status ${response.status}`}`);
      continue;
    }

    console.log(`OK ${item.input} -> ${actualCode}`);
  } catch (error) {
    failures.push(`${item.input}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error('Stock resolve regression failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Resolved ${cases.length} stock names successfully.`);
