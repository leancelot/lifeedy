import type { FinanceCategory, Transaction } from '../types/index.ts';

export interface ParsedQrMetadata {
  kind: 'nfce' | 'pix';
  accessKey?: string;
  cnpj?: string;
  title?: string;
  amount?: number;
  date?: string;
  paymentMethod?: NonNullable<Transaction['paymentMethod']>;
  notes?: string;
}

export interface NfceParsedReceipt {
  title: string;
  amount: number;
  date: string;
  category: FinanceCategory;
  paymentMethod: NonNullable<Transaction['paymentMethod']>;
  notes: string;
  accessKey?: string;
  cnpj?: string;
  items: string[];
  sefazUrl?: string;
  captchaBlocked: boolean;
  sourceStatus: 'sefaz_full' | 'sefaz_partial_cnpj' | 'cnpj_only' | 'qr_offline' | 'pix_qr';
  cnaeDescription?: string;
}

const ALLOWED_GOV_FISCAL_HOST_REGEX =
  /^(?:[a-z0-9-]+\.)+(?:fazenda|sefaz|sefa|sefin|sef|economia|receita|nfce|nfe|satsp|svrs|svr)[a-z0-9.-]*\.gov\.br$/i;

const GENERIC_GOV_BR_REGEX = /^[a-z0-9.-]+\.gov\.br$/i;

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower) ||
    lower.includes(':')
  );
}

export function formatCnpjString(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.length !== 14) return digits;
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(
    8,
    12
  )}-${clean.slice(12)}`;
}

export function parsePixEmvQrMetadata(raw: string): ParsedQrMetadata | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('000201')) return null;

  const tags = new Map<string, string>();
  let idx = 0;
  while (idx + 4 <= trimmed.length) {
    const id = trimmed.slice(idx, idx + 2);
    const len = Number.parseInt(trimmed.slice(idx + 2, idx + 4), 10);
    if (!Number.isFinite(len) || len < 0 || idx + 4 + len > trimmed.length) break;
    const val = trimmed.slice(idx + 4, idx + 4 + len);
    tags.set(id, val);
    idx += 4 + len;
  }

  const merchantInfo = tags.get('26') || '';
  const isPixPayload =
    merchantInfo.toLowerCase().includes('br.gov.bcb.pix') || tags.get('53') === '986';
  if (!isPixPayload) return null;

  const rawAmount = tags.get('54');
  const amount = rawAmount ? Number.parseFloat(rawAmount) : undefined;
  const merchantName = tags.get('59')?.trim();
  const merchantCity = tags.get('60')?.trim();

  return {
    kind: 'pix',
    title: merchantName || 'Pagamento via Pix QR',
    amount: amount && Number.isFinite(amount) && amount > 0 ? amount : undefined,
    paymentMethod: 'pix',
    notes: [merchantName, merchantCity].filter(Boolean).join(' • ') || 'QR Code Pix lido',
  };
}

export function parseNfceQrMetadata(rawQr: string): ParsedQrMetadata | null {
  const trimmed = String(rawQr || '').trim();
  if (!trimmed) return null;

  const pixParsed = parsePixEmvQrMetadata(trimmed);
  if (pixParsed) return pixParsed;

  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  const looksLikeNfce =
    /nfce|nfe|sefaz|fazenda|sat|p=\d{44}|chNFe=\d{44}/i.test(trimmed) ||
    /^\d{44}$/.test(trimmed) ||
    (/^\d{44}$/.test(digitsOnly) && !/http/i.test(trimmed));
  if (!looksLikeNfce) return null;

  const keyMatch = trimmed.match(/(\d{44})/) || (digitsOnly.length === 44 ? [digitsOnly, digitsOnly] : null);
  const accessKey = keyMatch ? keyMatch[1] : undefined;

  let cnpj: string | undefined;
  let inferredMonthPrefix: string | undefined;
  if (accessKey) {
    const yy = Number.parseInt(accessKey.slice(2, 4), 10);
    const mm = Number.parseInt(accessKey.slice(4, 6), 10);
    const rawCnpj = accessKey.slice(6, 20);
    cnpj = formatCnpjString(rawCnpj);
    if (yy >= 20 && yy <= 35 && mm >= 1 && mm <= 12) {
      inferredMonthPrefix = `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}`;
    }
  }

  let amount: number | undefined;
  let date: string | undefined;

  try {
    const urlObj = new URL(trimmed);
    const vNf = urlObj.searchParams.get('vNF') || urlObj.searchParams.get('vNf');
    if (vNf) {
      const parsedVal = Number.parseFloat(vNf.replace(',', '.'));
      if (Number.isFinite(parsedVal) && parsedVal > 0 && parsedVal <= 500000) {
        amount = Math.round(parsedVal * 100) / 100;
      }
    }

    const dhEmi = urlObj.searchParams.get('dhEmi');
    if (dhEmi) {
      let decoded = dhEmi;
      if (/^[0-9a-fA-F]+$/.test(dhEmi) && dhEmi.length >= 20) {
        try {
          const pairs = dhEmi.match(/.{1,2}/g) || [];
          decoded = pairs.map((hex) => String.fromCharCode(parseInt(hex, 16))).join('');
        } catch {
          decoded = dhEmi;
        }
      }
      const isoDateMatch = decoded.match(/(202\d|203[0-5])-(\d{2})-(\d{2})/);
      if (isoDateMatch) {
        date = `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
      }
    }

    const pParam = urlObj.searchParams.get('p');
    if (!amount && pParam) {
      const parts = pParam.split('|');
      for (const token of parts.slice(3)) {
        if (/^\d+\.\d{2}$/.test(token)) {
          const val = Number.parseFloat(token);
          if (Number.isFinite(val) && val > 0 && val <= 500000) {
            amount = val;
            break;
          }
        }
      }
    }
  } catch {
    // Non-URL raw key or malformed query string
  }

  const noteParts = ['NFC-e QR Code'];
  if (cnpj) noteParts.push(`CNPJ ${cnpj}`);
  if (inferredMonthPrefix && !date) noteParts.push(`Emissão ${inferredMonthPrefix}`);
  if (accessKey) noteParts.push(`Chave ${accessKey.slice(0, 8)}…${accessKey.slice(-6)}`);

  return {
    kind: 'nfce',
    accessKey,
    cnpj,
    amount,
    date,
    notes: noteParts.join(' • '),
  };
}

export function isAllowedSefazUrl(rawUrl: string): { ok: boolean; url?: string; error?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'URL do QR Code da nota vazia.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Formato de URL da NFC-e inválido.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Protocolo inválido para consulta da nota fiscal.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL inválida: credenciais embutidas não são permitidas.' };
  }

  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { ok: false, error: 'Porta não permitida para consulta SEFAZ.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLocalHostname(hostname)) {
    return { ok: false, error: 'Endereço interno ou privado bloqueado.' };
  }

  const isFiscalGovBr =
    ALLOWED_GOV_FISCAL_HOST_REGEX.test(hostname) ||
    (GENERIC_GOV_BR_REGEX.test(hostname) && /nfce|nfe|sefaz|fazenda|sat/i.test(trimmed));

  if (!isFiscalGovBr) {
    return {
      ok: false,
      error: 'Apenas URLs oficiais dos portais da Fazenda / SEFAZ (.gov.br) são permitidas.',
    };
  }

  return { ok: true, url: parsed.toString() };
}

export function extractNfceKeyOrUrl(rawInput: string): {
  raw: string;
  sefazUrl?: string;
  accessKey?: string;
  cnpj?: string;
  qrParsed: ParsedQrMetadata | null;
} {
  const trimmed = String(rawInput || '').trim();
  const digitsOnly = trimmed.replace(/[^\d]/g, '');

  const qrParsed = parseNfceQrMetadata(trimmed);
  const sefazCheck = isAllowedSefazUrl(trimmed);
  const accessKey =
    qrParsed?.accessKey || (/^\d{44}$/.test(digitsOnly) ? digitsOnly : undefined);
  const cnpj =
    qrParsed?.cnpj || (accessKey ? formatCnpjString(accessKey.slice(6, 20)) : undefined);

  return {
    raw: trimmed,
    sefazUrl: sefazCheck.ok ? sefazCheck.url : undefined,
    accessKey,
    cnpj,
    qrParsed,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code < 65536 ? String.fromCharCode(code) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 65536 ? String.fromCharCode(code) : ' ';
    });
}

function stripTagsToText(htmlFragment: string): string {
  return decodeHtmlEntities(
    htmlFragment
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(?:span|td|div|li|p)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBrCurrency(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }

  const val = Number.parseFloat(normalized);
  if (!Number.isFinite(val) || val <= 0 || val > 500000) return null;
  return Math.round(val * 100) / 100;
}

export function inferCategoryFromTextAndCnae(text: string): FinanceCategory {
  const lower = text.toLowerCase();
  if (
    /\b(?:supermercado|hipermercado|minimercado|atacad|mercearia|padaria|panificadora|a[cç]ougue|carne|frigor[ií]fico|frios|latic[ií]nio|bebida|doce|hortifruti|restaurante|lanchonete|cafeteria|bar\b|pizzaria|aliment|produtos\s+aliment[ií]cios|carrefour|assa[ií]|extra|p[aã]o\s+de\s+a[cç][uú]car)/i.test(
      lower
    )
  ) {
    return 'alimentacao';
  }
  if (
    /\b(?:combust[ií]ve|gasolina|etanol|posto|estacionamento|transporte|autope[cç]as|oficina|ped[aá]gio|uber|shell|ipiranga|petrobras|ve[ií]culo)/i.test(
      lower
    )
  ) {
    return 'transporte';
  }
  if (
    /\b(?:farm[aá]c|drogaria|m[eé]dic|odont|hospital|cl[ií]nica|laborat[oó]rio|produtos\s+farmac[eê]utic|[oó]tica|sa[uú]de)/i.test(
      lower
    )
  ) {
    return 'saude';
  }
  if (
    /\b(?:material\s+de\s+constru[cç][aã]o|materiais\s+de\s+constru[cç][aã]o|ferragens|madeireira|energia|el[eé]trica|saneamento|internet|telecomunica[cç][oõ]es|aluguel|condom[ií]nio|m[oó]veis|eletrodom[eé]stic)/i.test(
      lower
    )
  ) {
    return 'moradia';
  }
  if (/\b(?:papelaria|livraria|livro|escola|ensino|educa[cç][aã]o|curso|faculdade)/i.test(lower)) {
    return 'educacao';
  }
  if (
    /\b(?:cinema|ingresso|teatro|entretenimento|hotel|hospedagem|brinqued|esporte|vestu[aá]rio|pet\s*shop|animais)/i.test(
      lower
    )
  ) {
    return 'lazer';
  }
  return 'outros';
}

export function extractNfceFallbackFromOcrText(ocrText: string): {
  accessKey?: string;
  cnpj?: string;
} {
  const raw = String(ocrText || '');
  if (!raw.trim()) return {};

  // Match 44-digit NFC-e/NF-e key formatted in groups of 4 digits or contiguous
  const spacedKeyMatch = raw.match(/(?:\d{4}[\s.-]?){10}\d{4}/);
  let accessKey: string | undefined;
  if (spacedKeyMatch) {
    const clean = spacedKeyMatch[0].replace(/\D/g, '');
    if (clean.length === 44) {
      accessKey = clean;
    }
  }

  let cnpj: string | undefined;
  const cnpjMatch = raw.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
  if (cnpjMatch) {
    cnpj = cnpjMatch[1];
  } else if (accessKey) {
    cnpj = formatCnpjString(accessKey.slice(6, 20));
  }

  return { accessKey, cnpj };
}

export function inferPaymentMethodFromText(
  text: string
): NonNullable<Transaction['paymentMethod']> {
  if (/\bpix\b/i.test(text)) return 'pix';
  if (/cart[aã]o\s*(?:de\s*)?d[eé]bito|\bd[eé]bito\b/i.test(text)) return 'cartao_debito';
  if (/cart[aã]o\s*(?:de\s*)?cr[eé]dito|\bcr[eé]dito\b/i.test(text)) return 'cartao_credito';
  if (/\bdinheiro\b|\besp[eé]cie\b/i.test(text)) return 'dinheiro';
  if (/\btransfer[eê]ncia\b/i.test(text)) return 'transferencia';
  return 'cartao_credito';
}

export function parseSefazHtmlToReceipt(
  html: string,
  fallbackQr?: ParsedQrMetadata | null
): {
  title?: string;
  cnpj?: string;
  amount?: number;
  date?: string;
  paymentMethod?: NonNullable<Transaction['paymentMethod']>;
  items: string[];
  captchaBlocked: boolean;
} {
  const rawHtml = String(html || '');
  const captchaBlocked =
    /(?:g-recaptcha|h-captcha|hcaptcha|cf-turnstile|nao sou um robo|não sou um robô|digite os caracteres da imagem|valide o captcha)/i.test(
      rawHtml
    );

  // Extract items (<span class="txtTit">...</span> or <td class="txtTit">...)
  const items: string[] = [];
  const itemMatches = [
    ...rawHtml.matchAll(/<(?:span|td)[^>]*class="[^"]*\btxtTit\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|td)>/gi),
  ];
  for (const m of itemMatches) {
    const itemName = stripTagsToText(m[1]).replace(/\s*\(C[oó]digo:.*$/i, '').trim();
    if (itemName && itemName.length >= 2 && !items.includes(itemName)) {
      items.push(itemName.slice(0, 60));
    }
    if (items.length >= 8) break;
  }

  // Extract store title from common SEFAZ elements
  let title: string | undefined;
  const titlePatterns: RegExp[] = [
    /<div[^>]*id="u20"[^>]*class="[^"]*\btxtTopo\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*\btxtTopo\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*id="[^"]*(?:Emitente|Razao|Nome)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<td[^>]*class="[^"]*\bNF-e\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i,
  ];
  for (const pat of titlePatterns) {
    const match = rawHtml.match(pat);
    if (match?.[1]) {
      const clean = stripTagsToText(match[1]);
      if (
        clean.length >= 3 &&
        clean.length <= 100 &&
        !/documento auxiliar|nota fiscal|consulta|sefaz|fazenda/i.test(clean)
      ) {
        title = clean;
        break;
      }
    }
  }

  // Fallback plain-text analysis across normalized HTML text
  const plainText = decodeHtmlEntities(
    rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<\/(?:div|p|tr|li|h\d|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n');

  if (!title) {
    const beforeCnpjMatch = plainText.match(
      /([^\n]{3,80})\n[^\n]{0,30}\bCNPJ\s*:?\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/i
    );
    if (beforeCnpjMatch?.[1]) {
      const candidate = beforeCnpjMatch[1].trim();
      if (!/documento auxiliar|nota fiscal|consumidor|sefaz|fazenda|qr\s*code/i.test(candidate)) {
        title = candidate;
      }
    }
  }

  const cnpjMatch = plainText.match(/\bCNPJ\s*:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/i);
  const cnpj = cnpjMatch?.[1] || fallbackQr?.cnpj;

  // Total Value patterns
  let amount: number | undefined;
  const htmlAmountPatterns: RegExp[] = [
    /Valor\s*a\s*pagar\s*R?\$?\s*:?[\s\S]{0,160}?(?:class="[^"]*\btotalNumb\b[^"]*"[^>]*>)?\s*([\d.]+,\d{2})/i,
    /Valor\s*total\s*R?\$?\s*:?[\s\S]{0,160}?(?:class="[^"]*\btotalNumb\b[^"]*"[^>]*>)?\s*([\d.]+,\d{2})/i,
    /<span[^>]*class="[^"]*\btotalNumb\b[^"]*\btotalMax\b[^"]*"[^>]*>\s*([\d.,]+)\s*<\/span>/i,
    /<span[^>]*class="[^"]*\btotalNumb\b[^"]*"[^>]*>\s*([\d.]+,\d{2})\s*<\/span>/i,
  ];
  for (const pat of htmlAmountPatterns) {
    const m = rawHtml.match(pat);
    if (m?.[1]) {
      const parsed = parseBrCurrency(m[1]);
      if (parsed !== null) {
        amount = parsed;
        break;
      }
    }
  }
  if (!amount) {
    const plainAmountMatch = plainText.match(
      /(?:Valor\s*a\s*pagar|Valor\s*total\s*da\s*nota|Total\s*da\s*NFC-e)\s*R?\$?\s*:?\s*([\d.]+,\d{2})/i
    );
    if (plainAmountMatch?.[1]) {
      const parsed = parseBrCurrency(plainAmountMatch[1]);
      if (parsed !== null) amount = parsed;
    }
  }
  if (!amount && fallbackQr?.amount) {
    amount = fallbackQr.amount;
  }

  // Date patterns
  let date = fallbackQr?.date;
  const datePatterns: RegExp[] = [
    /(?:Emiss[aã]o|Data\s*de\s*Emiss[aã]o|Emitida\s*em)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i,
    /\b(\d{2})\/(\d{2})\/(202\d|203[0-5])\s+\d{2}:\d{2}/,
  ];
  for (const pat of datePatterns) {
    const m = plainText.match(pat);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = Number(m[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
        date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        break;
      }
    }
  }

  const paymentMethod = inferPaymentMethodFromText(plainText);

  return {
    title,
    cnpj,
    amount,
    date,
    paymentMethod,
    items,
    captchaBlocked,
  };
}
