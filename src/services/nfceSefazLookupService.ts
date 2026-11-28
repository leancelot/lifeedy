import { Capacitor } from '@capacitor/core';
import { getConfiguredAppServerUrl } from '../utils/appServerUrl';
import { formatLocalDateIso } from '../utils/dateUtils';
import {
  extractNfceKeyOrUrl,
  inferCategoryFromTextAndCnae,
  isAllowedSefazUrl,
  NfceParsedReceipt,
  parseNfceQrMetadata,
  parseSefazHtmlToReceipt,
} from './nfceSefazParser';
import {
  fetchSefazQrPageNative,
  isNativeAndroidOcrAvailable,
} from './offlineReceiptOcr';

const SERVER_LOOKUP_TIMEOUT_MS = 12000;
const CLIENT_CNPJ_TIMEOUT_MS = 5500;

interface CnpjSummary {
  nomeFantasia?: string;
  razaoSocial?: string;
  cnaeFiscalDescricao?: string;
}

async function fetchJsonSafe(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_CNPJ_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCnpjReceitaClient(cnpjDigits: string): Promise<CnpjSummary | null> {
  if (!/^\d{14}$/.test(cnpjDigits)) return null;

  // 1. CNPJá Open API (supports CORS *)
  const cnpja = await fetchJsonSafe(`https://open.cnpja.com/office/${cnpjDigits}`);
  if (cnpja) {
    const company = (cnpja.company || {}) as Record<string, unknown>;
    const mainActivity = (cnpja.mainActivity || {}) as Record<string, unknown>;
    const nomeFantasia =
      typeof cnpja.alias === 'string' && cnpja.alias.trim() ? cnpja.alias.trim() : undefined;
    const razaoSocial =
      typeof company.name === 'string' && company.name.trim() ? company.name.trim() : undefined;
    const cnaeFiscalDescricao =
      typeof mainActivity.text === 'string' && mainActivity.text.trim()
        ? mainActivity.text.trim()
        : undefined;
    if (nomeFantasia || razaoSocial || cnaeFiscalDescricao) {
      return { nomeFantasia, razaoSocial, cnaeFiscalDescricao };
    }
  }

  // 2. CNPJ.ws Public API (supports CORS)
  const cnpjWs = await fetchJsonSafe(`https://publica.cnpj.ws/cnpj/${cnpjDigits}`);
  if (cnpjWs) {
    const est = (cnpjWs.estabelecimento || {}) as Record<string, unknown>;
    const ativ = (est.atividade_principal || {}) as Record<string, unknown>;
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
      return { nomeFantasia, razaoSocial, cnaeFiscalDescricao };
    }
  }

  // 3. BrasilAPI fallback
  const brasilApi = await fetchJsonSafe(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
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
      return { nomeFantasia, razaoSocial, cnaeFiscalDescricao };
    }
  }

  return null;
}

function buildLocalFallbackReceipt(
  extracted: ReturnType<typeof extractNfceKeyOrUrl>,
  parsedHtml: ReturnType<typeof parseSefazHtmlToReceipt> | null,
  cnpjData: CnpjSummary | null,
  finalSefazUrl?: string
): NfceParsedReceipt {
  const cnpjFormatted = parsedHtml?.cnpj || extracted.cnpj || '';
  const resolvedTitle =
    parsedHtml?.title ||
    cnpjData?.nomeFantasia ||
    cnpjData?.razaoSocial ||
    (cnpjFormatted ? `Estabelecimento ${cnpjFormatted}` : 'Compra Nota Fiscal (NFC-e)');

  const resolvedAmount = parsedHtml?.amount ?? extracted.qrParsed?.amount ?? 0;
  const resolvedDate =
    parsedHtml?.date || extracted.qrParsed?.date || formatLocalDateIso();
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
    parsedHtml &&
      !captchaBlocked &&
      (parsedHtml.title || resolvedItems.length > 0 || (parsedHtml.amount ?? 0) > 0)
  );

  const sourceStatus: NfceParsedReceipt['sourceStatus'] = hasFullSefaz
    ? 'sefaz_full'
    : cnpjData && (finalSefazUrl || parsedHtml)
      ? 'sefaz_partial_cnpj'
      : cnpjData
        ? 'cnpj_only'
        : 'qr_offline';

  return {
    title: resolvedTitle,
    amount: resolvedAmount,
    date: resolvedDate,
    category: resolvedCategory,
    paymentMethod: resolvedPayment,
    notes: noteParts.join(' • '),
    accessKey: extracted.accessKey,
    cnpj: cnpjFormatted || undefined,
    items: resolvedItems,
    sefazUrl: finalSefazUrl || extracted.sefazUrl,
    captchaBlocked,
    sourceStatus,
    cnaeDescription: cnpjData?.cnaeFiscalDescricao,
  };
}

export async function lookupNfceFromQrOrKey(rawInput: string): Promise<NfceParsedReceipt> {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    throw new Error('Nenhum QR Code ou chave de acesso foi informado.');
  }

  // 1. Direct Pix EMV QR Code support
  const quickMeta = parseNfceQrMetadata(trimmed);
  if (quickMeta?.kind === 'pix') {
    const title = quickMeta.title || 'Pagamento via Pix QR';
    return {
      title,
      amount: quickMeta.amount ?? 0,
      date: formatLocalDateIso(),
      category: inferCategoryFromTextAndCnae(title),
      paymentMethod: 'pix',
      notes: quickMeta.notes || 'Pagamento via QR Code Pix',
      items: [],
      captchaBlocked: false,
      sourceStatus: 'pix_qr',
    };
  }

  // 2. Validate NFC-e URL or 44-digit access key
  const extracted = extractNfceKeyOrUrl(trimmed);
  if (/^https?:\/\//i.test(trimmed) && !extracted.sefazUrl) {
    const urlValidation = isAllowedSefazUrl(trimmed);
    throw new Error(
      urlValidation.error ||
        'Este QR Code não aponta para um portal oficial da SEFAZ / Receita Federal (.gov.br).'
    );
  }

  if (!extracted.sefazUrl && !extracted.accessKey) {
    throw new Error(
      'QR Code não reconhecido como Nota Fiscal (NFC-e) nem Pix. Confira o código e tente novamente.'
    );
  }

  // 3. Try backend API when web origin or configured remote server is available
  const isNativeContainer =
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' &&
      (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:'));
  const configuredBaseUrl = getConfiguredAppServerUrl();
  const hasRemoteServer = Boolean(configuredBaseUrl) || !isNativeContainer;

  let serverPayload: NfceParsedReceipt | null = null;

  if (hasRemoteServer) {
    const endpoint = configuredBaseUrl
      ? `${configuredBaseUrl}/api/nfce/consultar`
      : '/api/nfce/consultar';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrUrl: extracted.sefazUrl,
          accessKey: extracted.accessKey,
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('application/json')) {
        serverPayload = (await response.json()) as NfceParsedReceipt;
        if (serverPayload.sourceStatus === 'sefaz_full') {
          return serverPayload;
        }
      } else if (response.status === 400 && contentType.includes('application/json')) {
        const errPayload = (await response.json().catch(() => ({}))) as { error?: string };
        if (errPayload.error) {
          throw new Error(errPayload.error);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('QR Code ou chave inválida')) {
        throw err;
      }
      // Fall through to native / client fallback
    } finally {
      clearTimeout(timer);
    }
  }

  // 4. Native Android SEFAZ direct fetch (device Brazilian IP bypasses cloud geo-blocking!)
  let parsedHtml: ReturnType<typeof parseSefazHtmlToReceipt> | null = null;
  let finalSefazUrl = serverPayload?.sefazUrl || extracted.sefazUrl;

  if (extracted.sefazUrl && isNativeAndroidOcrAvailable()) {
    try {
      const nativeRes = await fetchSefazQrPageNative(extracted.sefazUrl);
      if (nativeRes && nativeRes.statusCode >= 200 && nativeRes.statusCode < 400 && nativeRes.html) {
        finalSefazUrl = nativeRes.finalUrl || extracted.sefazUrl;
        parsedHtml = parseSefazHtmlToReceipt(nativeRes.html, extracted.qrParsed);
      }
    } catch {
      // Proceed to CNPJ fallback
    }
  }

  // 5. If server already resolved CNPJ data and native SEFAZ didn't give full receipt, return server payload
  const cnpjDigits = (parsedHtml?.cnpj || serverPayload?.cnpj || extracted.cnpj || '').replace(/\D/g, '');
  const needClientCnpj =
    cnpjDigits.length === 14 &&
    (!parsedHtml?.title || parsedHtml.captchaBlocked || parsedHtml.items.length === 0) &&
    (!serverPayload || serverPayload.sourceStatus === 'qr_offline');

  const clientCnpjData = needClientCnpj ? await fetchCnpjReceitaClient(cnpjDigits) : null;

  if (parsedHtml && (!parsedHtml.captchaBlocked && (parsedHtml.title || parsedHtml.items.length > 0 || (parsedHtml.amount ?? 0) > 0))) {
    return buildLocalFallbackReceipt(extracted, parsedHtml, clientCnpjData, finalSefazUrl);
  }

  if (serverPayload && serverPayload.sourceStatus !== 'qr_offline' && !clientCnpjData) {
    return serverPayload;
  }

  if (serverPayload && serverPayload.sourceStatus !== 'qr_offline' && parsedHtml?.captchaBlocked) {
    return {
      ...serverPayload,
      captchaBlocked: true,
      sefazUrl: finalSefazUrl,
    };
  }

  return buildLocalFallbackReceipt(extracted, parsedHtml, clientCnpjData, finalSefazUrl);
}
