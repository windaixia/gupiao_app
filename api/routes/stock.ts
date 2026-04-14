import { Router, type Request, type Response } from 'express';
import https from 'node:https';
import { supabase } from '../utils/supabase.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import YahooFinance from 'yahoo-finance2';
import { ensureAiAccess, ensureWatchlistAccess, getAiQuotaSummary } from '../utils/billing.js';

dotenv.config();

const router = Router();
const yahooFinance = new YahooFinance();
const resolvedAiProvider = (process.env.AI_PROVIDER || (process.env.MINIMAX_API_KEY ? 'minimax' : 'openrouter')).trim().toLowerCase();
const resolvedAiApiKey =
  (resolvedAiProvider === 'minimax'
    ? process.env.MINIMAX_API_KEY
    : process.env.OPEN_ROUTER_API_KEY || process.env.OPENAI_API_KEY) || '';
const resolvedAiBaseUrl =
  (resolvedAiProvider === 'minimax'
    ? process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1'
    : process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  ).trim();
const resolvedAiModel =
  (resolvedAiProvider === 'minimax'
    ? process.env.MINIMAX_MODEL || process.env.AI_MODEL || 'M2-her'
    : process.env.OPENROUTER_MODEL || process.env.AI_MODEL || 'google/gemini-2.5-pro'
  ).trim();
const openai = new OpenAI({
  baseURL: resolvedAiBaseUrl,
  apiKey: resolvedAiApiKey || 'dummy_key_to_prevent_crash',
  defaultHeaders:
    resolvedAiProvider === 'openrouter'
      ? {
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'AI StockPro',
        }
      : undefined,
});
const isPlaceholderAiKey = (value: string) =>
  !value ||
  ['dummy_key_to_prevent_crash', 'dummy', 'test', 'placeholder', 'your_key_here', 'changeme', 'sk-xxx'].includes(value.toLowerCase());

const isLikelyAiAuthError = (error: unknown) => {
  const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined;
  const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string | number }).code : undefined;
  const message =
    typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '');

  return (
    status === 401 ||
    code === 401 ||
    /missing authentication header|invalid api key|unauthorized|authentication/i.test(message)
  );
};

let aiCapabilityDisabled = isPlaceholderAiKey(resolvedAiApiKey);

const canUseAi = () => !aiCapabilityDisabled;

const disableAiCapability = (error?: unknown) => {
  if (error && !isLikelyAiAuthError(error)) {
    return;
  }
  aiCapabilityDisabled = true;
};

const getAiProviderLabel = (provider: string) => {
  if (provider === 'minimax') return 'MiniMax';
  if (provider === 'openrouter') return 'OpenRouter';
  return 'Fallback';
};

const parseAiJsonContent = (content: string) => {
  const normalized = content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!normalized) {
    throw new Error('AI response content is empty');
  }

  try {
    return JSON.parse(normalized);
  } catch {
    const objectMatch = normalized.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      throw new Error('AI response does not contain JSON object');
    }
    return JSON.parse(objectMatch[0]);
  }
};

const normalizeStockCode = (code: string) => {
  const queryCode = code.toUpperCase();
  if (/^6\d{5}$/.test(queryCode)) return `${queryCode}.SS`;
  if (/^(0|3)\d{5}$/.test(queryCode)) return `${queryCode}.SZ`;
  return queryCode;
};

let ashareUniverseCache: { updatedAt: number; items: Array<{ code: string; name: string }> } | null = null;
const resolvedStockInputCache = new Map<string, { updatedAt: number; code: string }>();
const resolvedStockNameCache = new Map<string, string>();
const stockSnapshotCache = new Map<string, { updatedAt: number; snapshot: any }>();
const stockSnapshotInflight = new Map<string, Promise<any>>();
const stockCompanyProfileCache = new Map<string, { updatedAt: number; profile: any }>();
const stockOperationsMetricsCache = new Map<string, { updatedAt: number; metrics: any }>();
const stockFinancialReportCache = new Map<string, { updatedAt: number; reports: any[] }>();
const RESOLVED_INPUT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_CACHE_TTL_MS = 15 * 1000;
const SNAPSHOT_STALE_TTL_MS = 5 * 60 * 1000;
const COMPANY_PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const OPERATIONS_METRICS_CACHE_TTL_MS = 30 * 60 * 1000;
const FINANCIAL_REPORT_CACHE_TTL_MS = 60 * 60 * 1000;
const STOCK_NAME_ALIASES: Record<string, string> = {
  '贵州茅台': '600519.SS',
  '茅台': '600519.SS',
  '宁德时代': '300750.SZ',
  '平安银行': '000001.SZ',
  '中国平安': '601318.SS',
  '比亚迪': '002594.SZ',
  '招商银行': '600036.SS',
  '五粮液': '000858.SZ',
  '东方财富': '300059.SZ',
  '隆基绿能': '601012.SS',
  '中信证券': '600030.SS',
  '格力电器': '000651.SZ',
  '美的集团': '000333.SZ',
  '海康威视': '002415.SZ',
  '迈瑞医疗': '300760.SZ',
  '药明康德': '603259.SS',
  '中芯国际': '688981.SS',
  '工业富联': '601138.SS',
  '长江电力': '600900.SS',
  '兴业银行': '601166.SS',
  '东山精密': '002384.SZ',
  '立讯精密': '002475.SZ',
  '歌尔股份': '002241.SZ',
  '京东方A': '000725.SZ',
  '京东方': '000725.SZ',
  '紫金矿业': '601899.SS',
  '赛力斯': '601127.SS',
};

const isDirectSymbolInput = (value: string) =>
  /^([603]\d{5}|688\d{3}|[48]\d{5})(\.(SS|SZ|BJ))?$/i.test(value) ||
  /^[A-Z0-9._-]{1,20}$/.test(value);

const isAshareSymbol = (symbol?: string) => !!symbol && /(\.SS|\.SZ|\.BJ)$/i.test(symbol);

const EASTMONEY_UT = 'fa5fd1943c7b386f172d6893dbfba10b';

const toSecid = (code: string) => {
  const normalizedCode = normalizeStockCode(code);
  const plainCode = extractPlainCode(normalizedCode);

  if (normalizedCode.endsWith('.SS')) return `1.${plainCode}`;
  return `0.${plainCode}`;
};

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveRedirectUrl = (currentUrl: string, location: string) => {
  if (!location) return currentUrl;
  if (location.startsWith('//')) {
    const current = new URL(currentUrl);
    return `${current.protocol}${location}`;
  }
  return new URL(location, currentUrl).toString();
};

const fetchEastmoneyBufferOnce = async (url: string, timeoutMs = 10000, redirectCount = 0) =>
  new Promise<Buffer>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
      (response) => {
        const location = response.headers.location;
        if (
          location &&
          response.statusCode &&
          [301, 302, 303, 307, 308].includes(response.statusCode)
        ) {
          if (redirectCount >= 3) {
            reject(new Error(`Too many Eastmoney redirects for ${url}`));
            response.resume();
            return;
          }

          response.resume();
          fetchEastmoneyBufferOnce(resolveRedirectUrl(url, location), timeoutMs, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Failed to fetch Eastmoney data: ${response.statusCode || 'unknown'}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      },
    );

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Eastmoney request timeout'));
    });
  });

const fetchEastmoneyJson = async (url: string, options?: { retries?: number; timeoutMs?: number }) => {
  const retries = options?.retries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 10000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const body = await fetchEastmoneyBufferOnce(url, timeoutMs + attempt * 2500);
      const text = body.toString('utf8');
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(300 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch Eastmoney data');
};

const fetchEastmoneySuggest = async (input: string) => {
  const payload: any = await fetchEastmoneyJson(
    `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
      input,
    )}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`,
    { retries: 1, timeoutMs: 8000 },
  );

  return (payload?.QuotationCodeTable?.Data || [])
    .filter((item: any) => item?.Code)
    .map((item: any) => ({
      code: normalizeStockCode(String(item.Code)),
      name: String(item.Name || '').trim(),
      pinyin: String(item.PinYin || '').trim().toUpperCase(),
    }));
};

const fetchHttpBufferOnce = async (
  url: string,
  headers: Record<string, string>,
  timeoutMs = 3000,
  redirectCount = 0,
) =>
  new Promise<Buffer>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers,
      },
      (response) => {
        const location = response.headers.location;
        if (
          location &&
          response.statusCode &&
          [301, 302, 303, 307, 308].includes(response.statusCode)
        ) {
          if (redirectCount >= 3) {
            reject(new Error(`Too many redirects for ${url}`));
            response.resume();
            return;
          }

          response.resume();
          fetchHttpBufferOnce(resolveRedirectUrl(url, location), headers, timeoutMs, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Failed to fetch remote data: ${response.statusCode || 'unknown'}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      },
    );

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Remote quote request timeout'));
    });
  });

const findStockNameByCode = (code: string) => {
  const normalized = normalizeStockCode(code);
  const cachedResolvedName = resolvedStockNameCache.get(normalized);
  if (cachedResolvedName) return cachedResolvedName;

  const cachedUniverseName = ashareUniverseCache?.items?.find((item) => item.code === normalized)?.name;
  if (cachedUniverseName) return cachedUniverseName;

  const aliasEntry = Object.entries(STOCK_NAME_ALIASES).find(([, value]) => value === normalized);
  return aliasEntry?.[0] || normalized;
};

const toSinaSymbol = (code: string) => {
  const normalized = normalizeStockCode(code);
  const plainCode = extractPlainCode(normalized);
  if (normalized.endsWith('.SS')) return `sh${plainCode}`;
  if (normalized.endsWith('.SZ')) return `sz${plainCode}`;
  if (normalized.endsWith('.BJ')) return `bj${plainCode}`;
  return plainCode;
};

const fetchSinaBasicQuote = async (code: string) => {
  const symbol = toSinaSymbol(code);
  const body = await fetchHttpBufferOnce(
    `https://hq.sinajs.cn/list=${symbol}`,
    {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://finance.sina.com.cn/',
    },
    2500,
  );
  const text = body.toString('latin1');
  const matched = text.match(/var hq_str_[^=]+="([^"]*)"/);
  const parts = matched?.[1]?.split(',') || [];

  if (parts.length < 10) {
    throw new Error(`Failed to parse Sina quote for ${code}`);
  }

  return {
    source: 'sina',
    shortName: findStockNameByCode(code),
    regularMarketOpen: toNumberOrNull(parts[1]),
    regularMarketPreviousClose: toNumberOrNull(parts[2]),
    regularMarketPrice: toNumberOrNull(parts[3]),
    regularMarketDayHigh: toNumberOrNull(parts[4]),
    regularMarketDayLow: toNumberOrNull(parts[5]),
    regularMarketVolume: toNumberOrNull(parts[8]),
    amount: toNumberOrNull(parts[9]),
  };
};

const toTencentSymbol = (code: string) => {
  const normalized = normalizeStockCode(code);
  const plainCode = extractPlainCode(normalized);
  if (normalized.endsWith('.SS')) return `sh${plainCode}`;
  if (normalized.endsWith('.SZ')) return `sz${plainCode}`;
  if (normalized.endsWith('.BJ')) return `bj${plainCode}`;
  return plainCode;
};

const toEastmoneyCompanyCode = (code: string) => {
  const normalized = normalizeStockCode(code);
  const plainCode = extractPlainCode(normalized);
  if (normalized.endsWith('.SS')) return `SH${plainCode}`;
  if (normalized.endsWith('.SZ')) return `SZ${plainCode}`;
  if (normalized.endsWith('.BJ')) return `BJ${plainCode}`;
  return plainCode;
};

const cleanAshareText = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '--' || normalized === '暂无' || normalized === '暂无数据' || normalized === 'N/A') {
    return null;
  }
  return normalized;
};

const fetchEastmoneyCompanyProfile = async (code: string) => {
  const normalized = normalizeStockCode(code);
  const cached = stockCompanyProfileCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < COMPANY_PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  try {
    const body = await fetchHttpBufferOnce(
      `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${toEastmoneyCompanyCode(normalized)}`,
      {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://f10.eastmoney.com/',
      },
      4000,
    );
    const payload = JSON.parse(body.toString('utf8'));
    const basic = payload?.jbzl || {};
    const profile = {
      industryName: cleanAshareText(basic.sshy) || cleanAshareText(basic.sszjhhy),
      regionName: cleanAshareText(basic.qy),
      companySummary: cleanAshareText(basic.gsjj),
      businessScope: cleanAshareText(basic.jyfw),
    };

    stockCompanyProfileCache.set(normalized, {
      updatedAt: Date.now(),
      profile,
    });

    return profile;
  } catch {
    if (cached?.profile) {
      return cached.profile;
    }
    return null;
  }
};

const fetchEastmoneyOperationsMetrics = async (code: string) => {
  const normalized = normalizeStockCode(code);
  const cached = stockOperationsMetricsCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < OPERATIONS_METRICS_CACHE_TTL_MS) {
    return cached.metrics;
  }

  try {
    const response = await fetch(
      `https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=${toEastmoneyCompanyCode(normalized)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://f10.eastmoney.com/',
        },
        signal: AbortSignal.timeout(4500),
      },
    );
    if (!response.ok) {
      throw new Error(`OperationsRequired request failed: ${response.status}`);
    }
    const payload = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
    const zxzb = Array.isArray(payload?.zxzb) ? payload.zxzb[0] : payload?.zxzb;
    const zxzbOther = Array.isArray(payload?.zxzbOther) ? payload.zxzbOther[0] : payload?.zxzbOther;
    const metrics = {
      peRatio: toNumberOrNull(zxzbOther?.PE_TTM) ?? toNumberOrNull(zxzbOther?.PE_DYNAMIC) ?? toNumberOrNull(zxzbOther?.PE_STATIC),
      eps: toNumberOrNull(zxzb?.EPSJB) ?? toNumberOrNull(zxzb?.EPSJB_PL),
      priceToBook: toNumberOrNull(zxzbOther?.PB_NEW_NOTICE) ?? toNumberOrNull(zxzbOther?.PB_MRQ_REALTIME),
      bookValuePerShare: toNumberOrNull(zxzb?.MGJZC),
    };

    stockOperationsMetricsCache.set(normalized, {
      updatedAt: Date.now(),
      metrics,
    });

    return metrics;
  } catch {
    if (cached?.metrics) {
      return cached.metrics;
    }
    return null;
  }
};

const fetchEastmoneyFinancialReportRows = async (code: string) => {
  const normalized = normalizeStockCode(code);
  const cached = stockFinancialReportCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < FINANCIAL_REPORT_CACHE_TTL_MS) {
    return cached.reports;
  }

  try {
    const response = await fetch(
      `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${toEastmoneyCompanyCode(normalized)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://f10.eastmoney.com/',
        },
        signal: AbortSignal.timeout(4500),
      },
    );
    if (!response.ok) {
      throw new Error(`Financial report request failed: ${response.status}`);
    }
    const payload = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
    const reports = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((item: any) => item && item.REPORT_DATE_NAME)
      .slice(0, 8);

    stockFinancialReportCache.set(normalized, {
      updatedAt: Date.now(),
      reports,
    });

    return reports;
  } catch {
    if (cached?.reports) {
      return cached.reports;
    }
    return [];
  }
};

const fetchTencentDailySeries = async (code: string) => {
  const symbol = toTencentSymbol(code);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 430 * 24 * 60 * 60 * 1000);
  const formatDate = (value: Date) => value.toISOString().slice(0, 10);
  const body = await fetchHttpBufferOnce(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${formatDate(startDate)},${formatDate(endDate)},260,qfq`,
    {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://gu.qq.com/',
    },
    4000,
  );
  const payload = JSON.parse(body.toString('utf8'));
  const series = payload?.data?.[symbol]?.qfqday || payload?.data?.[symbol]?.day || [];

  return (series as string[][])
    .filter((item) => Array.isArray(item) && item.length >= 6)
    .map((item) => {
      const open = Number(item[1]);
      const close = Number(item[2]);
      const high = Number(item[3]);
      const low = Number(item[4]);
      const volume = Number(item[5]);
      const previousClose = close;

      return {
        date: item[0],
        open,
        high,
        low,
        close,
        volume,
        amount: null,
        amplitude: null,
        changePercent: previousClose ? null : null,
        changeAmount: null,
      };
    });
};

const fetchTencentIntradaySeries = async (code: string) => {
  const symbol = toTencentSymbol(code);
  const body = await fetchHttpBufferOnce(
    `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`,
    {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://gu.qq.com/',
    },
    4000,
  );
  const payload = JSON.parse(body.toString('utf8'));
  const rows = payload?.data?.[symbol]?.data?.data || [];

  return (rows as string[])
    .map((row) => {
      const [timeText, priceText, volumeText] = row.trim().split(/\s+/);
      const price = toNumberOrNull(priceText);
      if (!timeText || price == null) return null;

      const normalizedTime = `${timeText.slice(0, 2)}:${timeText.slice(2, 4)}`;
      return {
        time: normalizedTime,
        price: Number(price.toFixed(2)),
        volume: (toNumberOrNull(volumeText) ?? 0) * 100,
        open: Number(price.toFixed(2)),
        high: Number(price.toFixed(2)),
        low: Number(price.toFixed(2)),
      };
    })
    .filter(Boolean) as Array<{ time: string; price: number; volume: number; open: number; high: number; low: number }>;
};

const buildSyntheticDailySeries = (currentPrice: number, previousClose: number) => {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const safePreviousClose = previousClose || currentPrice || 0;
  const safeCurrentPrice = currentPrice || safePreviousClose;

  return [
    {
      date: yesterday.toISOString().slice(0, 10),
      open: safePreviousClose,
      high: safePreviousClose,
      low: safePreviousClose,
      close: safePreviousClose,
      volume: 0,
      amount: null,
      amplitude: null,
      changePercent: null,
      changeAmount: null,
    },
    {
      date: today.toISOString().slice(0, 10),
      open: safePreviousClose,
      high: Math.max(safeCurrentPrice, safePreviousClose),
      low: Math.min(safeCurrentPrice, safePreviousClose),
      close: safeCurrentPrice,
      volume: 0,
      amount: null,
      amplitude: null,
      changePercent: safePreviousClose ? Number((((safeCurrentPrice - safePreviousClose) / safePreviousClose) * 100).toFixed(2)) : null,
      changeAmount: Number((safeCurrentPrice - safePreviousClose).toFixed(2)),
    },
  ];
};

const fetchAshareUniverse = async () => {
  const now = Date.now();
  if (ashareUniverseCache && now - ashareUniverseCache.updatedAt < 12 * 60 * 60 * 1000) {
    return ashareUniverseCache.items;
  }

  const baseUrl =
    'https://82.push2.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:13,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14';
  try {
    const firstPage: any = await fetchEastmoneyJson(`${baseUrl}&pn=1`, { retries: 2, timeoutMs: 12000 });
    const total = Number(firstPage?.data?.total || 0);
    const pages = Math.max(Math.ceil(total / 100), 1);
    const allDiff = [...(firstPage?.data?.diff || [])];

    for (let page = 2; page <= pages; page += 1) {
      const payload: any = await fetchEastmoneyJson(`${baseUrl}&pn=${page}`, { retries: 1, timeoutMs: 12000 });
      allDiff.push(...(payload?.data?.diff || []));
    }

    const items = allDiff
      .map((item: any) => ({
        code: normalizeStockCode(String(item.f12)),
        name: String(item.f14 || '').trim(),
      }))
      .filter((item) => item.code && item.name);

    ashareUniverseCache = {
      updatedAt: now,
      items,
    };

    return items;
  } catch (error) {
    if (ashareUniverseCache?.items?.length) {
      return ashareUniverseCache.items;
    }
    throw error;
  }
};

const resolveStockInput = async (rawInput: string) => {
  const input = rawInput.trim();
  if (!input) {
    throw new Error('Stock input is empty');
  }

  const cacheKey = input.replace(/\s+/g, '').toUpperCase();
  const cachedResolved = resolvedStockInputCache.get(cacheKey);
  if (cachedResolved && Date.now() - cachedResolved.updatedAt < RESOLVED_INPUT_CACHE_TTL_MS) {
    return cachedResolved.code;
  }

  if (isDirectSymbolInput(input)) {
    const normalized = normalizeStockCode(input);
    resolvedStockInputCache.set(cacheKey, { updatedAt: Date.now(), code: normalized });
    return normalized;
  }

  const normalizedInput = input.replace(/\s+/g, '');

  if (STOCK_NAME_ALIASES[normalizedInput]) {
    const aliased = STOCK_NAME_ALIASES[normalizedInput];
    resolvedStockNameCache.set(aliased, normalizedInput);
    resolvedStockInputCache.set(cacheKey, { updatedAt: Date.now(), code: aliased });
    return aliased;
  }

  try {
    const universe = await fetchAshareUniverse();
    const matched =
      universe.find((item) => item.code === normalizeStockCode(input)) ||
      universe.find((item) => item.name.replace(/\s+/g, '') === normalizedInput) ||
      universe.find((item) => item.name.replace(/\s+/g, '').includes(normalizedInput));

    if (matched?.code) {
      if (matched.name) {
        resolvedStockNameCache.set(matched.code, matched.name);
      }
      resolvedStockInputCache.set(cacheKey, { updatedAt: Date.now(), code: matched.code });
      return matched.code;
    }
  } catch (error) {
    console.error('A-share resolve fallback error:', error);
  }

  try {
    const suggestionInput = input.replace(/\s+/g, '');
    const suggestions = await fetchEastmoneySuggest(suggestionInput);
    const suggestionMatch =
      suggestions.find((item: any) => item.code === normalizeStockCode(input)) ||
      suggestions.find((item: any) => item.name.replace(/\s+/g, '') === normalizedInput) ||
      suggestions.find((item: any) => item.pinyin === normalizedInput.toUpperCase()) ||
      suggestions.find((item: any) => item.pinyin.includes(normalizedInput.toUpperCase()));

    if (suggestionMatch?.code) {
      if (suggestionMatch.name) {
        resolvedStockNameCache.set(suggestionMatch.code, suggestionMatch.name);
      }
      resolvedStockInputCache.set(cacheKey, { updatedAt: Date.now(), code: suggestionMatch.code });
      return suggestionMatch.code;
    }
  } catch (error) {
    console.error('Eastmoney suggest fallback error:', error);
  }

  try {
    const searchResult: any = await yahooFinance.search(input, {
      quotesCount: 10,
      newsCount: 0,
      enableFuzzyQuery: true,
    });

    const quotes = (searchResult?.quotes || []).filter((item: any) => isAshareSymbol(item.symbol));
    const exactMatch =
      quotes.find((item: any) => item.symbol?.toUpperCase() === normalizeStockCode(input)) ||
      quotes.find((item: any) => (item.shortname || item.longname || '').replace(/\s+/g, '') === normalizedInput) ||
      quotes.find((item: any) => {
        const name = String(item.shortname || item.longname || '').replace(/\s+/g, '');
        return name.includes(normalizedInput) || normalizedInput.includes(name);
      });

    if (exactMatch?.symbol) {
      const normalized = normalizeStockCode(exactMatch.symbol);
      const yahooName = String(exactMatch.shortname || exactMatch.longname || '').trim();
      if (yahooName) {
        resolvedStockNameCache.set(normalized, yahooName);
      }
      resolvedStockInputCache.set(cacheKey, { updatedAt: Date.now(), code: normalized });
      return normalized;
    }
  } catch {
    // Yahoo search is best-effort only and may be blocked in some regions.
  }

  throw new Error(`Unable to resolve stock input: ${rawInput}`);
};

const extractPlainCode = (code: string) => code.split('.')[0];

const getBoardMeta = (code: string) => {
  const plainCode = extractPlainCode(code);

  if (/^(300|301)\d{3}$/.test(plainCode)) {
    return { boardName: '创业板', limitPercent: 0.2 };
  }
  if (/^688\d{3}$/.test(plainCode)) {
    return { boardName: '科创板', limitPercent: 0.2 };
  }
  if (/^[48]\d{5}$/.test(plainCode)) {
    return { boardName: '北交所', limitPercent: 0.3 };
  }

  return { boardName: '主板', limitPercent: 0.1 };
};

const getMarketStateLabel = (marketState?: string) => {
  switch (marketState) {
    case 'PRE':
    case 'PREPRE':
      return '盘前';
    case 'BREAK':
      return '午间休市';
    case 'REGULAR':
      return '交易中';
    case 'POST':
    case 'POSTPOST':
      return '盘后';
    case 'CLOSED':
      return '已收盘';
    default:
      return '未知状态';
  }
};

const getAshareMarketState = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');
  const totalMinutes = hour * 60 + minute;

  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'CLOSED';
  }
  if (totalMinutes < 9 * 60 + 15) {
    return 'PRE';
  }
  if (totalMinutes < 11 * 60 + 30) {
    return 'REGULAR';
  }
  if (totalMinutes < 13 * 60) {
    return 'BREAK';
  }
  if (totalMinutes < 15 * 60) {
    return 'REGULAR';
  }
  return 'CLOSED';
};

const parseEastmoneyTrendPoints = (trends: string[] = []) =>
  trends
    .map((row) => {
      const [datetime, open, priceText, high, low, volume] = row.split(',');
      const price = toNumberOrNull(priceText) ?? toNumberOrNull(open);

      if (!datetime || price == null) {
        return null;
      }

      return {
        time: datetime.slice(11, 16),
        price: Number(price.toFixed(2)),
        volume: (toNumberOrNull(volume) ?? 0) * 100,
        open: toNumberOrNull(open),
        high: toNumberOrNull(high),
        low: toNumberOrNull(low),
      };
    })
    .filter(Boolean) as Array<{
    time: string;
    price: number;
    volume: number;
    open: number | null;
    high: number | null;
    low: number | null;
  }>;

const aggregateIntradayPoints = (points: Array<{ time: string; price: number; volume: number }>, chunkSize: number) => {
  const aggregated: Array<{ time: string; price: number; volume: number }> = [];

  for (let index = 0; index < points.length; index += chunkSize) {
    const chunk = points.slice(index, index + chunkSize);
    const lastPoint = chunk[chunk.length - 1];

    if (!lastPoint) continue;

    aggregated.push({
      time: lastPoint.time,
      price: Number(lastPoint.price.toFixed(2)),
      volume: chunk.reduce((sum, item) => sum + item.volume, 0),
    });
  }

  return aggregated;
};

const parseEastmoneyKlines = (klines: string[] = []) =>
  klines
    .map((row) => {
      const [date, open, close, high, low, volume, amount, amplitude, changePercent, changeAmount] = row.split(',');
      const closePrice = toNumberOrNull(close);

      if (!date || closePrice == null) {
        return null;
      }

      return {
        date,
        open: toNumberOrNull(open),
        close: closePrice,
        high: toNumberOrNull(high),
        low: toNumberOrNull(low),
        volume: (toNumberOrNull(volume) ?? 0) * 100,
        amount: toNumberOrNull(amount),
        amplitude: toNumberOrNull(amplitude),
        changePercent: toNumberOrNull(changePercent),
        changeAmount: toNumberOrNull(changeAmount),
      };
    })
    .filter(Boolean) as Array<{
    date: string;
    open: number | null;
    close: number;
    high: number | null;
    low: number | null;
    volume: number;
    amount: number | null;
    amplitude: number | null;
    changePercent: number | null;
    changeAmount: number | null;
  }>;

const BACKTEST_PERIODS = [1, 3, 5, 20] as const;

const PEER_GROUPS: Record<string, string[]> = {
  '600519.SS': ['000858.SZ', '000596.SZ', '603589.SS'],
  '300750.SZ': ['002594.SZ', '300014.SZ', '688223.SS'],
  '601318.SS': ['600036.SS', '601166.SS', '600030.SS'],
  '600036.SS': ['601166.SS', '000001.SZ', '601318.SS'],
  '300059.SZ': ['600030.SS', '601318.SS', '600036.SS'],
  '002594.SZ': ['300750.SZ', '601633.SS', '603596.SS'],
  '601012.SS': ['300274.SZ', '600438.SS', '002129.SZ'],
  '688981.SS': ['603986.SS', '300223.SZ', '002371.SZ'],
};

const getUniqueCodes = (codes: string[]) => [...new Set(codes.map((item) => normalizeStockCode(item)))];

const toDateKey = (value: string | Date) => new Date(value).toISOString().slice(0, 10);

const overlapCount = (left: string[] = [], right: string[] = []) => {
  const rightSet = new Set(right.filter(Boolean));
  return left.filter((item) => rightSet.has(item)).length;
};

const buildPortfolioAdviceFallback = (snapshot: any, portfolioContext?: any) => {
  const exposurePercent = portfolioContext?.exposurePercent ?? 0;
  const alreadyHeld = (portfolioContext?.topPositions || []).some((item: any) => item.stockCode === snapshot.code);

  if (!portfolioContext) {
    return {
      fit: '中',
      role: '观察标的',
      suggestedAction: snapshot.quote.regularMarketChangePercent >= 0 ? '小仓跟踪' : '等待确认',
      targetAllocation: '单票 5%-8%',
      reasoning: ['当前未检测到组合持仓信息', '建议先以试探仓位验证判断', '避免在单一标的上过度集中'],
      riskControl: ['单票仓位不超过总资产 10%', '跌破关键支撑位后及时减仓', '与现有高波动持仓避免同向叠加'],
    };
  }

  return {
    fit: exposurePercent > 70 ? '中' : '高',
    role: alreadyHeld ? '已有持仓优化' : '卫星仓位',
    suggestedAction: alreadyHeld ? '结合原持仓成本滚动管理' : snapshot.quote.regularMarketChangePercent >= 0 ? '分批建仓' : '先观察后介入',
    targetAllocation: alreadyHeld ? '维持或调整至单票 8%-15%' : exposurePercent > 70 ? '新增仓位控制在 3%-5%' : '新增仓位控制在 5%-8%',
    reasoning: [
      alreadyHeld ? '组合中已存在该标的，重点在于优化持仓节奏。' : '该标的更适合作为组合中的补充仓位。',
      exposurePercent > 70 ? '当前组合权益仓位较高，新增风险资产需更谨慎。' : '当前组合仍有一定仓位腾挪空间。',
      snapshot.quote.regularMarketChangePercent >= 0 ? '价格动能偏强，适合分批验证。' : '短线仍有分歧，优先等待确认信号。',
    ],
    riskControl: ['结合已有持仓相关性控制行业集中度', '单次加仓后预留足够现金应对波动', '若触发预警或事件扰动，优先重新评估而非机械加仓'],
  };
};

const buildEvidenceChain = (snapshot: any, enrichment: any, peerComparison: any[] = [], eventSignals?: any) => {
  const evidence = [
    {
      title: '行情与波动结构',
      sourceType: 'market',
      stance: snapshot.quote.regularMarketChangePercent >= 0 ? '偏多' : '偏空',
      relevance: 'high',
      summary: `最新价 ${snapshot.quote.regularMarketPrice}，涨跌幅 ${snapshot.quote.regularMarketChangePercent}% ，距离涨停 ${snapshot.distanceToUpperLimit ?? '--'} 元。`,
    },
    ...(enrichment.newsItems || []).slice(0, 2).map((item: any) => ({
      title: item.title,
      sourceType: 'news',
      stance: '中性',
      relevance: 'medium',
      summary: `${item.source || '新闻源'}：${item.summary || item.title}`,
    })),
    ...(enrichment.filingsDigest || []).slice(0, 2).map((item: any) => ({
      title: item.title,
      sourceType: 'filing',
      stance: '中性',
      relevance: 'high',
      summary: item.summary || '公告/财报存在新的信息增量。',
    })),
    ...(enrichment.financialHighlights || []).slice(0, 2).map((item: string) => ({
      title: '财务亮点',
      sourceType: 'financial',
      stance: '中性',
      relevance: 'medium',
      summary: item,
    })),
    ...(peerComparison || []).slice(0, 1).map((peer) => ({
      title: `横向对比：${peer.name}`,
      sourceType: 'peer',
      stance: peer.relativeStrength >= 0 ? '偏多' : '偏空',
      relevance: 'medium',
      summary: `${peer.name} 近端表现 ${peer.changePercent}% ，相对强弱 ${peer.relativeStrength >= 0 ? '+' : ''}${peer.relativeStrength}%。`,
    })),
  ];

  if (eventSignals?.signals?.length) {
    evidence.push({
      title: '事件触发信号',
      sourceType: 'event',
      stance: eventSignals.shouldRerun ? '偏多' : '中性',
      relevance: 'high',
      summary: eventSignals.signals.slice(0, 2).map((item: any) => item.title).join('；'),
    });
  }

  return evidence.slice(0, 8);
};

const findBacktestTarget = (dailySeries: any[], analysisDate: string, period: number) => {
  if (!dailySeries.length) return null;

  const analysisDateKey = toDateKey(analysisDate);
  const baseIndex = dailySeries.findIndex((item) => item.date >= analysisDateKey);
  const startIndex = baseIndex === -1 ? dailySeries.length - 1 : baseIndex;
  const target = dailySeries[startIndex + period];
  return target?.close ?? null;
};

const buildPeriodBacktests = (recommendation: string, priceAtAnalysis: number | null, analysisDate: string, dailySeries: any[]) => {
  const periodEntries = BACKTEST_PERIODS.map((period) => {
    const targetPrice = priceAtAnalysis ? findBacktestTarget(dailySeries, analysisDate, period) : null;

    if (!priceAtAnalysis || typeof targetPrice !== 'number') {
      return [`${period}d`, { period, price: null, changePercent: null, isHit: null }] as const;
    }

    const { isHit, changePercent } = evaluateRecommendationHit(recommendation, priceAtAnalysis, targetPrice);
    return [
      `${period}d`,
      {
        period,
        price: Number(targetPrice.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        isHit,
      },
    ] as const;
  });

  return Object.fromEntries(periodEntries);
};

const summarizePeriodBacktests = (rows: any[]) =>
  Object.fromEntries(
    BACKTEST_PERIODS.map((period) => {
      const key = `${period}d`;
      const evaluable = rows.filter((row) => row.periodBacktests?.[key]?.isHit !== null);
      const hitCount = evaluable.filter((row) => row.periodBacktests?.[key]?.isHit).length;
      const avgReturn =
        evaluable.length > 0
          ? Number(
              (
                evaluable.reduce((sum, row) => sum + (row.periodBacktests?.[key]?.changePercent || 0), 0) / evaluable.length
              ).toFixed(2),
            )
          : 0;

      return [
        key,
        {
          period,
          evaluated: evaluable.length,
          hitRate: evaluable.length ? Number(((hitCount / evaluable.length) * 100).toFixed(2)) : 0,
          avgReturn,
        },
      ] as const;
    }),
  );

const fetchPortfolioContext = async (userId?: string) => {
  if (!userId) return null;

  const [{ data: portfolio }, { data: positions }] = await Promise.all([
    supabase.from('portfolios').select('balance, total_value').eq('user_id', userId).single(),
    supabase
      .from('positions')
      .select('stock_code, stock_name, quantity, average_price')
      .eq('user_id', userId)
      .gt('quantity', 0),
  ]);

  if (!portfolio) return null;

  const positionRows = positions || [];
  const costSum = positionRows.reduce((sum, item) => sum + Number(item.average_price) * Number(item.quantity), 0);

  return {
    balance: Number(portfolio.balance || 0),
    totalValue: Number(portfolio.total_value || portfolio.balance || 0),
    exposurePercent:
      portfolio.total_value && Number(portfolio.total_value) > 0 ? Number(((costSum / Number(portfolio.total_value)) * 100).toFixed(2)) : 0,
    positionCount: positionRows.length,
    topPositions: positionRows
      .map((item) => ({
        stockCode: item.stock_code,
        stockName: item.stock_name,
        quantity: item.quantity,
        averagePrice: Number(item.average_price),
        weightPercent: costSum > 0 ? Number((((Number(item.average_price) * Number(item.quantity)) / costSum) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.weightPercent - a.weightPercent)
      .slice(0, 5),
  };
};

const fetchPeerComparison = async (code: string, snapshot: any) => {
  const directPeers = PEER_GROUPS[code] || [];
  const fallbackPeers = getUniqueCodes([
    ...Object.values(STOCK_NAME_ALIASES),
    ...Object.values(PEER_GROUPS).flat(),
  ]).filter((item) => item !== code);
  const peerCodes = getUniqueCodes([...directPeers, ...fallbackPeers]);

  const peers = await Promise.all(
    peerCodes.map(async (peerCode) => {
      try {
        const peerSnapshot = await fetchStockSnapshot(peerCode);
        const conceptOverlap = overlapCount(snapshot.conceptTags, peerSnapshot.conceptTags);
        const sameIndustry =
          Boolean(snapshot.industryName) && Boolean(peerSnapshot.industryName) && snapshot.industryName === peerSnapshot.industryName;
        const sameBoard = peerSnapshot.boardName === snapshot.boardName;

        return {
          code: peerSnapshot.code,
          name: peerSnapshot.quote.shortName || peerSnapshot.code,
          boardName: peerSnapshot.boardName,
          industryName: peerSnapshot.industryName || null,
          comparisonGroupLabel: peerSnapshot.industryName || peerSnapshot.boardName,
          price: peerSnapshot.quote.regularMarketPrice,
          changePercent: peerSnapshot.quote.regularMarketChangePercent,
          marketCap: peerSnapshot.quote.marketCap,
          peRatio: peerSnapshot.quote.trailingPE ?? null,
          conceptOverlap,
          sameIndustry,
          sameBoard,
          isDirectPeer: directPeers.includes(peerCode),
          score:
            (directPeers.includes(peerCode) ? 5 : 0) +
            (sameIndustry ? 4 : 0) +
            (conceptOverlap > 0 ? Math.min(conceptOverlap, 2) : 0) +
            (sameBoard ? 1 : 0),
          relativeStrength: Number(
            ((peerSnapshot.quote.regularMarketChangePercent || 0) - (snapshot.quote.regularMarketChangePercent || 0)).toFixed(2),
          ),
        };
      } catch {
        return null;
      }
    }),
  );

  const validPeers = peers.filter(Boolean) as any[];
  const prioritizedPeers = validPeers
    .filter((peer) =>
      snapshot.industryName
        ? peer.sameIndustry || peer.isDirectPeer
        : peer.isDirectPeer || peer.sameBoard,
    )
    .sort((a, b) => b.score - a.score || Math.abs((a.relativeStrength || 0)) - Math.abs((b.relativeStrength || 0)))
    .slice(0, 4);

  return prioritizedPeers;
};

const fetchLatestAnalysisReference = async (userId: string | undefined, code: string) => {
  if (!userId) return null;

  const { data: history } = await supabase
    .from('analysis_history')
    .select('id, analysis_date, analysis_type')
    .eq('user_id', userId)
    .eq('stock_code', normalizeStockCode(code))
    .order('analysis_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!history) return null;

  const { data: result } = await supabase
    .from('analysis_results')
    .select('result_data, confidence_score')
    .eq('history_id', history.id)
    .maybeSingle();

  return {
    analysisDate: history.analysis_date,
    analysisType: history.analysis_type,
    recommendation: result?.result_data?.recommendation || null,
    confidence: result?.confidence_score ?? result?.result_data?.confidence ?? null,
    thesis: result?.result_data?.thesis || null,
  };
};

const buildEventSignals = (snapshot: any, enrichment: any, latestAnalysis?: any) => {
  const signals = [];
  const absChange = Math.abs(snapshot.quote.regularMarketChangePercent || 0);
  const lastIntraday = snapshot.intraday1m?.slice(-15) || [];
  const startPrice = lastIntraday[0]?.price ?? snapshot.quote.regularMarketPreviousClose ?? snapshot.quote.regularMarketPrice;
  const endPrice = lastIntraday[lastIntraday.length - 1]?.price ?? snapshot.quote.regularMarketPrice;
  const intradayMove = startPrice ? Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2)) : 0;

  if (absChange >= 3) {
    signals.push({ type: 'price_move', title: '价格波动显著', detail: `当日涨跌幅达到 ${snapshot.quote.regularMarketChangePercent}%` });
  }
  if (Math.abs(intradayMove) >= 1.5) {
    signals.push({ type: 'intraday_shift', title: '分时结构发生明显变化', detail: `近 15 个分时点波动 ${intradayMove}%` });
  }
  if ((enrichment.newsItems || []).length > 0) {
    signals.push({ type: 'news', title: '存在新的新闻增量', detail: `检测到 ${(enrichment.newsItems || []).length} 条相关新闻线索` });
  }
  if ((enrichment.filingsDigest || []).length > 0) {
    signals.push({ type: 'filing', title: '存在新的公告/财报线索', detail: `检测到 ${(enrichment.filingsDigest || []).length} 条公告或文件摘要` });
  }
  if (snapshot.distanceToUpperLimit != null && snapshot.distanceToUpperLimit < 1.5) {
    signals.push({ type: 'limit_up_near', title: '接近涨停价', detail: `距离涨停仅 ${snapshot.distanceToUpperLimit} 元` });
  }
  if (snapshot.distanceToLowerLimit != null && snapshot.distanceToLowerLimit < 1.5) {
    signals.push({ type: 'limit_down_near', title: '接近跌停价', detail: `距离跌停仅 ${snapshot.distanceToLowerLimit} 元` });
  }
  if (latestAnalysis?.analysisDate) {
    const hoursSinceLast = Number(((Date.now() - new Date(latestAnalysis.analysisDate).getTime()) / 3600000).toFixed(1));
    if (hoursSinceLast >= 24) {
      signals.push({ type: 'stale_analysis', title: '上次分析已过期', detail: `距离上次分析已过去 ${hoursSinceLast} 小时` });
    }
  }

  return {
    shouldRerun: signals.length >= 2,
    score: signals.length,
    signals,
    lastCheckedAt: new Date().toISOString(),
  };
};

const buildFallbackAnalysis = (quote: any) => ({
  technical: {
    trend: quote.regularMarketChange >= 0 ? '震荡偏强' : '震荡偏弱',
    support: Number((quote.regularMarketPrice * 0.97).toFixed(2)),
    resistance: Number((quote.regularMarketPrice * 1.03).toFixed(2)),
    summary: '当前技术面以短线趋势跟踪为主，建议结合分时走势和成交量变化观察。',
  },
  fundamental: {
    peRatio: quote.trailingPE || '暂无',
    eps: quote.epsTrailingTwelveMonths || '暂无',
    revenueGrowth: '待结合财报更新',
    summary: '基本面需结合最新财报、行业景气度与政策环境综合判断。',
  },
  sentiment: {
    newsScore: 72,
    socialScore: 68,
    summary: '市场情绪中性偏积极，需持续关注消息面与板块联动。',
  },
  thesis: quote.regularMarketChange >= 0 ? '短线偏强，但不宜脱离风险控制追高。' : '当前分歧较大，建议等待更清晰的确认信号。',
  reasoning: {
    whyNow: '价格、分时和板块联动给出了初步研判，但仍需结合消息面与财报验证。',
    bullishFactors: ['分时走势具备一定承接', '价格仍处于可观察区间', '板块联动未明显走弱'],
    riskFactors: ['消息面扰动仍可能放大波动', '若跌破关键支撑位，短线风险增加', '成交量若不能持续放大，则趋势延续性有限'],
    actionPlan: '优先轻仓试错或耐心等待回踩确认，不建议在无量拉升时追价。',
  },
  catalysts: ['后续财报披露', '行业政策变化', '板块情绪回暖'],
  risks: ['市场整体风险偏好回落', '业绩不及预期', '板块轮动导致资金分流'],
  scenario: {
    bullCase: '若量价共振并站稳关键阻力，上行空间有望进一步打开。',
    baseCase: '大概率维持区间震荡，等待新的基本面或消息催化。',
    bearCase: '若跌破支撑且放量走弱，短线可能进入回撤阶段。',
  },
  newsDigest: [],
  filingsDigest: [],
  financialHighlights: [
    `当前价格：${quote.regularMarketPrice ?? '暂无'}`,
    `市盈率：${quote.trailingPE ?? '暂无'}`,
    `每股收益：${quote.epsTrailingTwelveMonths ?? '暂无'}`,
  ],
  intradayQuickComment: quote.regularMarketChange >= 0 ? '盘中偏强，短线情绪略占优。' : '盘中偏弱，需警惕资金承接不足。',
  recommendation: quote.regularMarketChange >= 0 ? '持有' : '观望',
  riskLevel: 3,
  confidence: 0.78,
  evidenceChain: [],
  peerComparison: [],
  comparisonGroupLabel: null,
  portfolioAdvice: null,
  eventSignals: null,
});

const isMeaningfulDisplayValue = (value: any) => {
  if (value == null) return false;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return false;
    if (/^(暂无|暂无数据|--|n\/a|待补充|未知)$/i.test(normalized)) return false;
  }
  return true;
};

const isPositiveMetric = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const pickDisplayValue = (...values: any[]) => {
  for (const value of values) {
    if (!isMeaningfulDisplayValue(value)) continue;
    return value;
  }
  return '暂无';
};

const formatLargeNumberCN = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '暂无';
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return value.toFixed(2);
};

const formatSignedPercent = (value?: number | null, digits = 2) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
};

const fetchEastmoneyFilingsDigest = async (code: string, stockName: string) => {
  try {
    const plainCode = extractPlainCode(code);
    const body = await fetchHttpBufferOnce(
      `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=4&page_index=1&ann_type=A&stock_list=${plainCode}`,
      {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://data.eastmoney.com/',
      },
      3500,
    );
    const payload = JSON.parse(body.toString('utf8'));
    const filings = payload?.data?.list || [];

    return filings.slice(0, 4).map((item: any) => {
      const date = item.notice_date || item.display_time || null;
      return {
        title: `${stockName} 公告更新`,
        date,
        summary: `${stockName} 于 ${date ? new Date(date).toLocaleDateString('zh-CN') : '近期'} 披露公告，建议关注正式公告原文与关键信息变化。`,
      };
    });
  } catch {
    return [];
  }
};

const buildLocalFundamentalView = (snapshot: any, enrichment: any) => {
  const { quote } = snapshot;
  const summarySegments = [
    snapshot.industryName ? `所属行业为 ${snapshot.industryName}` : null,
    snapshot.regionName ? `地域为 ${snapshot.regionName}` : null,
    snapshot.conceptTags?.length ? `核心概念包括 ${snapshot.conceptTags.slice(0, 3).join('、')}` : null,
    quote.priceToBook ? `当前市净率约 ${quote.priceToBook}` : null,
    quote.marketCap ? `总市值约 ${formatLargeNumberCN(quote.marketCap)}` : null,
    enrichment?.companySummary ? truncateText(enrichment.companySummary, 100) : null,
  ].filter(Boolean);

  return {
    peRatio: pickDisplayValue(quote.trailingPE, enrichment?.fundamentalSnapshot?.peRatio),
    eps: pickDisplayValue(quote.epsTrailingTwelveMonths, enrichment?.fundamentalSnapshot?.eps),
    revenueGrowth: pickDisplayValue(enrichment?.earningsGrowth, quote.priceToBook ? `市净率 ${quote.priceToBook}` : null),
    summary: summarySegments.length > 0 ? `${summarySegments.join('，')}。` : '当前已补齐估值、行业与概念等基础面信息，后续可继续叠加财报增速数据。',
  };
};

const buildLocalSentimentView = (snapshot: any, enrichment: any, peerComparison: any[] = [], eventSignals?: any) => {
  const filingsCount = (enrichment?.filingsDigest || []).length;
  const newsCount = (enrichment?.newsItems || []).length;
  const conceptBoost = Math.min((snapshot.conceptTags?.length || 0) * 2, 10);
  const peerBoost = peerComparison.length > 0 ? (peerComparison[0].relativeStrength >= 0 ? 6 : -4) : 0;
  const intradayDelta = snapshot.intraday1m?.length
    ? ((snapshot.intraday1m[snapshot.intraday1m.length - 1]?.price ?? snapshot.quote.regularMarketPrice) -
        (snapshot.intraday1m[0]?.price ?? snapshot.quote.regularMarketPreviousClose ?? snapshot.quote.regularMarketPrice))
    : 0;
  const intradayBias = snapshot.quote.regularMarketPreviousClose
    ? (intradayDelta / snapshot.quote.regularMarketPreviousClose) * 100
    : 0;

  const newsScore = Math.max(
    20,
    Math.min(
      95,
      Math.round(48 + newsCount * 8 + filingsCount * 6 + conceptBoost + (snapshot.quote.regularMarketChangePercent >= 0 ? 5 : -3)),
    ),
  );
  const socialScore = Math.max(
    20,
    Math.min(
      95,
      Math.round(45 + Math.min(Math.abs(intradayBias) * 6, 14) + peerBoost + ((eventSignals?.signals?.length || 0) * 4)),
    ),
  );

  const summarySegments = [
    snapshot.boardName ? `${snapshot.boardName} 当前活跃度${snapshot.quote.regularMarketChangePercent >= 0 ? '偏强' : '偏弱'}` : null,
    peerComparison.length > 0 ? `同组可比标的数量 ${peerComparison.length}` : null,
    snapshot.distanceToUpperLimit != null ? `距离涨停 ${snapshot.distanceToUpperLimit} 元` : null,
    filingsCount > 0 ? `近期存在 ${filingsCount} 条公告线索` : null,
  ].filter(Boolean);

  return {
    newsScore,
    socialScore,
    summary: summarySegments.length > 0 ? `${summarySegments.join('，')}。` : '当前市场面以价格动量、板块位置和事件信号综合评估。',
  };
};

const buildLocalReportAnalysis = (snapshot: any, reportRows: any[] = []) => {
  const latest = reportRows[0];
  if (!latest) return null;

  const revenue = toNumberOrNull(latest.TOTALOPERATEREVE);
  const revenueYoY = toNumberOrNull(latest.TOTALOPERATEREVETZ);
  const revenueQoQ = toNumberOrNull(latest.YYZSRGDHBZC);
  const profit = toNumberOrNull(latest.PARENTNETPROFIT);
  const profitYoY = toNumberOrNull(latest.PARENTNETPROFITTZ);
  const profitQoQ = toNumberOrNull(latest.NETPROFITRPHBZC);
  const eps = toNumberOrNull(latest.EPSJB);
  const epsYoY = toNumberOrNull(latest.EPSJBTZ);
  const grossMargin = toNumberOrNull(latest.XSMLL);
  const roe = toNumberOrNull(latest.ROEJQ);
  const debtRatio = toNumberOrNull(latest.ZCFZL);
  const operatingCashRatioRaw = toNumberOrNull(latest.JYXJLYYSR);
  const operatingCashRatio =
    typeof operatingCashRatioRaw === 'number' && Number.isFinite(operatingCashRatioRaw)
      ? Number((operatingCashRatioRaw * 100).toFixed(2))
      : null;
  const previous = reportRows[1];
  const previousGrossMargin = toNumberOrNull(previous?.XSMLL);
  const grossMarginChange =
    typeof grossMargin === 'number' && typeof previousGrossMargin === 'number'
      ? Number((grossMargin - previousGrossMargin).toFixed(2))
      : null;

  const highlights = [
    typeof revenueYoY === 'number' && revenueYoY > 8 ? `最新${latest.REPORT_DATE_NAME}营收同比增长 ${formatSignedPercent(revenueYoY)}，收入仍保持扩张。`
      : null,
    typeof profitYoY === 'number' && profitYoY > 8 ? `归母净利润同比增长 ${formatSignedPercent(profitYoY)}，盈利能力继续改善。`
      : null,
    typeof epsYoY === 'number' && epsYoY > 5 ? `每股收益同比提升 ${formatSignedPercent(epsYoY)}，股东回报指标改善。`
      : null,
    typeof operatingCashRatio === 'number' && operatingCashRatio >= 10 ? `经营现金流/营收约 ${operatingCashRatio.toFixed(2)}%，现金回笼质量尚可。`
      : null,
    typeof roe === 'number' && roe >= 12 ? `加权净资产收益率约 ${roe.toFixed(2)}%，资本回报处于较好水平。`
      : null,
  ].filter(Boolean) as string[];

  const risks = [
    typeof revenueYoY === 'number' && revenueYoY < 0 ? `营收同比 ${formatSignedPercent(revenueYoY)}，收入端出现放缓或回落。`
      : null,
    typeof profitYoY === 'number' && profitYoY < 0 ? `归母净利润同比 ${formatSignedPercent(profitYoY)}，盈利承压。`
      : null,
    typeof profitQoQ === 'number' && profitQoQ < -10 ? `利润环比 ${formatSignedPercent(profitQoQ)}，短期业绩动能偏弱。`
      : null,
    typeof operatingCashRatio === 'number' && operatingCashRatio < 5 ? `经营现金流/营收仅 ${operatingCashRatio.toFixed(2)}%，现金转化效率偏弱。`
      : null,
    typeof debtRatio === 'number' && debtRatio >= 70 ? `资产负债率约 ${debtRatio.toFixed(2)}%，杠杆水平偏高。`
      : null,
  ].filter(Boolean) as string[];

  const anomalies = [
    typeof revenueYoY === 'number' && revenueYoY <= 0
      ? { type: 'revenue_yoy', level: 'warning', title: '营收同比转弱', detail: `最新${latest.REPORT_DATE_NAME}营收同比 ${formatSignedPercent(revenueYoY)}。` }
      : null,
    typeof revenueQoQ === 'number' && revenueQoQ <= -10
      ? { type: 'revenue_qoq', level: 'warning', title: '营收环比回落明显', detail: `营收环比 ${formatSignedPercent(revenueQoQ)}，短期收入动能回落。` }
      : null,
    typeof profitYoY === 'number' && profitYoY <= 0
      ? { type: 'profit_yoy', level: 'danger', title: '利润同比承压', detail: `归母净利润同比 ${formatSignedPercent(profitYoY)}。` }
      : null,
    typeof profitQoQ === 'number' && profitQoQ <= -10
      ? { type: 'profit_qoq', level: 'danger', title: '利润环比下滑明显', detail: `归母净利润环比 ${formatSignedPercent(profitQoQ)}。` }
      : null,
    typeof epsYoY === 'number' && epsYoY <= 0
      ? { type: 'eps_yoy', level: 'warning', title: '每股收益同比转弱', detail: `EPS 同比 ${formatSignedPercent(epsYoY)}。` }
      : null,
    typeof grossMarginChange === 'number' && grossMarginChange <= -1.5
      ? { type: 'gross_margin', level: 'warning', title: '毛利率下滑', detail: `较上一期变动 ${formatSignedPercent(grossMarginChange)}。` }
      : null,
    typeof debtRatio === 'number' && debtRatio >= 70
      ? { type: 'debt_ratio', level: 'warning', title: '负债率偏高', detail: `资产负债率约 ${debtRatio.toFixed(2)}%。` }
      : null,
  ].filter(Boolean) as Array<{ type: string; level: 'warning' | 'danger'; title: string; detail: string }>;

  const cashflowObservation =
    typeof operatingCashRatio === 'number' && typeof profitYoY === 'number'
      ? operatingCashRatio < 5 && profitYoY > 0
        ? {
            level: 'warning',
            title: '现金流弱于利润',
            summary: `归母净利润同比 ${formatSignedPercent(profitYoY)}，但经营现金流/营收仅 ${operatingCashRatio.toFixed(2)}%，存在利润兑现为现金偏弱的背离。`,
          }
        : operatingCashRatio >= 10 && profitYoY < 0
          ? {
              level: 'neutral',
              title: '利润承压但现金流尚稳',
              summary: `利润同比 ${formatSignedPercent(profitYoY)}，但经营现金流/营收仍有 ${operatingCashRatio.toFixed(2)}%，现金质量相对稳于利润表现。`,
            }
          : operatingCashRatio >= 10 && profitYoY >= 0
            ? {
                level: 'positive',
                title: '现金流与利润同向改善',
                summary: `利润同比 ${formatSignedPercent(profitYoY)}，经营现金流/营收 ${operatingCashRatio.toFixed(2)}%，盈利与回款匹配度较好。`,
              }
            : {
                level: 'neutral',
                title: '现金流与利润大体匹配',
                summary: `利润同比 ${formatSignedPercent(profitYoY)}，经营现金流/营收 ${operatingCashRatio.toFixed(2)}%，暂未看到明显背离。`,
              }
      : null;

  const verdict =
    typeof profitYoY === 'number' && typeof revenueYoY === 'number'
      ? profitYoY > 0 && revenueYoY > 0
        ? '业绩延续增长'
        : profitYoY < 0 && revenueYoY < 0
          ? '业绩阶段承压'
          : profitYoY < 0
            ? '增收不增利'
            : '利润修复快于收入'
      : '财报表现待进一步确认';

  const summarySegments = [
    latest.REPORT_DATE_NAME ? `最新财报为 ${latest.REPORT_DATE_NAME}` : null,
    revenue ? `营业收入 ${formatLargeNumberCN(revenue)}` : null,
    typeof revenueYoY === 'number' ? `同比 ${formatSignedPercent(revenueYoY)}` : null,
    typeof revenueQoQ === 'number' ? `环比 ${formatSignedPercent(revenueQoQ)}` : null,
    profit ? `归母净利润 ${formatLargeNumberCN(profit)}` : null,
    typeof profitYoY === 'number' ? `同比 ${formatSignedPercent(profitYoY)}` : null,
    typeof profitQoQ === 'number' ? `环比 ${formatSignedPercent(profitQoQ)}` : null,
  ].filter(Boolean);

  const keyMetrics = [
    {
      label: '营收',
      value: formatLargeNumberCN(revenue),
      changeLabel: '同比',
      change: formatSignedPercent(revenueYoY),
    },
    {
      label: '归母净利润',
      value: formatLargeNumberCN(profit),
      changeLabel: '同比',
      change: formatSignedPercent(profitYoY),
    },
    {
      label: '每股收益',
      value: typeof eps === 'number' ? `${eps.toFixed(2)} 元` : '暂无',
      changeLabel: '同比',
      change: formatSignedPercent(epsYoY),
    },
    {
      label: '毛利率',
      value: typeof grossMargin === 'number' ? `${grossMargin.toFixed(2)}%` : '暂无',
      changeLabel: 'ROE',
      change: typeof roe === 'number' ? `${roe.toFixed(2)}%` : '暂无',
    },
    {
      label: '经营现金流/营收',
      value: typeof operatingCashRatio === 'number' ? `${operatingCashRatio.toFixed(2)}%` : '暂无',
      changeLabel: '负债率',
      change: typeof debtRatio === 'number' ? `${debtRatio.toFixed(2)}%` : '暂无',
    },
  ];

  const trend = reportRows.slice(0, 4).map((item: any) => ({
    label: item.REPORT_DATE_NAME,
    revenue: formatLargeNumberCN(toNumberOrNull(item.TOTALOPERATEREVE)),
    netProfit: formatLargeNumberCN(toNumberOrNull(item.PARENTNETPROFIT)),
    revenueValue: toNumberOrNull(item.TOTALOPERATEREVE),
    netProfitValue: toNumberOrNull(item.PARENTNETPROFIT),
    revenueYoY: toNumberOrNull(item.TOTALOPERATEREVETZ),
    profitYoY: toNumberOrNull(item.PARENTNETPROFITTZ),
  }));

  return {
    latestReportName: latest.REPORT_DATE_NAME || latest.REPORT_TYPE || '最新财报',
    reportType: latest.REPORT_TYPE || null,
    noticeDate: latest.NOTICE_DATE || null,
    verdict,
    summary: summarySegments.length > 0 ? `${summarySegments.join('，')}。` : '已获取最新财报核心指标，建议结合财报原文进一步核验。',
    highlights: highlights.length > 0 ? highlights : ['已接入结构化财报指标，可结合营收、利润与现金流变化做进一步判断。'],
    risks,
    anomalies,
    cashflowObservation,
    keyMetrics,
    trend,
    source: '东方财富财务指标',
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeRecommendation = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '观望';
  if (['buy', 'strong buy', '增持', '加仓', '买入'].includes(normalized)) return '买入';
  if (['hold', '持有', '继续持有'].includes(normalized)) return '持有';
  if (['sell', 'reduce', '减仓', '卖出'].includes(normalized)) return '卖出';
  if (['watch', 'wait', '观望', '观察'].includes(normalized)) return '观望';
  return String(value).trim();
};

const buildConfidenceMeta = ({
  snapshot,
  evidenceChain,
  peerComparison,
  eventSignals,
  reportAnalysis,
  analysisResult,
}: {
  snapshot: any;
  evidenceChain: any[];
  peerComparison: any[];
  eventSignals?: any;
  reportAnalysis?: any;
  analysisResult: any;
}) => {
  const breakdown = [
    {
      label: '行情完整度',
      score:
        typeof snapshot?.quote?.regularMarketPrice === 'number' && (snapshot?.dailySeries?.length || 0) >= 60
          ? 18
          : typeof snapshot?.quote?.regularMarketPrice === 'number'
            ? 12
            : 6,
      max: 18,
      detail: (snapshot?.dailySeries?.length || 0) >= 60 ? '行情、K线与关键价格位较完整' : '行情可用，但周期样本仍有限',
    },
    {
      label: '财报与公告',
      score:
        reportAnalysis?.latestReportName
          ? 20 + Math.min(6, (reportAnalysis?.anomalies?.length || 0) > 0 ? 2 : 6)
          : 8,
      max: 26,
      detail: reportAnalysis?.latestReportName ? `已结合 ${reportAnalysis.latestReportName} 与公告数据` : '财报结构化数据不足',
    },
    {
      label: '证据链与横向对比',
      score: Math.min(18, (evidenceChain?.length || 0) * 4 + Math.min(6, peerComparison?.length || 0)),
      max: 18,
      detail:
        evidenceChain?.length > 0
          ? `已引用 ${evidenceChain.length} 条证据，并纳入 ${peerComparison?.length || 0} 个可比标的`
          : '证据链条目仍偏少',
    },
    {
      label: '事件与时效性',
      score:
        eventSignals?.signals?.length > 0 ? 14 : eventSignals ? 10 : 6,
      max: 14,
      detail: eventSignals?.signals?.length > 0 ? '存在最新事件信号支撑' : '近期无明显新增事件驱动',
    },
    {
      label: '信号一致性',
      score:
        analysisResult?.reportAnalysis?.risks?.length >= 4 && analysisResult?.reasoning?.bullishFactors?.length < 2
          ? 8
          : analysisResult?.technical?.trend && analysisResult?.fundamental?.summary && analysisResult?.sentiment?.summary
            ? 16
            : 10,
      max: 16,
      detail:
        analysisResult?.reportAnalysis?.risks?.length >= 4
          ? '多维信号存在一定分歧'
          : '技术面、基本面与情绪面具备交叉验证',
    },
  ];

  const rawScore = breakdown.reduce((sum, item) => sum + item.score, 0);
  const normalizedScore = clampNumber(Number((rawScore / breakdown.reduce((sum, item) => sum + item.max, 0)).toFixed(2)), 0.35, 0.92);
  const level = normalizedScore >= 0.82 ? '高' : normalizedScore >= 0.72 ? '中高' : normalizedScore >= 0.6 ? '中' : '低';
  const summary =
    level === '高'
      ? '当前结论由行情、财报和事件信号共同支撑，适合按计划执行。'
      : level === '中高'
        ? '当前结论具备较强证据支撑，但仍需关注盘中验证和风险位。'
        : level === '中'
          ? '当前结论可参考，但更适合边看边验证，不宜重仓单边押注。'
          : '当前数据与信号支撑有限，更适合观察而非直接执行。';

  return {
    score: normalizedScore,
    level,
    summary,
    breakdown,
  };
};

const buildDecisionSupport = ({
  snapshot,
  analysisResult,
  reportAnalysis,
  eventSignals,
  evidenceChain,
  fallbackPortfolioAdvice,
}: {
  snapshot: any;
  analysisResult: any;
  reportAnalysis?: any;
  eventSignals?: any;
  evidenceChain: any[];
  fallbackPortfolioAdvice?: any;
}) => {
  const action = normalizeRecommendation(analysisResult?.recommendation);
  const support = toNumberOrNull(analysisResult?.technical?.support) ?? toNumberOrNull(snapshot?.quote?.regularMarketPreviousClose);
  const resistance = toNumberOrNull(analysisResult?.technical?.resistance) ?? toNumberOrNull(snapshot?.quote?.regularMarketDayHigh);
  const suitableFor =
    action === '买入'
      ? '波段 / 中线跟踪'
      : action === '持有'
        ? '已有持仓者继续跟踪'
        : action === '卖出'
          ? '风险控制优先'
          : '等待确认后再行动';

  const entryPlan =
    action === '买入'
      ? support
        ? `优先等待靠近支撑位 ${support.toFixed(2)} 一带分批布局，避免追高。`
        : '优先等待缩量回踩后的低风险位置分批布局。'
      : action === '持有'
        ? support
          ? `已有仓位可围绕支撑位 ${support.toFixed(2)} 做跟踪，不宜情绪化加仓。`
          : '已有仓位继续跟踪，不建议脱离验证条件继续追高。'
        : action === '卖出'
          ? '当前更适合控制仓位与回撤风险，不建议继续恋战。'
          : resistance
            ? `先观察能否放量突破 ${resistance.toFixed(2)}，未确认前以观望为主。`
            : '先观察趋势确认与量能配合，再决定是否参与。';

  const addTrigger =
    resistance
      ? `若放量站稳 ${resistance.toFixed(2)} 且事件/板块信号继续改善，再考虑追加仓位。`
      : '若量价继续同向改善，并有新增财报/公告催化，再考虑提高仓位。';
  const riskControl =
    support
      ? `若有效跌破 ${support.toFixed(2)}，应降低仓位或重新评估原判断。`
      : '若量能持续走弱且情绪转差，应主动降低仓位。';
  const targetHint =
    resistance
      ? `第一观察目标看 ${resistance.toFixed(2)} 一带的突破与承接。`
      : '优先观察关键阻力位突破后的延续性，不建议先给刚性目标价。';

  const coreBasis = [
    ...(analysisResult?.reasoning?.bullishFactors || []),
    ...(reportAnalysis?.highlights || []),
    ...(eventSignals?.signals || []).map((item: any) => item.title),
    ...(evidenceChain || []).map((item: any) => item.title),
  ]
    .filter(Boolean)
    .slice(0, 5);

  const counterSignals = [
    ...(analysisResult?.reasoning?.riskFactors || []),
    ...(reportAnalysis?.risks || []),
    ...((reportAnalysis?.anomalies || []).map((item: any) => item.title)),
  ]
    .filter(Boolean)
    .slice(0, 5);

  const invalidationTriggers = [
    support ? `价格有效跌破 ${support.toFixed(2)}` : null,
    resistance && action === '观望' ? `无法放量突破 ${resistance.toFixed(2)}` : null,
    reportAnalysis?.cashflowObservation?.level === 'warning' ? reportAnalysis.cashflowObservation.summary : null,
    ...(fallbackPortfolioAdvice?.riskControl || []),
  ]
    .filter(Boolean)
    .slice(0, 4);

  return {
    action,
    suitableFor,
    headline:
      action === '买入'
        ? '当前更适合等待确认后分批参与'
        : action === '持有'
          ? '当前以持仓跟踪和验证为主'
          : action === '卖出'
            ? '当前更应优先控制风险'
            : '当前以观察和等待验证为主',
    thesis: analysisResult?.thesis || '建议结合关键价位、财报和事件信号做动态决策。',
    coreBasis,
    counterSignals,
    invalidationTriggers,
    executionPlan: {
      currentAction: entryPlan,
      addTrigger,
      riskControl,
      targetHint,
    },
  };
};

const buildActionCard = ({
  snapshot,
  recommendation,
  confidence,
  technical,
}: {
  snapshot: any;
  recommendation: string;
  confidence: number;
  technical?: any;
}) => {
  const support = toNumberOrNull(technical?.support) ?? toNumberOrNull(snapshot?.quote?.regularMarketPreviousClose);
  const resistance = toNumberOrNull(technical?.resistance) ?? toNumberOrNull(snapshot?.quote?.regularMarketDayHigh);
  const stopLoss =
    support != null
      ? Number((support * 0.99).toFixed(2))
      : toNumberOrNull(snapshot?.lowerLimit) ?? toNumberOrNull(snapshot?.quote?.regularMarketDayLow);
  const confidenceBucket = confidence >= 0.82 ? 'high' : confidence >= 0.68 ? 'mid' : 'low';

  const byAction =
    recommendation === '买入'
      ? {
          positionSizing: confidenceBucket === 'high' ? '试探仓 20%-30%' : confidenceBucket === 'mid' ? '试探仓 10%-20%' : '轻仓观察 5%-10%',
          actionStyle: '进攻型',
          watchPoint: resistance ? `放量站稳 ${resistance.toFixed(2)} 后可考虑加仓` : '等待放量确认后再加仓',
          template: '先小仓位验证，再按突破或回踩确认分批加仓',
        }
      : recommendation === '持有'
        ? {
            positionSizing: '维持原仓，不主动追高',
            actionStyle: '跟踪型',
            watchPoint: support ? `回踩 ${support.toFixed(2)} 附近承接情况` : '关注回踩承接与量能变化',
            template: '已有仓位继续跟踪，除非关键位失守，否则不急于离场',
          }
        : recommendation === '卖出'
          ? {
              positionSizing: '减仓至防守仓位',
              actionStyle: '防守型',
              watchPoint: support ? `若无法重回 ${support.toFixed(2)} 上方，继续防守` : '若无明显修复信号，继续防守',
              template: '先控制回撤，再等待趋势和量能修复后重评',
            }
          : {
              positionSizing: '空仓或轻仓等待',
              actionStyle: '观察型',
              watchPoint: resistance ? `先看能否突破 ${resistance.toFixed(2)}` : '先等趋势确认和事件催化',
              template: '未确认前不急于参与，优先等关键位和信号共振',
            };

  return {
    action: recommendation,
    actionStyle: byAction.actionStyle,
    positionSizing: byAction.positionSizing,
    supportPrice: support,
    resistancePrice: resistance,
    stopLossPrice: stopLoss,
    watchPoint: byAction.watchPoint,
    template: byAction.template,
  };
};

const truncateText = (value: string | undefined, max = 120) => {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const extractAnalysisPrice = (result: any) =>
  Number(result?.meta?.priceAtAnalysis ?? result?.reference?.priceAtAnalysis ?? 0) || null;

const evaluateRecommendationHit = (recommendation: string, priceAtAnalysis: number, currentPrice: number) => {
  const changePercent = ((currentPrice - priceAtAnalysis) / priceAtAnalysis) * 100;

  if (recommendation.includes('买')) return { isHit: changePercent >= 2, changePercent };
  if (recommendation.includes('卖')) return { isHit: changePercent <= -2, changePercent };
  if (recommendation.includes('持有') || recommendation.includes('观望')) {
    return { isHit: Math.abs(changePercent) <= 5, changePercent };
  }

  return { isHit: null, changePercent };
};

const buildFallbackIntradayComment = (snapshot: any) => {
  const points = snapshot.intraday1m?.slice(-6) || [];
  const firstPrice = points[0]?.price ?? snapshot.quote.regularMarketPrice ?? 0;
  const lastPrice = points[points.length - 1]?.price ?? snapshot.quote.regularMarketPrice ?? 0;
  const delta = lastPrice - firstPrice;
  const bias = delta >= 0 ? '偏强' : '偏弱';

  return {
    comment: `盘中 ${bias} 运行，最新价位于 ${snapshot.boardName} 常规波动区间内，建议结合量能和涨跌停距离观察后续节奏。`,
    bias,
    keyObservation: delta >= 0 ? '最近几个分时点呈现抬升迹象。' : '最近几个分时点重心有所下移。',
    caution:
      snapshot.distanceToUpperLimit != null && snapshot.distanceToUpperLimit < 1
        ? '距离涨停较近，追价风险上升。'
        : snapshot.distanceToLowerLimit != null && snapshot.distanceToLowerLimit < 1
          ? '距离跌停较近，短线情绪偏谨慎。'
          : '当前仍处正常波动区间，注意量价是否同步。',
  };
};

const fetchAnalysisEnrichment = async (snapshot: any) => {
  const displayName = findStockNameByCode(snapshot.code) || snapshot.quote?.shortName || snapshot.code;
  const [filingsDigest, companyProfile, financialReportRows] = await Promise.all([
    fetchEastmoneyFilingsDigest(snapshot.code, displayName),
    fetchEastmoneyCompanyProfile(snapshot.code),
    fetchEastmoneyFinancialReportRows(snapshot.code),
  ]);
  const reportAnalysis = buildLocalReportAnalysis(snapshot, financialReportRows);
  const businessSummary = [
    `${displayName}属于${snapshot.industryName || snapshot.boardName || 'A股'}标的`,
    snapshot.regionName ? `地域为${snapshot.regionName}` : null,
    snapshot.conceptTags?.length ? `概念覆盖${snapshot.conceptTags.slice(0, 4).join('、')}` : null,
    companyProfile?.companySummary ? truncateText(companyProfile.companySummary, 160) : null,
  ]
    .filter(Boolean)
    .join('，');

  const financialHighlights = [
    snapshot.quote?.trailingPE ? `市盈率(P/E)：${snapshot.quote.trailingPE}` : null,
    snapshot.quote?.priceToBook ? `市净率(P/B)：${snapshot.quote.priceToBook}` : null,
    snapshot.quote?.epsTrailingTwelveMonths ? `每股收益(EPS)：${snapshot.quote.epsTrailingTwelveMonths}` : null,
    snapshot.quote?.marketCap ? `总市值：${formatLargeNumberCN(snapshot.quote.marketCap)}` : null,
    snapshot.quote?.regularMarketVolume ? `最新成交量：${formatLargeNumberCN(snapshot.quote.regularMarketVolume)}` : null,
  ].filter(Boolean);

  const researchSignals = [
    snapshot.comparisonGroupLabel ? `可比组：${snapshot.comparisonGroupLabel}` : null,
    snapshot.distanceToUpperLimit != null ? `距离涨停：${snapshot.distanceToUpperLimit} 元` : null,
    snapshot.distanceToLowerLimit != null ? `距离跌停：${snapshot.distanceToLowerLimit} 元` : null,
    filingsDigest.length > 0 ? `近期待跟踪公告 ${filingsDigest.length} 条` : null,
  ].filter(Boolean);

  const newsItems = [
    snapshot.boardName ? { title: `${snapshot.boardName} 市场热度跟踪`, source: '行情快照', publishedAt: Date.now(), summary: `${snapshot.boardName} 当前价格变动 ${snapshot.quote?.regularMarketChangePercent ?? '--'}%，建议结合板块轮动观察。` } : null,
    snapshot.industryName ? { title: `${snapshot.industryName} 行业景气观察`, source: '行业画像', publishedAt: Date.now(), summary: `${displayName} 所属行业为 ${snapshot.industryName}，可结合同业对比与公告变化跟踪。` } : null,
  ].filter(Boolean) as any[];

  return {
    newsItems,
    filingsDigest,
    financialHighlights,
    businessSummary: truncateText(businessSummary, 260),
    companySummary: companyProfile?.companySummary || null,
    businessScope: companyProfile?.businessScope || null,
    earningsGrowth: filingsDigest.length > 0 ? `近期公告跟踪 ${filingsDigest.length} 条` : '已补齐估值与行业维度',
    analystView: null,
    researchSignals,
    reportAnalysis,
    fundamentalSnapshot: {
      peRatio: snapshot.quote?.trailingPE ?? null,
      eps: snapshot.quote?.epsTrailingTwelveMonths ?? null,
      priceToBook: snapshot.quote?.priceToBook ?? null,
      marketCap: snapshot.quote?.marketCap ?? null,
      industryName: snapshot.industryName ?? companyProfile?.industryName ?? null,
      regionName: snapshot.regionName ?? companyProfile?.regionName ?? null,
    },
  };
};

const persistAnalysisResult = async (
  userId: string | undefined,
  stockCode: string,
  analysisType: string,
  analysisParams: Record<string, unknown>,
  analysisResult: any,
) => {
  if (!userId) return;

  const { data: historyData, error: historyError } = await supabase
    .from('analysis_history')
    .insert([
      {
        user_id: userId,
        stock_code: stockCode,
        analysis_type: analysisType,
        analysis_params: analysisParams,
      },
    ])
    .select()
    .single();

  if (!historyError && historyData) {
    await supabase.from('analysis_results').insert([
      {
        history_id: historyData.id,
        analysis_dimension: 'comprehensive',
        result_data: analysisResult,
        confidence_score: analysisResult.confidence,
      },
    ]);
  }
};

const generateStockAnalysis = async ({
  code,
  dimensions,
  userId,
  analysisType = 'comprehensive',
  triggerContext,
}: {
  code: string;
  dimensions?: string[];
  userId?: string;
  analysisType?: string;
  triggerContext?: any;
}) => {
  const snapshot = await fetchStockSnapshot(code);
  const [enrichment, portfolioContext, latestAnalysis, peerComparison] = await Promise.all([
    fetchAnalysisEnrichment(snapshot),
    fetchPortfolioContext(userId),
    fetchLatestAnalysisReference(userId, snapshot.code),
    fetchPeerComparison(snapshot.code, snapshot),
  ]);
  const eventSignals = triggerContext || buildEventSignals(snapshot, enrichment, latestAnalysis || undefined);
  const fallbackPortfolioAdvice = buildPortfolioAdviceFallback(snapshot, portfolioContext || undefined);
  const evidenceChain = buildEvidenceChain(snapshot, enrichment, peerComparison, eventSignals);
  const { quote } = snapshot;
  const localFundamental = buildLocalFundamentalView(snapshot, enrichment);
  const localSentiment = buildLocalSentimentView(snapshot, enrichment, peerComparison, eventSignals);
  const localReportAnalysis = enrichment.reportAnalysis || null;
  let usedAiProvider = canUseAi() ? resolvedAiProvider : 'fallback';

  let analysisResult;
  if (!canUseAi()) {
    analysisResult = buildFallbackAnalysis(quote);
  } else {
    try {
      const stockContext = `
股票名称: ${quote.shortName || snapshot.code}
股票代码: ${snapshot.code}
当前价格: ${quote.regularMarketPrice}
涨跌: ${quote.regularMarketChange} (${quote.regularMarketChangePercent}%)
今日开盘: ${quote.regularMarketOpen}
今日最高: ${quote.regularMarketDayHigh}
今日最低: ${quote.regularMarketDayLow}
昨收: ${quote.regularMarketPreviousClose}
52周最高: ${quote.fiftyTwoWeekHigh}
52周最低: ${quote.fiftyTwoWeekLow}
市盈率 (P/E): ${quote.trailingPE || '暂无'}
每股收益 (EPS): ${quote.epsTrailingTwelveMonths || '暂无'}
市值: ${quote.marketCap}
板块类型: ${snapshot.boardName}
涨停价: ${snapshot.upperLimit}
跌停价: ${snapshot.lowerLimit}
1分钟分时样本: ${JSON.stringify(snapshot.intraday1m.slice(-10))}
5分钟分时样本: ${JSON.stringify(snapshot.intraday5m.slice(-10))}
业务简介: ${enrichment.businessSummary || '暂无'}
财务亮点: ${JSON.stringify(enrichment.financialHighlights)}
财报解读草稿: ${JSON.stringify(localReportAnalysis)}
相关新闻: ${JSON.stringify(enrichment.newsItems)}
研究/公告线索: ${JSON.stringify(enrichment.filingsDigest)}
研究信号: ${JSON.stringify(enrichment.researchSignals)}
分析师观点: ${JSON.stringify(enrichment.analystView)}
同板块对比: ${JSON.stringify(peerComparison)}
用户组合概况: ${JSON.stringify(portfolioContext)}
事件触发信号: ${JSON.stringify(eventSignals)}
上次分析参考: ${JSON.stringify(latestAnalysis)}
`;

    const prompt = `你是一位专业的中国股市（A股）金融分析师。请基于以下最新行情、分时样本、横向对比和用户组合信息，对股票 ${snapshot.code} 提供深度分析：
${stockContext}

要求分析维度：${dimensions ? dimensions.join(', ') : '技术面 (technical), 基本面 (fundamental), 市场情绪 (sentiment)'}。
请严格返回如下格式的 JSON 对象（所有文本内容使用中文）：
- technical: 包含 trend、support、resistance、summary
- fundamental: 包含 peRatio、eps、revenueGrowth、summary
- sentiment: 包含 newsScore、socialScore、summary
- thesis: 一句话核心投资判断
- reasoning: 对象，包含 whyNow、bullishFactors(数组)、riskFactors(数组)、actionPlan
- decisionSummary: 对象，包含 headline、suitableFor、coreBasis(数组)、counterSignals(数组)、invalidationTriggers(数组)
- executionPlan: 对象，包含 currentAction、addTrigger、riskControl、targetHint
- confidenceMeta: 对象，包含 level、summary、breakdown(数组)
- catalysts: 数组
- risks: 数组
- scenario: 对象，包含 bullCase、baseCase、bearCase
- newsDigest: 数组，每项包含 title、source、summary、sentiment
- filingsDigest: 数组，每项包含 title、date、summary
- financialHighlights: 数组，列出3-5条财务/经营亮点
- reportAnalysis: 对象，包含 latestReportName、verdict、summary、highlights(数组)、risks(数组)、anomalies(数组)、cashflowObservation、keyMetrics(数组)、trend(数组)
- intradayQuickComment: 1-2句盘中快评
- recommendation: 字符串 (买入、持有、观望 或 卖出)
- riskLevel: 数字 (1-5，5为最高风险)
- confidence: 数字 (0-1，表示分析置信度)
- peerTakeaway: 一句话说明该股相对同板块/同类型标的的优势或劣势
- portfolioAdvice: 对象，包含 fit、role、suggestedAction、targetAllocation、reasoning(数组)、riskControl(数组)`;

      const completion = await openai.chat.completions.create({
        model: resolvedAiModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      analysisResult = parseAiJsonContent(completion.choices[0].message.content || '');
    } catch (aiError) {
      disableAiCapability(aiError);
      usedAiProvider = 'fallback';
      console.error('AI Analysis Error:', aiError);
      analysisResult = buildFallbackAnalysis(quote);
    }
  }

  const normalizedRecommendation = normalizeRecommendation(analysisResult?.recommendation);
  const localDecisionSupport = buildDecisionSupport({
    snapshot,
    analysisResult,
    reportAnalysis: localReportAnalysis,
    eventSignals,
    evidenceChain,
    fallbackPortfolioAdvice,
  });
  const localConfidenceMeta = buildConfidenceMeta({
    snapshot,
    evidenceChain,
    peerComparison,
    eventSignals,
    reportAnalysis: localReportAnalysis,
    analysisResult,
  });
  const aiConfidence =
    typeof analysisResult?.confidence === 'number' && Number.isFinite(analysisResult.confidence)
      ? clampNumber(analysisResult.confidence, 0, 1)
      : null;
  const finalConfidence = Number((((aiConfidence ?? localConfidenceMeta.score) * 0.35) + localConfidenceMeta.score * 0.65).toFixed(2));
  const localActionCard = buildActionCard({
    snapshot,
    recommendation: normalizedRecommendation,
    confidence: finalConfidence,
    technical: analysisResult?.technical,
  });

  analysisResult = {
    ...analysisResult,
    recommendation: normalizedRecommendation,
    confidence: finalConfidence,
    fundamental: {
      ...(analysisResult.fundamental || {}),
      peRatio: pickDisplayValue(analysisResult.fundamental?.peRatio, localFundamental.peRatio),
      eps: pickDisplayValue(analysisResult.fundamental?.eps, localFundamental.eps),
      revenueGrowth: pickDisplayValue(analysisResult.fundamental?.revenueGrowth, localFundamental.revenueGrowth),
      summary: pickDisplayValue(analysisResult.fundamental?.summary, localFundamental.summary),
    },
    sentiment: {
      ...(analysisResult.sentiment || {}),
      newsScore:
        typeof analysisResult.sentiment?.newsScore === 'number' ? analysisResult.sentiment.newsScore : localSentiment.newsScore,
      socialScore:
        typeof analysisResult.sentiment?.socialScore === 'number' ? analysisResult.sentiment.socialScore : localSentiment.socialScore,
      summary: pickDisplayValue(analysisResult.sentiment?.summary, localSentiment.summary),
    },
    newsDigest: analysisResult.newsDigest?.length ? analysisResult.newsDigest : enrichment.newsItems,
    filingsDigest: analysisResult.filingsDigest?.length ? analysisResult.filingsDigest : enrichment.filingsDigest,
    financialHighlights:
      analysisResult.financialHighlights?.length ? analysisResult.financialHighlights : enrichment.financialHighlights,
    reportAnalysis:
      analysisResult.reportAnalysis?.summary || analysisResult.reportAnalysis?.highlights?.length
        ? {
            ...(localReportAnalysis || {}),
            ...(analysisResult.reportAnalysis || {}),
            keyMetrics:
              analysisResult.reportAnalysis?.keyMetrics?.length ? analysisResult.reportAnalysis.keyMetrics : localReportAnalysis?.keyMetrics,
            highlights:
              analysisResult.reportAnalysis?.highlights?.length ? analysisResult.reportAnalysis.highlights : localReportAnalysis?.highlights,
            risks:
              analysisResult.reportAnalysis?.risks?.length ? analysisResult.reportAnalysis.risks : localReportAnalysis?.risks,
            anomalies:
              analysisResult.reportAnalysis?.anomalies?.length ? analysisResult.reportAnalysis.anomalies : localReportAnalysis?.anomalies,
            cashflowObservation: analysisResult.reportAnalysis?.cashflowObservation || localReportAnalysis?.cashflowObservation,
            trend: analysisResult.reportAnalysis?.trend?.length ? analysisResult.reportAnalysis.trend : localReportAnalysis?.trend,
          }
        : localReportAnalysis,
    intradayQuickComment: analysisResult.intradayQuickComment || buildFallbackIntradayComment(snapshot).comment,
    peerComparison: peerComparison,
    evidenceChain: analysisResult.evidenceChain?.length ? analysisResult.evidenceChain : evidenceChain,
    peerTakeaway:
      analysisResult.peerTakeaway ||
      (peerComparison.length > 0
        ? `${snapshot.code} 与${snapshot.comparisonGroupLabel || snapshot.boardName}可比标的相比，当前更适合结合相对强弱与估值水平做择时判断。`
        : '当前缺少足够可比标的，建议以自身趋势与风险收益比为主。'),
    comparisonGroupLabel: snapshot.comparisonGroupLabel || snapshot.boardName,
    portfolioAdvice: analysisResult.portfolioAdvice || fallbackPortfolioAdvice,
    decisionSummary:
      analysisResult.decisionSummary?.headline || analysisResult.decisionSummary?.coreBasis?.length
        ? {
            ...localDecisionSupport,
            ...(analysisResult.decisionSummary || {}),
            action: normalizedRecommendation,
            suitableFor: analysisResult.decisionSummary?.suitableFor || localDecisionSupport.suitableFor,
            coreBasis: analysisResult.decisionSummary?.coreBasis?.length ? analysisResult.decisionSummary.coreBasis : localDecisionSupport.coreBasis,
            counterSignals:
              analysisResult.decisionSummary?.counterSignals?.length
                ? analysisResult.decisionSummary.counterSignals
                : localDecisionSupport.counterSignals,
            invalidationTriggers:
              analysisResult.decisionSummary?.invalidationTriggers?.length
                ? analysisResult.decisionSummary.invalidationTriggers
                : localDecisionSupport.invalidationTriggers,
          }
        : localDecisionSupport,
    executionPlan:
      analysisResult.executionPlan?.currentAction || analysisResult.executionPlan?.riskControl
        ? {
            ...localDecisionSupport.executionPlan,
            ...(analysisResult.executionPlan || {}),
          }
        : localDecisionSupport.executionPlan,
    actionCard: {
      ...localActionCard,
      ...(analysisResult.actionCard || {}),
      action: normalizedRecommendation,
      supportPrice:
        typeof analysisResult.actionCard?.supportPrice === 'number' ? analysisResult.actionCard.supportPrice : localActionCard.supportPrice,
      resistancePrice:
        typeof analysisResult.actionCard?.resistancePrice === 'number'
          ? analysisResult.actionCard.resistancePrice
          : localActionCard.resistancePrice,
      stopLossPrice:
        typeof analysisResult.actionCard?.stopLossPrice === 'number' ? analysisResult.actionCard.stopLossPrice : localActionCard.stopLossPrice,
      positionSizing: analysisResult.actionCard?.positionSizing || localActionCard.positionSizing,
      watchPoint: analysisResult.actionCard?.watchPoint || localActionCard.watchPoint,
      template: analysisResult.actionCard?.template || localActionCard.template,
      actionStyle: analysisResult.actionCard?.actionStyle || localActionCard.actionStyle,
    },
    confidenceMeta: {
      ...localConfidenceMeta,
      score: finalConfidence,
    },
    eventSignals,
    meta: {
      ...(analysisResult.meta || {}),
      stockCode: snapshot.code,
      stockName: quote.shortName || snapshot.code,
      priceAtAnalysis: quote.regularMarketPrice,
      analyzedAt: new Date().toISOString(),
      analysisType,
      aiProvider: usedAiProvider,
      aiProviderLabel: getAiProviderLabel(usedAiProvider),
    },
  };

  await persistAnalysisResult(userId, snapshot.code, analysisType, { dimensions, triggerContext: eventSignals }, analysisResult);

  return {
    snapshot,
    enrichment,
    analysisResult,
    performance: userId ? await fetchAnalysisPerformance(userId, snapshot.code) : null,
    latestAnalysis,
    portfolioContext,
    eventSignals,
  };
};

const fetchAnalysisPerformance = async (userId: string, currentCode?: string) => {
  const { data: histories, error: historyError } = await supabase
    .from('analysis_history')
    .select('id, stock_code, analysis_date')
    .eq('user_id', userId)
    .order('analysis_date', { ascending: false })
    .limit(30);

  if (historyError || !histories || histories.length === 0) {
    return {
      overallHitRate: 0,
      totalEvaluated: 0,
      totalHits: 0,
      currentStock: null,
      recent: [],
    };
  }

  const historyIds = histories.map((item) => item.id);
  const { data: results, error: resultError } = await supabase
    .from('analysis_results')
    .select('history_id, result_data, confidence_score')
    .in('history_id', historyIds);

  if (resultError || !results) {
    return {
      overallHitRate: 0,
      totalEvaluated: 0,
      totalHits: 0,
      currentStock: null,
      recent: [],
    };
  }

  const historyMap = new Map(histories.map((item) => [item.id, item]));
  const uniqueCodes = [...new Set(histories.map((item) => item.stock_code))];
  const snapshotEntries = await Promise.all(
    uniqueCodes.map(async (symbol) => {
      try {
        const snapshot = await fetchStockSnapshot(symbol);
        return [symbol, snapshot] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  const snapshotMap = new Map(snapshotEntries);

  const scored = results
    .map((result) => {
      const history = historyMap.get(result.history_id);
      const recommendation = result.result_data?.recommendation || '';
      const priceAtAnalysis = extractAnalysisPrice(result.result_data);
      const snapshot = history ? snapshotMap.get(history.stock_code) : null;
      const currentPrice = snapshot?.quote?.regularMarketPrice ?? null;
      const periodBacktests =
        history && snapshot?.dailySeries
          ? buildPeriodBacktests(recommendation, priceAtAnalysis, history.analysis_date, snapshot.dailySeries)
          : {};

      if (!history || !priceAtAnalysis || typeof currentPrice !== 'number') {
        return null;
      }

      const { isHit, changePercent } = evaluateRecommendationHit(recommendation, priceAtAnalysis, currentPrice);

      return {
        stockCode: history.stock_code,
        recommendation,
        priceAtAnalysis,
        currentPrice,
        changePercent: Number(changePercent.toFixed(2)),
        isHit,
        analysisDate: history.analysis_date,
        periodBacktests,
      };
    })
    .filter(Boolean) as any[];

  const evaluable = scored.filter((item) => item.isHit !== null);
  const hits = evaluable.filter((item) => item.isHit).length;
  const currentStockRows = currentCode ? evaluable.filter((item) => item.stockCode === normalizeStockCode(currentCode)) : [];
  const periodStats = summarizePeriodBacktests(scored);

  return {
    overallHitRate: evaluable.length ? Number(((hits / evaluable.length) * 100).toFixed(2)) : 0,
    totalEvaluated: evaluable.length,
    totalHits: hits,
    periodStats,
    currentStock: currentStockRows.length
      ? {
          hitRate: Number(((currentStockRows.filter((item) => item.isHit).length / currentStockRows.length) * 100).toFixed(2)),
          total: currentStockRows.length,
          periodStats: summarizePeriodBacktests(currentStockRows),
        }
      : null,
    recent: evaluable.slice(0, 5),
  };
};

const fetchAnalysisHistoryRows = async (userId: string, code?: string) => {
  let historyQuery = supabase
    .from('analysis_history')
    .select('id, stock_code, analysis_date, analysis_type, analysis_params')
    .eq('user_id', userId)
    .order('analysis_date', { ascending: false })
    .limit(100);

  if (code) {
    historyQuery = historyQuery.eq('stock_code', normalizeStockCode(code));
  }

  const { data: histories, error: historyError } = await historyQuery;

  if (historyError || !histories) {
    return {
      summary: {
        totalAnalyses: 0,
        buyCount: 0,
        holdCount: 0,
        sellCount: 0,
        overallHitRate: 0,
        averageConfidence: 0,
      },
      rows: [],
    };
  }

  if (histories.length === 0) {
    return {
      summary: {
        totalAnalyses: 0,
        buyCount: 0,
        holdCount: 0,
        sellCount: 0,
        overallHitRate: 0,
        averageConfidence: 0,
      },
      rows: [],
    };
  }

  const historyIds = histories.map((item) => item.id);
  const { data: results } = await supabase
    .from('analysis_results')
    .select('history_id, result_data, confidence_score')
    .in('history_id', historyIds);

  const resultMap = new Map((results || []).map((item) => [item.history_id, item]));
  const uniqueCodes = [...new Set(histories.map((item) => item.stock_code))];
  const snapshotEntries = await Promise.all(
    uniqueCodes.map(async (symbol) => {
      try {
        const snapshot = await fetchStockSnapshot(symbol);
        return [symbol, snapshot] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  const snapshotMap = new Map(snapshotEntries);

  const rows = histories.map((history) => {
    const result = resultMap.get(history.id);
    const report = result?.result_data || {};
    const priceAtAnalysis = extractAnalysisPrice(report);
    const snapshot = snapshotMap.get(history.stock_code);
    const currentPrice = snapshot?.quote?.regularMarketPrice ?? null;
    const performance =
      priceAtAnalysis && typeof currentPrice === 'number'
        ? evaluateRecommendationHit(report.recommendation || '', priceAtAnalysis, currentPrice)
        : { isHit: null, changePercent: 0 };
    const periodBacktests = snapshot?.dailySeries
      ? buildPeriodBacktests(report.recommendation || '', priceAtAnalysis, history.analysis_date, snapshot.dailySeries)
      : {};

    return {
      id: history.id,
      stockCode: history.stock_code,
      analysisDate: history.analysis_date,
      analysisType: history.analysis_type,
      recommendation: report.recommendation || '暂无',
      confidence: result?.confidence_score ?? report.confidence ?? 0,
      thesis: report.thesis || '',
      whyNow: report.reasoning?.whyNow || '',
      actionPlan: report.reasoning?.actionPlan || '',
      intradayQuickComment: report.intradayQuickComment || '',
      priceAtAnalysis,
      currentPrice,
      changePercent: Number((performance.changePercent || 0).toFixed(2)),
      isHit: performance.isHit,
      technical: report.technical || null,
      fundamental: report.fundamental || null,
      sentiment: report.sentiment || null,
      catalysts: report.catalysts || [],
      risks: report.risks || [],
      evidenceChain: report.evidenceChain || [],
      peerComparison: report.peerComparison || [],
      peerTakeaway: report.peerTakeaway || '',
      portfolioAdvice: report.portfolioAdvice || null,
      eventSignals: report.eventSignals || null,
      periodBacktests,
    };
  });

  const evaluable = rows.filter((item) => item.isHit !== null);
  const buyCount = rows.filter((item) => String(item.recommendation).includes('买')).length;
  const holdCount = rows.filter((item) => String(item.recommendation).includes('持有') || String(item.recommendation).includes('观望')).length;
  const sellCount = rows.filter((item) => String(item.recommendation).includes('卖')).length;
  const averageConfidence =
    rows.length > 0 ? Number((rows.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / rows.length).toFixed(2)) : 0;

  return {
    summary: {
      totalAnalyses: rows.length,
      buyCount,
      holdCount,
      sellCount,
      overallHitRate: evaluable.length ? Number(((evaluable.filter((item) => item.isHit).length / evaluable.length) * 100).toFixed(2)) : 0,
      averageConfidence,
      periodStats: summarizePeriodBacktests(rows),
    },
    rows,
  };
};

const fetchStockSnapshot = async (rawCode: string) => {
  const code = await resolveStockInput(rawCode);
  const now = Date.now();
  const cachedSnapshot = stockSnapshotCache.get(code);

  if (cachedSnapshot && now - cachedSnapshot.updatedAt < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot.snapshot;
  }

  const inflightSnapshot = stockSnapshotInflight.get(code);
  if (inflightSnapshot) {
    return inflightSnapshot;
  }

  const snapshotPromise = (async () => {
  const secid = toSecid(code);
    let quotePayload: any = null;
    let fallbackQuote: any = null;

    try {
      quotePayload = await fetchEastmoneyJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f23,f43,f44,f45,f46,f47,f48,f57,f58,f60,f71,f84,f85,f86,f100,f102,f112,f113,f114,f115,f116,f117,f119,f120,f121,f127,f128,f129,f168,f169,f170&ut=${EASTMONEY_UT}&invt=2&fltt=2`,
        { retries: 0, timeoutMs: 1200 },
      );
    } catch (error) {
      try {
        fallbackQuote = await fetchSinaBasicQuote(code);
      } catch (fallbackError) {
        throw fallbackError instanceof Error ? fallbackError : error;
      }
    }

    const [trendsResult, klineResult] = await Promise.allSettled([
      fetchEastmoneyJson(
        `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ut=${EASTMONEY_UT}&ndays=1&iscr=0`,
        { retries: 0, timeoutMs: 1800 },
      ),
      fetchEastmoneyJson(
        `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=260&end=20500101&iscca=1&ut=${EASTMONEY_UT}`,
        { retries: 1, timeoutMs: 3500 },
      ),
    ]);
  const quoteData = quotePayload?.data;
    const trendsPayload = trendsResult.status === 'fulfilled' ? trendsResult.value : null;
    const klinePayload = klineResult.status === 'fulfilled' ? klineResult.value : null;
    let trendPoints = parseEastmoneyTrendPoints(trendsPayload?.data?.trends || []);
    let dailySeries = parseEastmoneyKlines(klinePayload?.data?.klines || []);

    if (trendPoints.length === 0) {
      try {
        trendPoints = await fetchTencentIntradaySeries(code);
      } catch (error) {
        console.error('Tencent intraday fallback error:', error);
      }
    }

    if (!quoteData && !fallbackQuote) {
      throw new Error(`Failed to fetch quote snapshot for ${code}`);
    }

    const { boardName, limitPercent } = getBoardMeta(code);
    const previousClose =
      toNumberOrNull(quoteData?.f60) ??
      fallbackQuote?.regularMarketPreviousClose ??
      dailySeries[dailySeries.length - 2]?.close ??
      dailySeries[dailySeries.length - 1]?.close ??
      toNumberOrNull(quoteData?.f43) ??
      fallbackQuote?.regularMarketPrice ??
      0;
    if (dailySeries.length === 0) {
      try {
        dailySeries = await fetchTencentDailySeries(code);
      } catch (error) {
        console.error('Tencent daily fallback error:', error);
      }
    }
    if (dailySeries.length === 0) {
      dailySeries = buildSyntheticDailySeries(
        toNumberOrNull(quoteData?.f43) ?? fallbackQuote?.regularMarketPrice ?? 0,
        previousClose,
      );
    }
    const upperLimit = Number((previousClose * (1 + limitPercent)).toFixed(2));
    const lowerLimit = Number((previousClose * (1 - limitPercent)).toFixed(2));
    const marketState = getAshareMarketState();
    const recentDailySeries = dailySeries.slice(-30);
    const yearSeries = dailySeries.slice(-250);
    const regularMarketPrice = toNumberOrNull(quoteData?.f43) ?? fallbackQuote?.regularMarketPrice ?? dailySeries[dailySeries.length - 1]?.close ?? 0;
    const companyProfile =
      String(quoteData?.f127 || '').trim() && String(quoteData?.f128 || '').trim()
        ? null
        : await fetchEastmoneyCompanyProfile(code);
    const rawTrailingPE = toNumberOrNull(quoteData?.f115) ?? toNumberOrNull(quoteData?.f9) ?? toNumberOrNull(quoteData?.f114);
    const industryName = cleanAshareText(quoteData?.f100) || cleanAshareText(quoteData?.f127) || companyProfile?.industryName || null;
    const regionName = cleanAshareText(quoteData?.f102) || cleanAshareText(quoteData?.f128) || companyProfile?.regionName || null;
    const rawEpsTrailingTwelveMonths =
      toNumberOrNull(quoteData?.f112) ??
      (rawTrailingPE && rawTrailingPE > 0 ? Number((regularMarketPrice / rawTrailingPE).toFixed(2)) : null);
    const rawPriceToBook =
      toNumberOrNull(quoteData?.f23) ??
      (() => {
        const bookValuePerShare = toNumberOrNull(quoteData?.f113);
        if (bookValuePerShare && bookValuePerShare > 0) {
          return Number((regularMarketPrice / bookValuePerShare).toFixed(2));
        }
        return null;
      })();
    const operationsMetrics =
      isPositiveMetric(rawTrailingPE) && isPositiveMetric(rawEpsTrailingTwelveMonths) && isPositiveMetric(rawPriceToBook)
        ? null
        : await fetchEastmoneyOperationsMetrics(code);
    const trailingPE = isPositiveMetric(rawTrailingPE) ? rawTrailingPE : operationsMetrics?.peRatio ?? null;
    const epsTrailingTwelveMonths =
      (isPositiveMetric(rawEpsTrailingTwelveMonths) ? rawEpsTrailingTwelveMonths : null) ??
      operationsMetrics?.eps ??
      (trailingPE && trailingPE > 0 ? Number((regularMarketPrice / trailingPE).toFixed(2)) : null);
    const priceToBook =
      (isPositiveMetric(rawPriceToBook) ? rawPriceToBook : null) ??
      operationsMetrics?.priceToBook ??
      (() => {
        const bookValuePerShare = operationsMetrics?.bookValuePerShare;
        if (bookValuePerShare && bookValuePerShare > 0) {
          return Number((regularMarketPrice / bookValuePerShare).toFixed(2));
        }
        return null;
      })();
    const conceptTags = String(quoteData?.f129 || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
    const quote: any = {
      symbol: code,
      shortName: String(quoteData?.f58 || fallbackQuote?.shortName || findStockNameByCode(code)).trim(),
      longName: String(quoteData?.f58 || fallbackQuote?.shortName || findStockNameByCode(code)).trim(),
      regularMarketPrice,
      regularMarketChange: toNumberOrNull(quoteData?.f169) ?? (regularMarketPrice - previousClose),
      regularMarketChangePercent:
        toNumberOrNull(quoteData?.f170) ??
        (previousClose ? Number((((regularMarketPrice - previousClose) / previousClose) * 100).toFixed(2)) : 0),
      regularMarketVolume:
        (toNumberOrNull(quoteData?.f47) ?? fallbackQuote?.regularMarketVolume ?? dailySeries[dailySeries.length - 1]?.volume ?? 0) * 100,
      marketCap: toNumberOrNull(quoteData?.f116) ?? toNumberOrNull(quoteData?.f117),
      regularMarketOpen: toNumberOrNull(quoteData?.f46) ?? fallbackQuote?.regularMarketOpen ?? dailySeries[dailySeries.length - 1]?.open,
      regularMarketDayHigh: toNumberOrNull(quoteData?.f44) ?? fallbackQuote?.regularMarketDayHigh ?? dailySeries[dailySeries.length - 1]?.high,
      regularMarketDayLow: toNumberOrNull(quoteData?.f45) ?? fallbackQuote?.regularMarketDayLow ?? dailySeries[dailySeries.length - 1]?.low,
      regularMarketPreviousClose: previousClose,
      marketState,
      fiftyTwoWeekHigh:
        yearSeries.length > 0
          ? Number(
              Math.max(
                ...yearSeries.map((item) => item.high ?? item.close),
              ).toFixed(2),
            )
          : null,
      fiftyTwoWeekLow:
        yearSeries.length > 0
          ? Number(
              Math.min(
                ...yearSeries.map((item) => item.low ?? item.close),
              ).toFixed(2),
            )
          : null,
      trailingPE,
      epsTrailingTwelveMonths,
      priceToBook,
    };
    const intraday1m = trendPoints.map(({ time, price, volume }) => ({ time, price, volume }));
    const intraday5m = aggregateIntradayPoints(intraday1m, 5);

    const snapshot = {
      code,
      quote,
      boardName,
      industryName,
      regionName,
      companySummary: companyProfile?.companySummary || null,
      businessScope: companyProfile?.businessScope || null,
      conceptTags,
      comparisonGroupLabel: industryName || boardName,
      limitPercent,
      upperLimit,
      lowerLimit,
      previousClose,
      marketStateLabel: getMarketStateLabel(quote.marketState),
      isLimitUp: typeof quote.regularMarketPrice === 'number' ? quote.regularMarketPrice >= upperLimit : false,
      isLimitDown: typeof quote.regularMarketPrice === 'number' ? quote.regularMarketPrice <= lowerLimit : false,
      distanceToUpperLimit:
        typeof quote.regularMarketPrice === 'number' ? Number((upperLimit - quote.regularMarketPrice).toFixed(2)) : null,
      distanceToLowerLimit:
        typeof quote.regularMarketPrice === 'number' ? Number((quote.regularMarketPrice - lowerLimit).toFixed(2)) : null,
      historical: recentDailySeries.map((item) => ({
        date: new Date(item.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        price: Number(item.close.toFixed(2)),
      })),
      dailySeries,
      intraday1m,
      intraday5m,
    };

    stockSnapshotCache.set(code, {
      updatedAt: Date.now(),
      snapshot,
    });

    return snapshot;
  })()
    .catch((error) => {
      if (cachedSnapshot && now - cachedSnapshot.updatedAt < SNAPSHOT_STALE_TTL_MS) {
        return cachedSnapshot.snapshot;
      }
      throw error;
    })
    .finally(() => {
      stockSnapshotInflight.delete(code);
    });

  stockSnapshotInflight.set(code, snapshotPromise);
  return snapshotPromise;
};

router.get('/watchlist/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { code } = req.query;

    let query = supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (typeof code === 'string' && code) {
      query = query.eq('stock_code', normalizeStockCode(code));
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const baseList = data || [];
    const enriched = await Promise.all(
      baseList.map(async (item) => {
        try {
          const snapshot = await fetchStockSnapshot(item.stock_code);
          return {
            ...item,
            price: snapshot.quote.regularMarketPrice,
            change: snapshot.quote.regularMarketChange,
            changePercent: snapshot.quote.regularMarketChangePercent,
            marketStateLabel: snapshot.marketStateLabel,
            boardName: snapshot.boardName,
          };
        } catch {
          return item;
        }
      }),
    );

    res.json({ success: true, watchlist: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

router.post('/watchlist', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, stockCode, stockName, alertPrice } = req.body;

    if (!userId || !stockCode || !stockName) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const normalizedCode = normalizeStockCode(stockCode);
    const access = await ensureWatchlistAccess(userId, normalizedCode);
    if (!access.allowed) {
      res.status(access.status).json({ success: false, error: access.error });
      return;
    }

    const { data, error } = await supabase
      .from('watchlist')
      .upsert(
        [
          {
            user_id: userId,
            stock_code: normalizedCode,
            stock_name: stockName,
            alert_price: alertPrice ?? null,
            is_active: true,
          },
        ],
        { onConflict: 'user_id,stock_code' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true, watchlist: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add watchlist item' });
  }
});

router.delete('/watchlist/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('watchlist').delete().eq('id', id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete watchlist item' });
  }
});

router.get('/analysis/performance/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { code } = req.query;
    const performance = await fetchAnalysisPerformance(
      userId,
      typeof code === 'string' ? code : undefined,
    );

    res.json({ success: true, performance });
  } catch (error) {
    console.error('Analysis Performance Error:', error);
    res.status(500).json({ error: 'Failed to fetch analysis performance' });
  }
});

router.get('/intraday-comment/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;
    const snapshot = await fetchStockSnapshot(code);
    let quickComment;
    let usedAiProvider = canUseAi() ? resolvedAiProvider : 'fallback';

    if (!canUseAi()) {
      quickComment = buildFallbackIntradayComment(snapshot);
    } else {
      try {
        const prompt = `你是一位专业的A股盘中交易员。请根据以下最新分时数据，用中文返回简短但专业的盘中快评 JSON：
股票代码: ${snapshot.code}
股票名称: ${snapshot.quote.shortName || snapshot.code}
当前价格: ${snapshot.quote.regularMarketPrice}
涨跌幅: ${snapshot.quote.regularMarketChangePercent}
板块: ${snapshot.boardName}
涨停价: ${snapshot.upperLimit}
跌停价: ${snapshot.lowerLimit}
1分钟分时样本: ${JSON.stringify(snapshot.intraday1m.slice(-12))}

请返回 JSON：
- comment: 1-2 句盘中快评
- bias: 多头 / 中性 / 空头
- keyObservation: 一句关键观察
- caution: 一句风险提醒`;

        const completion = await openai.chat.completions.create({
          model: resolvedAiModel,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        });
        quickComment = parseAiJsonContent(completion.choices[0].message.content || '');
      } catch (error) {
        disableAiCapability(error);
        usedAiProvider = 'fallback';
        console.error('Intraday Comment AI Error:', error);
        quickComment = buildFallbackIntradayComment(snapshot);
      }
    }

    quickComment = {
      ...quickComment,
      provider: usedAiProvider,
      providerLabel: getAiProviderLabel(usedAiProvider),
    };

    res.json({ success: true, comment: quickComment });
  } catch (error) {
    console.error('Intraday Comment Error:', error);
    res.status(500).json({ error: 'Failed to generate intraday comment' });
  }
});

router.post('/analysis/event-refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, userId, dimensions, force } = req.body;

    if (!code) {
      res.status(400).json({ error: 'Stock code is required' });
      return;
    }

    const access = await ensureAiAccess(userId);
    if (!access.allowed) {
      res.status(access.status).json({
        success: false,
        error: access.error,
        aiQuota: access.aiQuota,
      });
      return;
    }

    const snapshot = await fetchStockSnapshot(code);
    const enrichment = await fetchAnalysisEnrichment(snapshot);
    const latestAnalysis = await fetchLatestAnalysisReference(userId, snapshot.code);
    const eventSignals = buildEventSignals(snapshot, enrichment, latestAnalysis || undefined);

    if (!force && !eventSignals.shouldRerun) {
      res.status(200).json({
        success: true,
        triggered: false,
        eventSignals,
        latestAnalysis,
      });
      return;
    }

    const result = await generateStockAnalysis({
      code: snapshot.code,
      dimensions,
      userId,
      analysisType: 'event_refresh',
      triggerContext: eventSignals,
    });

    res.status(200).json({
      success: true,
      triggered: true,
      analysis: result.analysisResult,
      performance: result.performance,
      aiQuota: userId ? await getAiQuotaSummary(userId) : null,
      eventSignals,
      enrichment: {
        newsItems: result.enrichment.newsItems,
        filingsDigest: result.enrichment.filingsDigest,
        financialHighlights: result.enrichment.financialHighlights,
        analystView: result.enrichment.analystView,
      },
    });
  } catch (error) {
    console.error('Event Refresh Error:', error);
    res.status(500).json({ error: 'Failed to refresh analysis by events' });
  }
});

router.get('/analysis/history/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { code } = req.query;
    const result = await fetchAnalysisHistoryRows(userId, typeof code === 'string' ? code : undefined);

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Analysis History Error:', error);
    res.status(500).json({ error: 'Failed to fetch analysis history' });
  }
});

router.get('/analysis/review-center/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const history = await fetchAnalysisHistoryRows(userId);
    const performance = await fetchAnalysisPerformance(userId);

    const monthlyCounts: Record<string, number> = {};
    for (const row of history.rows) {
      const month = new Date(row.analysisDate).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit' });
      monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
    }

    const monthlyTrend = Object.entries(monthlyCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, count]) => ({ month, count }));

    res.json({
      success: true,
      summary: history.summary,
      performance,
      monthlyTrend,
      recentRows: history.rows.slice(0, 12),
    });
  } catch (error) {
    console.error('Review Center Error:', error);
    res.status(500).json({ error: 'Failed to fetch review center data' });
  }
});

router.get('/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.params;

    if (!code) {
      res.status(400).json({ error: 'Stock code is required' });
      return;
    }

    const snapshot = await fetchStockSnapshot(code);
    const { quote, historical } = snapshot;
    const displayName = findStockNameByCode(snapshot.code) || quote.shortName || quote.longName || snapshot.code;

    res.status(200).json({
      success: true,
      stock: {
        code: snapshot.code,
        name: displayName,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        previousClose: snapshot.previousClose,
        marketState: quote.marketState || 'REGULAR',
        marketStateLabel: snapshot.marketStateLabel,
        boardName: snapshot.boardName,
        limitPercent: snapshot.limitPercent,
        upperLimit: snapshot.upperLimit,
        lowerLimit: snapshot.lowerLimit,
        isLimitUp: snapshot.isLimitUp,
        isLimitDown: snapshot.isLimitDown,
        distanceToUpperLimit: snapshot.distanceToUpperLimit,
        distanceToLowerLimit: snapshot.distanceToLowerLimit,
        updatedAt: new Date().toISOString(),
        historical,
        dailySeries: snapshot.dailySeries,
        intraday1m: snapshot.intraday1m,
        intraday5m: snapshot.intraday5m,
        intraday: snapshot.intraday5m,
        industryName: snapshot.industryName,
        regionName: snapshot.regionName,
        conceptTags: snapshot.conceptTags,
        peRatio: quote.trailingPE,
        eps: quote.epsTrailingTwelveMonths,
        priceToBook: quote.priceToBook,
        companySummary: snapshot.companySummary,
        businessScope: snapshot.businessScope,
      },
    });
  } catch (error) {
    console.error('Stock Snapshot Error:', error);
    res.status(500).json({ error: 'Failed to fetch stock data' });
  }
});

router.post('/analysis', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, dimensions, userId } = req.body;

    if (!code) {
      res.status(400).json({ error: 'Stock code is required' });
      return;
    }

    const access = await ensureAiAccess(userId);
    if (!access.allowed) {
      res.status(access.status).json({
        success: false,
        error: access.error,
        aiQuota: access.aiQuota,
      });
      return;
    }

    const result = await generateStockAnalysis({
      code,
      dimensions,
      userId,
      analysisType: 'comprehensive',
    });

    res.status(200).json({
      success: true,
      analysis: result.analysisResult,
      performance: result.performance,
      aiQuota: userId ? await getAiQuotaSummary(userId) : null,
      enrichment: {
        newsItems: result.enrichment.newsItems,
        filingsDigest: result.enrichment.filingsDigest,
        financialHighlights: result.enrichment.financialHighlights,
        analystView: result.enrichment.analystView,
      },
    });
  } catch (error) {
    console.error('Analysis Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/alerts/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { code } = req.query;

    let query = supabase
      .from('price_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (typeof code === 'string' && code) {
      query = query.eq('stock_code', normalizeStockCode(code));
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true, alerts: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.post('/alerts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, stockCode, stockName, targetPrice, direction } = req.body;

    if (!userId || !stockCode || !targetPrice || !direction) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const normalizedCode = normalizeStockCode(stockCode);
    const { data, error } = await supabase
      .from('price_alerts')
      .insert([
        {
          user_id: userId,
          stock_code: normalizedCode,
          stock_name: stockName,
          target_price: targetPrice,
          direction,
          is_active: true,
        },
      ])
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true, alert: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

router.delete('/alerts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('price_alerts').delete().eq('id', id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

export default router;
