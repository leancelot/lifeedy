import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import type { GoogleGenAI } from '@google/genai';
import {
  extractNfceKeyOrUrl,
  inferCategoryFromTextAndCnae,
  isAllowedSefazUrl,
  parseSefazHtmlToReceipt,
} from './src/services/nfceSefazParser.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

function resolveServerPort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const cliPort = Number(process.argv[portArgIndex + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }

  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3000;

  // In AI Studio dev containers, NGINX listens on NGINX_PORT (8080) and proxies to DEFAULT_APP_PORT (3000)
  if (process.env.NODE_ENV !== 'production' && nginxPort && envPort === nginxPort) {
    return defaultAppPort;
  }

  return Number.isFinite(envPort) && envPort > 0 ? envPort : defaultAppPort;
}

function resolveServerHost(): string {
  const hostArgIndex = process.argv.indexOf('--host');
  if (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) {
    return process.argv[hostArgIndex + 1];
  }
  return '0.0.0.0';
}

const PORT = resolveServerPort();
const HOST = resolveServerHost();

const CONFIGURED_APP_ORIGIN = (() => {
  const raw = (process.env.APP_URL || process.env.VITE_APP_URL || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
})();

function isAllowedCorsOrigin(origin: string | undefined, reqHost: string | undefined): boolean {
  if (!origin) return true;
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost' || origin === 'https://localhost') {
    return true;
  }
  if (CONFIGURED_APP_ORIGIN && origin === CONFIGURED_APP_ORIGIN) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    if (reqHost && parsed.host === reqHost) return true;
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.run.app')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.github.com https://github.com https://objects.githubusercontent.com https://open.cnpja.com https://publica.cnpj.ws https://brasilapi.com.br https://cdn.jsdelivr.net wss:",
  "frame-src 'self'",
  "frame-ancestors 'self' https://aistudio.google.com https://*.google.com",
].join('; ');

app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);

  const origin = req.headers.origin;
  const allowed = isAllowedCorsOrigin(origin, req.get('host'));
  if (origin && allowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return allowed ? res.sendStatus(200) : res.sendStatus(403);
  }
  if (origin && !allowed && req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Origem não autorizada para acessar esta API.' });
  }
  next();
});

const rateBuckets = new Map<string, number[]>();
function createRateLimiter(bucketName: string, maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
    const key = `${bucketName}:${clientIp}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (rateBuckets.get(key) || []).filter((ts) => ts > cutoff);

    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      res.header('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Muitas requisições seguidas. Aguarde alguns instantes e tente novamente.',
      });
    }

    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 500) {
      for (const [entryKey, timestamps] of rateBuckets.entries()) {
        if (timestamps.every((ts) => ts <= cutoff)) {
          rateBuckets.delete(entryKey);
        }
      }
    }
    next();
  };
}

const receiptRateLimiter = createRateLimiter('receipt', 15, 5 * 60 * 1000);
const nfceRateLimiter = createRateLimiter('nfce', 25, 5 * 60 * 1000);
const diagnosticsRateLimiter = createRateLimiter('diagnostics', 20, 5 * 60 * 1000);

// Increase body limit to support base64 photos/receipts
app.use(express.json({ limit: '18mb' }));

let cachedAiClient: GoogleGenAI | null = null;
let cachedGenAiSdk: typeof import('@google/genai') | null = null;
async function getGenAiRuntime(): Promise<{
  ai: GoogleGenAI;
  ThinkingLevel: typeof import('@google/genai').ThinkingLevel;
  Type: typeof import('@google/genai').Type;
}> {
  if (!cachedGenAiSdk) {
    cachedGenAiSdk = await import('@google/genai');
  }
  if (!cachedAiClient) {
    cachedAiClient = new cachedGenAiSdk.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return {
    ai: cachedAiClient,
    ThinkingLevel: cachedGenAiSdk.ThinkingLevel,
    Type: cachedGenAiSdk.Type,
  };
}

const RECEIPT_PRIMARY_MODEL = 'gemini-4-hydrogen';
const RECEIPT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const RETRY_DELAYS_MS = [800, 1800];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractErrorInfo(err: unknown): { code: number; status: string; message: string } {
  const anyErr = err as any;
  const rawMsg = typeof anyErr?.message === 'string' ? anyErr.message : String(err || '');
  let code = Number(anyErr?.status || anyErr?.code || 0);
  let status = typeof anyErr?.statusText === 'string' ? anyErr.statusText : '';
  let message = rawMsg;

  if (rawMsg.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawMsg);
      const inner = parsed?.error || parsed;
      if (inner?.code) code = Number(inner.code);
      if (inner?.status) status = String(inner.status);
      if (inner?.message) message = String(inner.message);
    } catch {
      // keep raw message
    }
  }

  return { code, status, message };
}

function isTransientGeminiError(info: { code: number; status: string; message: string }): boolean {
  const msg = info.message.toLowerCase();
  const st = info.status.toUpperCase();
  return (
    info.code === 503 ||
    info.code === 429 ||
    info.code === 500 ||
    st === 'UNAVAILABLE' ||
    st === 'RESOURCE_EXHAUSTED' ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily')
  );
}

function mapReceiptErrorToPortuguese(info: { code: number; status: string; message: string }): {
  httpStatus: number;
  userMessage: string;
} {
  const st = info.status.toUpperCase();
  if (info.code === 503 || st === 'UNAVAILABLE') {
    return {
      httpStatus: 503,
      userMessage:
        'O serviço de leitura por IA está com alta demanda no momento. Tente novamente em alguns segundos.',
    };
  }
  if (info.code === 429 || st === 'RESOURCE_EXHAUSTED') {
    return {
      httpStatus: 429,
      userMessage:
        'Limite temporário de leituras atingido. Aguarde alguns instantes e tente novamente.',
    };
  }
  if (info.code === 403 || info.code === 401 || st === 'PERMISSION_DENIED') {
    return {
      httpStatus: 403,
      userMessage:
        'Não foi possível validar o acesso ao serviço de leitura automática no servidor.',
    };
  }
  if (info.code === 400 || st === 'INVALID_ARGUMENT') {
    return {
      httpStatus: 400,
      userMessage:
        'Não foi possível processar esta imagem. Tente enviar outra foto mais nítida da nota fiscal.',
    };
  }
  return {
    httpStatus: 500,
    userMessage: 'Não foi possível ler a nota fiscal agora. Tente novamente ou preencha manualmente.',
  };
}

/**
 * Health check endpoint to verify backend API availability & Gemini config
 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lifeedy-api',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Endpoint for AI Receipt / Nota Fiscal OCR & Financial extraction
 */
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

app.post('/api/gemini/parse-receipt', receiptRateLimiter, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'Serviço de leitura por IA não configurado no servidor.',
      });
    }

    const { imageBase64, mimeType } = (req.body || {}) as {
      imageBase64?: unknown;
      mimeType?: unknown;
    };
    if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
      return res.status(400).json({ error: 'Nenhuma imagem de nota fiscal fornecida.' });
    }

    const normalizedMime = typeof mimeType === 'string' && mimeType.trim()
      ? mimeType.toLowerCase().trim()
      : 'image/jpeg';
    if (!ALLOWED_RECEIPT_MIME_TYPES.has(normalizedMime)) {
      return res.status(400).json({
        error: 'Formato de imagem não permitido. Use JPG, PNG, WEBP ou HEIC.',
      });
    }

    // Clean potential base64 prefix and validate payload size (~12 MB binary max)
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
    if (cleanBase64.length < 32 || cleanBase64.length > 16_500_000) {
      return res.status(400).json({
        error: 'Imagem inválida ou acima do limite permitido (12 MB).',
      });
    }

    const currentYear = new Date().getFullYear();

    const imagePart = {
      inlineData: {
        mimeType: normalizedMime,
        data: cleanBase64,
      },
    };

    const textPart = {
      text: `Analise cuidadosamente esta imagem de nota fiscal, cupom fiscal (NFC-e, SAT, DANFE) ou recibo comercial.
Extraia com a máxima precisão os dados financeiros para lançamento de despesa no sistema de finanças:
1. title: Nome fantasia ou razão social do estabelecimento ou loja (ex: "Supermercado Pão de Açúcar", "Posto Ipiranga", "Farmácia Droga Raia", "Restaurante Bom Sabor").
2. amount: Valor TOTAL da nota fiscal em número decimal (ex: 149.90). Certifique-se de pegar o Total a Pagar, não o troco ou subtotais parciais.
3. date: Data da emissão da compra no formato YYYY-MM-DD. Se o ano não constar, use o ano de ${currentYear}. Se ilegível, use a data atual.
4. category: Uma das seguintes categorias de despesa: "alimentacao", "moradia", "transporte", "saude", "educacao", "lazer", "outros".
5. paymentMethod: Forma de pagamento identificada na nota: "pix", "cartao_credito", "cartao_debito", "dinheiro" ou "transferencia".
6. notes: Resumo breve dos principais itens ou produtos adquiridos.`,
    };

    const { ai, ThinkingLevel, Type } = await getGenAiRuntime();
    const callReceiptModel = async (model: string) =>
      ai.models.generateContent({
        model,
        contents: { parts: [imagePart, textPart] },
        config: {
          systemInstruction:
            'Você é um assistente especialista em leitura de documentos fiscais e extração de recibos financeiros brasileiros e internacionais. Seja preciso nos valores, datas e estabelecimentos.',
          ...(model === RECEIPT_PRIMARY_MODEL
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Nome fantasia ou estabelecimento da nota fiscal',
              },
              amount: {
                type: Type.NUMBER,
                description: 'Valor total pago na nota fiscal em formato decimal',
              },
              date: {
                type: Type.STRING,
                description: 'Data de emissão no formato YYYY-MM-DD',
              },
              category: {
                type: Type.STRING,
                description:
                  'Uma categoria entre: alimentacao, moradia, transporte, saude, educacao, lazer, outros',
              },
              paymentMethod: {
                type: Type.STRING,
                description:
                  'Forma de pagamento: pix, cartao_credito, cartao_debito, dinheiro ou transferencia',
              },
              notes: {
                type: Type.STRING,
                description: 'Resumo dos produtos ou itens comprados',
              },
            },
            required: ['title', 'amount', 'date', 'category'],
          },
        },
      });

    let response;
    let lastError: unknown = null;

    // 1. Primary model with exponential backoff retries on transient errors
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        response = await callReceiptModel(RECEIPT_PRIMARY_MODEL);
        break;
      } catch (err) {
        lastError = err;
        const info = extractErrorInfo(err);
        if (!isTransientGeminiError(info) || attempt === RETRY_DELAYS_MS.length) {
          break;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    // 2. Fallback model if primary model failed due to transient unavailability/rate limit
    if (!response && lastError) {
      const info = extractErrorInfo(lastError);
      if (isTransientGeminiError(info)) {
        try {
          response = await callReceiptModel(RECEIPT_FALLBACK_MODEL);
          lastError = null;
        } catch (fallbackErr) {
          lastError = fallbackErr;
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Falha ao obter resposta da leitura automática.');
    }

    const jsonText = response.text || '{}';
    const parsedData = JSON.parse(jsonText);
    return res.json(parsedData);
  } catch (err: unknown) {
    const info = extractErrorInfo(err);
    console.error('Erro ao ler nota fiscal com IA Gemini:', info);
    const mapped = mapReceiptErrorToPortuguese(info);
    return res.status(mapped.httpStatus).json({
      error: mapped.userMessage,
    });
  }
});

const SEFAZ_MAX_BYTES = 600 * 1024;
const SEFAZ_TIMEOUT_MS = 7500;
const CNPJ_TIMEOUT_MS = 5000;

function decodeHtmlBuffer(buffer: ArrayBuffer, contentTypeHeader: string): string {
  const bytes = new Uint8Array(buffer);
  const headerMatch = contentTypeHeader.match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i);
  let charset = headerMatch?.[1]?.toLowerCase() || '';

  if (!charset) {
    const headBytes = bytes.subarray(0, Math.min(2048, bytes.length));
    const headAscii = Buffer.from(headBytes).toString('latin1');
    const metaMatch = headAscii.match(
      /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i
    );
    if (metaMatch?.[1]) {
      charset = metaMatch[1].toLowerCase();
    }
  }

  const resolvedEncoding =
    charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252'
      ? 'windows-1252'
      : 'utf-8';

  return new TextDecoder(resolvedEncoding, { fatal: false }).decode(bytes);
}

async function fetchAllowedSefazHtmlOnce(initialUrl: string): Promise<{
  statusCode: number;
  finalUrl: string;
  html: string;
}> {
  let currentUrl = initialUrl;
  const maxRedirects = 4;
  const cookieJar = new Map<string, string>();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = isAllowedSefazUrl(currentUrl);
    if (!check.ok || !check.url) {
      throw new Error(check.error || 'URL SEFAZ não permitida.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEFAZ_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      };
      if (cookieJar.size > 0) {
        headers.Cookie = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      }

      const response = await fetch(check.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers,
      });

      const setCookies =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : response.headers.get('set-cookie')
            ? [response.headers.get('set-cookie') as string]
            : [];
      for (const rawCookie of setCookies) {
        const pair = rawCookie.split(';')[0];
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          cookieJar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
        }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === maxRedirects) {
          throw new Error('Redirecionamento excessivo ou inválido no portal da SEFAZ.');
        }
        currentUrl = new URL(location, check.url).toString();
        continue;
      }

      const rawBuffer = await response.arrayBuffer();
      const cappedBuffer =
        rawBuffer.byteLength > SEFAZ_MAX_BYTES ? rawBuffer.slice(0, SEFAZ_MAX_BYTES) : rawBuffer;
      const html = decodeHtmlBuffer(cappedBuffer, response.headers.get('content-type') || '');

      return {
        statusCode: response.status,
        finalUrl: check.url,
        html,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Não foi possível concluir a consulta no portal da SEFAZ.');
}

async function fetchAllowedSefazHtml(initialUrl: string): Promise<{
  statusCode: number;
  finalUrl: string;
  html: string;
}> {
  try {
    return await fetchAllowedSefazHtmlOnce(initialUrl);
  } catch (err) {
    if (initialUrl.startsWith('http://')) {
      const httpsAlt = initialUrl.replace(/^http:\/\//i, 'https://');
      if (isAllowedSefazUrl(httpsAlt).ok) {
        return fetchAllowedSefazHtmlOnce(httpsAlt);
      }
    }
    throw err;
  }
}

interface CnpjLookupSummary {
  nomeFantasia?: string;
  razaoSocial?: string;
  cnaeFiscalDescricao?: string;
  municipio?: string;
  uf?: string;
}

async function queryJsonWithTimeout(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CNPJ_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown>;
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCnpjReceitaFederal(cnpjDigits: string): Promise<CnpjLookupSummary | null> {
  if (!/^\d{14}$/.test(cnpjDigits)) return null;

  // 1. CNPJá Open API (fast, rich Fantasia + Razão + CNAE)
  const cnpja = await queryJsonWithTimeout(`https://open.cnpja.com/office/${cnpjDigits}`);
  if (cnpja) {
    const company = (cnpja.company || {}) as Record<string, unknown>;
    const mainActivity = (cnpja.mainActivity || {}) as Record<string, unknown>;
    const address = (cnpja.address || {}) as Record<string, unknown>;
    const nomeFantasia =
      typeof cnpja.alias === 'string' && cnpja.alias.trim() ? cnpja.alias.trim() : undefined;
    const razaoSocial =
      typeof company.name === 'string' && company.name.trim() ? company.name.trim() : undefined;
    const cnaeFiscalDescricao =
      typeof mainActivity.text === 'string' && mainActivity.text.trim()
        ? mainActivity.text.trim()
        : undefined;
    if (nomeFantasia || razaoSocial || cnaeFiscalDescricao) {
      return {
        nomeFantasia,
        razaoSocial,
        cnaeFiscalDescricao,
        municipio: typeof address.city === 'string' ? address.city : undefined,
        uf: typeof address.state === 'string' ? address.state : undefined,
      };
    }
  }

  // 2. CNPJ.ws Public API
  const cnpjWs = await queryJsonWithTimeout(`https://publica.cnpj.ws/cnpj/${cnpjDigits}`);
  if (cnpjWs) {
    const est = (cnpjWs.estabelecimento || {}) as Record<string, unknown>;
    const ativ = (est.atividade_principal || {}) as Record<string, unknown>;
    const cid = (est.cidade || {}) as Record<string, unknown>;
    const ufObj = (est.estado || {}) as Record<string, unknown>;
    const nomeFantasia =
      typeof est.nome_fantasia === 'string' && est.nome_fantasia.trim()
        ? est.nome_fantasia.trim()
        : undefined;
    const razaoSocial =
      typeof cnpjWs.razao_social === 'string' && cnpjWs.razao_social.trim()
        ? cnpjWs.razao_social.trim()
        : undefined;
    const cnaeFiscalDescricao =
      typeof ativ.descricao === 'string' && ativ.descricao.trim()
        ? ativ.descricao.trim()
        : undefined;
    if (nomeFantasia || razaoSocial || cnaeFiscalDescricao) {
      return {
        nomeFantasia,
        razaoSocial,
        cnaeFiscalDescricao,
        municipio: typeof cid.nome === 'string' ? cid.nome : undefined,
        uf: typeof ufObj.sigla === 'string' ? ufObj.sigla : undefined,
      };
    }
  }

  // 3. ReceitaWS Public API
  const receitaWs = await queryJsonWithTimeout(`https://receitaws.com.br/v1/cnpj/${cnpjDigits}`);
  if (receitaWs && receitaWs.status !== 'ERROR') {
    const atividades = Array.isArray(receitaWs.atividade_principal)
      ? (receitaWs.atividade_principal as Array<Record<string, unknown>>)
      : [];
    const nomeFantasia =
      typeof receitaWs.fantasia === 'string' && receitaWs.fantasia.trim()
        ? receitaWs.fantasia.trim()
        : undefined;
    const razaoSocial =
      typeof receitaWs.nome === 'string' && receitaWs.nome.trim()
        ? receitaWs.nome.trim()
        : undefined;
    const cnaeFiscalDescricao =
      typeof atividades[0]?.text === 'string' && atividades[0].text.trim()
        ? atividades[0].text.trim()
        : undefined;
    if (nomeFantasia || razaoSocial || cnaeFiscalDescricao) {
      return {
        nomeFantasia,
        razaoSocial,
        cnaeFiscalDescricao,
        municipio: typeof receitaWs.municipio === 'string' ? receitaWs.municipio : undefined,
        uf: typeof receitaWs.uf === 'string' ? receitaWs.uf : undefined,
      };
    }
  }

  // 4. BrasilAPI fallback
  const brasilApi = await queryJsonWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
  if (brasilApi) {
    const nomeFantasia =
      typeof brasilApi.nome_fantasia === 'string' && brasilApi.nome_fantasia.trim()
        ? brasilApi.nome_fantasia.trim()
        : undefined;
    const razaoSocial =
      typeof brasilApi.razao_social === 'string' && brasilApi.razao_social.trim()
        ? brasilApi.razao_social.trim()
        : undefined;
    const cnaeFiscalDescricao =
      typeof brasilApi.cnae_fiscal_descricao === 'string' && brasilApi.cnae_fiscal_descricao.trim()
        ? brasilApi.cnae_fiscal_descricao.trim()
        : undefined;
    if (nomeFantasia || razaoSocial || cnaeFiscalDescricao) {
      return {
        nomeFantasia,
        razaoSocial,
        cnaeFiscalDescricao,
        municipio: typeof brasilApi.municipio === 'string' ? brasilApi.municipio : undefined,
        uf: typeof brasilApi.uf === 'string' ? brasilApi.uf : undefined,
      };
    }
  }

  return null;
}

function getServerLocalDateIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

app.post('/api/nfce/consultar', nfceRateLimiter, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      qrUrl?: unknown;
      accessKey?: unknown;
    };
    const rawQrUrl = typeof body.qrUrl === 'string' ? body.qrUrl.trim() : '';
    const rawAccessKey = typeof body.accessKey === 'string' ? body.accessKey.trim() : '';
    const rawInput = rawQrUrl || rawAccessKey;

    if (!rawInput) {
      return res.status(400).json({
        error: 'Informe a URL do QR Code da nota fiscal ou a chave de acesso de 44 dígitos.',
      });
    }

    if (rawQrUrl && /^https?:\/\//i.test(rawQrUrl)) {
      const urlCheck = isAllowedSefazUrl(rawQrUrl);
      if (!urlCheck.ok) {
        return res.status(400).json({ error: urlCheck.error });
      }
    }

    const extracted = extractNfceKeyOrUrl(rawInput);
    if (!extracted.sefazUrl && !extracted.accessKey) {
      return res.status(400).json({
        error:
          'QR Code ou chave inválida. Use um QR Code oficial de NFC-e/SEFAZ (.gov.br) ou uma chave de 44 dígitos.',
      });
    }

    const preCnpjDigits = (extracted.cnpj || '').replace(/\D/g, '');
    const sefazPromise = extracted.sefazUrl
      ? fetchAllowedSefazHtml(extracted.sefazUrl).catch((err) => {
          console.warn('Falha ao consultar portal SEFAZ:', err instanceof Error ? err.message : err);
          return null;
        })
      : Promise.resolve(null);

    const preCnpjPromise =
      preCnpjDigits.length === 14 ? fetchCnpjReceitaFederal(preCnpjDigits) : Promise.resolve(null);

    const [sefazHtmlResult, preCnpjData] = await Promise.all([sefazPromise, preCnpjPromise]);

    let parsedHtml: ReturnType<typeof parseSefazHtmlToReceipt> | null = null;
    if (
      sefazHtmlResult &&
      sefazHtmlResult.statusCode >= 200 &&
      sefazHtmlResult.statusCode < 400 &&
      sefazHtmlResult.html
    ) {
      parsedHtml = parseSefazHtmlToReceipt(sefazHtmlResult.html, extracted.qrParsed);
    }

    const cnpjFormatted = parsedHtml?.cnpj || extracted.cnpj || '';
    const cnpjDigits = cnpjFormatted.replace(/\D/g, '');

    let cnpjData = preCnpjData;
    if (!cnpjData && cnpjDigits.length === 14 && cnpjDigits !== preCnpjDigits) {
      cnpjData = await fetchCnpjReceitaFederal(cnpjDigits);
    }

    const resolvedTitle =
      parsedHtml?.title ||
      cnpjData?.nomeFantasia ||
      cnpjData?.razaoSocial ||
      (cnpjFormatted ? `Estabelecimento ${cnpjFormatted}` : 'Compra Nota Fiscal (NFC-e)');

    const resolvedAmount = parsedHtml?.amount ?? extracted.qrParsed?.amount ?? 0;
    const resolvedDate =
      parsedHtml?.date || extracted.qrParsed?.date || getServerLocalDateIso();
    const resolvedPayment = parsedHtml?.paymentMethod || 'cartao_credito';
    const resolvedItems = parsedHtml?.items || [];

    const categoryHint = [
      resolvedTitle,
      cnpjData?.cnaeFiscalDescricao || '',
      ...resolvedItems,
    ]
      .filter(Boolean)
      .join(' ');
    const resolvedCategory = inferCategoryFromTextAndCnae(categoryHint);

    const noteParts: string[] = [];
    if (resolvedItems.length > 0) {
      noteParts.push(`Itens: ${resolvedItems.join(', ')}`);
    }
    if (cnpjData?.cnaeFiscalDescricao) {
      noteParts.push(`Atividade: ${cnpjData.cnaeFiscalDescricao}`);
    }
    if (cnpjFormatted) {
      noteParts.push(`CNPJ: ${cnpjFormatted}`);
    }
    if (extracted.accessKey) {
      noteParts.push(
        `Chave: ${extracted.accessKey.slice(0, 8)}…${extracted.accessKey.slice(-6)}`
      );
    }

    const captchaBlocked = Boolean(parsedHtml?.captchaBlocked);
    const hasFullSefaz = Boolean(
      parsedHtml && !captchaBlocked && (parsedHtml.title || resolvedItems.length > 0 || (parsedHtml.amount ?? 0) > 0)
    );

    const sourceStatus = hasFullSefaz
      ? 'sefaz_full'
      : cnpjData && (extracted.sefazUrl || parsedHtml)
        ? 'sefaz_partial_cnpj'
        : cnpjData
          ? 'cnpj_only'
          : 'qr_offline';

    return res.json({
      title: resolvedTitle,
      amount: resolvedAmount,
      date: resolvedDate,
      category: resolvedCategory,
      paymentMethod: resolvedPayment,
      notes: noteParts.join(' • '),
      accessKey: extracted.accessKey,
      cnpj: cnpjFormatted || undefined,
      items: resolvedItems,
      sefazUrl: sefazHtmlResult?.finalUrl || extracted.sefazUrl,
      captchaBlocked,
      sourceStatus,
      cnaeDescription: cnpjData?.cnaeFiscalDescricao,
    });
  } catch (err) {
    console.error('Erro inesperado na consulta NFC-e:', err);
    return res.status(500).json({
      error: 'Não foi possível consultar os dados da nota fiscal na Receita Federal/SEFAZ agora.',
    });
  }
});

interface SanitizedDiagnosticReport {
  reportId: string;
  receivedAt: string;
  appVersion: string;
  buildNumber: number;
  distributionChannel: string;
  platform: string;
  userNote: string;
  errorCount: number;
}

const recentDiagnosticReports: SanitizedDiagnosticReport[] = [];

function sanitizeServerLogString(raw: unknown, maxLen: number): string {
  return String(raw || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(ya29\.[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AIza[A-Za-z0-9_-]+)\b/g, '[TOKEN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .slice(0, maxLen);
}

app.post('/api/diagnostics/report', diagnosticsRateLimiter, (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const recentErrors = Array.isArray(body.recentErrors) ? body.recentErrors.slice(0, 25) : [];
    const reportId = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const receivedAt = new Date().toISOString();

    const record: SanitizedDiagnosticReport = {
      reportId,
      receivedAt,
      appVersion: sanitizeServerLogString(body.appVersion || 'unknown', 32),
      buildNumber: Number.isFinite(Number(body.buildNumber)) ? Number(body.buildNumber) : 0,
      distributionChannel: sanitizeServerLogString(body.distributionChannel || 'web', 32),
      platform: sanitizeServerLogString(body.platform || 'web', 32),
      userNote: sanitizeServerLogString(body.userNote || '', 400),
      errorCount: recentErrors.length,
    };

    recentDiagnosticReports.unshift(record);
    if (recentDiagnosticReports.length > 50) {
      recentDiagnosticReports.length = 50;
    }

    return res.status(201).json({
      ok: true,
      reportId,
      receivedAt,
    });
  } catch (err) {
    console.error('Erro ao registrar relatório de diagnóstico:', err);
    return res.status(500).json({ error: 'Não foi possível registrar o diagnóstico.' });
  }
});

app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Rota de API não encontrada.' });
});

let viteServerPromise: Promise<ViteDevServer> | null = null;
function getViteServer(): Promise<ViteDevServer> {
  if (!viteServerPromise) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    viteServerPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : undefined,
        ws: hmrDisabled ? false : undefined,
      },
      appType: 'spa',
    });
  }
  return viteServerPromise;
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    app.use(async (req, res, next) => {
      try {
        const vite = await getViteServer();
        vite.middlewares(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    app.use('*', async (req, res, next) => {
      try {
        const vite = await getViteServer();
        const url = req.originalUrl;
        const htmlPath = path.resolve(__dirname, 'index.html');
        if (fs.existsSync(htmlPath)) {
          let template = fs.readFileSync(htmlPath, 'utf-8');
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
          return;
        }
        next();
      } catch (e) {
        next(e);
      }
    });
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      // Pre-warm Vite right after the HTTP port is bound so readiness checks pass immediately
      setImmediate(() => {
        void getViteServer().catch((err) => {
          console.error('Erro ao inicializar Vite dev middleware:', err);
        });
      });
    }
  });

  httpServer.on('error', (err) => {
    console.error(`HTTP server listen error on ${HOST}:${PORT}:`, err);
    process.exit(1);
  });
}

startServer();
