import {
  BankCaptureSourceKind,
  FinanceCategory,
  PendingBankNotification,
  Transaction,
  TransactionType,
} from '../types';

export interface ParseBankNotificationParams {
  rawText: string;
  title?: string;
  bankName?: string;
  timestamp?: number;
  source?: 'android' | 'manual';
  sourceKind?: BankCaptureSourceKind;
  packageName?: string;
  allowAmbiguous?: boolean;
  includeScheduledMessages?: boolean;
}

const KNOWN_BANKS: Array<{ patterns: RegExp[]; label: string }> = [
  { patterns: [/\bgoogle\s*wallet\b/i, /\bcarteira\s*do\s*google\b/i, /\bgoogle\s*pay\b/i, /\bgpay\b/i], label: 'Google Wallet' },
  { patterns: [/\bsamsung\s*wallet\b/i, /\bsamsung\s*pay\b/i], label: 'Samsung Wallet' },
  { patterns: [/\bnubank\b/i, /\bnu\s*pagamentos\b/i, /\broxinho\b/i], label: 'Nubank' },
  { patterns: [/\bbanco\s*inter\b/i, /\binter\b/i], label: 'Banco Inter' },
  { patterns: [/\bita[uú](?![A-Za-zÀ-ÿ0-9_])/i, /\bpersonnalit[eé](?![A-Za-zÀ-ÿ0-9_])/i], label: 'Itaú' },
  { patterns: [/\biti\b/i], label: 'iti Itaú' },
  { patterns: [/\bbradesco\b/i], label: 'Bradesco' },
  { patterns: [/\bsantander\b/i], label: 'Santander' },
  { patterns: [/\bbanco\s*do\s*brasil\b/i, /\bbb\b/i, /\bourocard\b/i], label: 'Banco do Brasil' },
  { patterns: [/\bcaixa\s*tem\b/i], label: 'Caixa Tem' },
  { patterns: [/\bcaixa\b/i, /\bcef\b/i], label: 'Caixa' },
  { patterns: [/\bc6\s*bank\b/i, /\bc6\b/i], label: 'C6 Bank' },
  { patterns: [/\bpicpay\b/i], label: 'PicPay' },
  { patterns: [/\bmercado\s*pago\b/i, /\bmercadopago\b/i], label: 'Mercado Pago' },
  { patterns: [/\bpagbank\b/i, /\bpagseguro\b/i], label: 'PagBank' },
  { patterns: [/\bbtg\b/i], label: 'BTG Pactual' },
  { patterns: [/\bneon\b/i], label: 'Neon' },
  { patterns: [/\bwill\s*bank\b/i], label: 'Will Bank' },
  { patterns: [/\bnext\b/i], label: 'Next' },
  { patterns: [/\bsicredi\b/i], label: 'Sicredi' },
  { patterns: [/\bsicoob\b/i], label: 'Sicoob' },
  { patterns: [/\bcora\b/i], label: 'Cora' },
  { patterns: [/\bxp\b/i], label: 'XP' },
  { patterns: [/\bstone\b/i], label: 'Stone' },
  { patterns: [/\bton\b/i], label: 'Ton' },
  { patterns: [/\bame\s*digital\b/i, /\bame\b/i], label: 'Ame Digital' },
  { patterns: [/\bbanco\s*pan\b/i], label: 'Banco Pan' },
  { patterns: [/\bsafra\b/i], label: 'Banco Safra' },
  { patterns: [/\bbanrisul\b/i], label: 'Banrisul' },
  { patterns: [/\bbrb\b/i], label: 'BRB' },
  { patterns: [/\brecargapay\b/i], label: 'RecargaPay' },
  { patterns: [/\b99pay\b/i], label: '99Pay' },
];

const ALWAYS_BLACKLIST = [
  /c[oó]digo\s*(?:de\s*)?(?:verifica[cç][aã]o|seguran[cç]a|acesso|confirma[cç][aã]o)/i,
  /\btoken\b/i,
  /\bopt-in\b|\botp\b/i,
  /limite\s*(?:dispon[ií]vel|alterado|aumentado|aprovado|emergencial)/i,
  /empr[eé]stimo\s*(?:pr[eé]-aprovado|dispon[ií]vel|liberado)/i,
  /aprova[cç][aã]o\s*em\s*2\s*etapas/i,
  /autorize\s*o\s*(?:login|acesso|dispositivo)/i,
  /clique\s*aqui\s*para\s*aproveitar/i,
  /(?:compra|transa[cç][aã]o|pagamento)\s*(?:negad[ao]|recusad[ao]|cancelad[ao]|estornad[ao]\s*por\s*falha)/i,
  /\bsaldo\s*(?:atual|dispon[ií]vel|em\s*conta)\b/i,
];

const EXECUTED_SCHEDULED_PATTERNS = [
  /(?:pix|pagamento|agendamento|d[eé]bito\s*autom[aá]tico)\s*(?:agendad[oa]\s*)?(?:realizad[oa]|efetuad[oa]|conclu[ií]d[oa]|debitad[oa]|pago)/i,
];

const SCHEDULED_PATTERNS = [
  /\bpix\s*agendad[oa]\b/i,
  /(?:pagamento|ted|doc|transfer[eê]ncia|boleto|conta|cobran[cç]a|lan[cç]amento)\s*(?:foi\s*)?(?:agendad[oa]|programad[oa]|previst[oa])/i,
  /agendament[oa]\s*(?:de\s*)?(?:pix|pagamento|transfer[eê]ncia|boleto|conta)/i,
  /d[eé]bito\s*autom[aá]tico\s*(?:agendad[oa]|programad[oa]|previst[oa])?/i,
  /fatura\s*(?:fechada|dispon[ií]vel|aberta|vence|com\s*vencimento|para\s*\d{2}\/\d{2})/i,
  /\bvence\s*(?:em|hoje|amanh[aã]|dia\s*\d{1,2})\b/i,
  /\bvencimento\s*(?:em|para|:)?\s*\d{2}\/\d{2}\b/i,
  /\bagendad[oa]\s*(?:para|em)\s*(?:\d{2}\/\d{2}|amanh[aã]|dia\s*\d{1,2})\b/i,
  /\bprogramad[oa]\s*(?:para|em)\s*(?:\d{2}\/\d{2}|amanh[aã]|dia\s*\d{1,2})\b/i,
];

const WALLET_OR_CARD_TAP_PATTERNS = [
  /\bgoogle\s*wallet\b|\bcarteira\s*do\s*google\b|\bgoogle\s*pay\b|\bgpay\b/i,
  /\bsamsung\s*wallet\b|\bsamsung\s*pay\b/i,
  /\btap\s*(?:&|and)\s*pay\b|\bpor\s*aproxima[cç][aã]o\b|\baproxima[cç][aã]o\b|\bcontactless\b/i,
  /\b(?:visa|mastercard|master|elo|amex|american\s*express|hipercard)\s*(?:[•*xX]{2,}\s*\d{4}|final\s*\d{4}|\d{4})/i,
  /\bcom\s+(?:visa|mastercard|master|elo|amex|cart[aã]o)\b/i,
];

const STRONG_TRANSACTION_VERBS = [
  /compra\s*(?:a\s*vista\s*|no\s*(?:cr[eé]dito|d[eé]bito)\s*)?(?:aprovada|realizada|efetuada)/i,
  /transa[cç][aã]o\s*(?:no\s*(?:cr[eé]dito|d[eé]bito)\s*)?aprovada/i,
  /compra\s*(?:de\s*R\$|realizada)/i,
  /pix\s*(?:recebido|enviado|realizado|transferido)/i,
  /voc[eê]\s*(?:recebeu|pagou|transferiu|enviou|comprou|gastou)/i,
  /transfer[eê]ncia\s*(?:recebida|enviada|realizada)/i,
  /pagamento\s*(?:aprovado|realizado|recebido|efetuado)/i,
  /saque\s*(?:realizado|efetuado)/i,
  /estorno\s*(?:aprovado|realizado|creditado)/i,
  /reembolso\s*(?:recebido|creditado)/i,
];

const INCOME_KEYWORDS = [
  /\brecebeu\b/i,
  /\brecebido\b/i,
  /\brecebida\b/i,
  /cr[eé]dito\s*em\s*conta/i,
  /\bestorno\b/i,
  /\breembolso\b/i,
  /\brendimento\b/i,
  /\bdividendo\b/i,
  /\bsal[aá]rio\b/i,
  /dep[oó]sito\s*(?:recebido|compensado|creditado|realizado)/i,
  /\bentrada\b/i,
  /ted\s*recebid/i,
  /doc\s*recebid/i,
  /pix\s*recebid/i,
  /transfer[eê]ncia\s*recebid/i,
];

const EXPENSE_KEYWORDS = [
  /\bcompra\b/i,
  /\btransa[cç][aã]o\s*aprovada\b/i,
  /\bgasto\b/i,
  /\benviado\b/i,
  /\benviada\b/i,
  /\benviou\b/i,
  /\bpagou\b/i,
  /\bpagamento\b/i,
  /\bpago\b/i,
  /\btransferiu\b/i,
  /\bsaque\b/i,
  /\btarifa\b/i,
  /\banuidade\b/i,
  /\bassintatura\b|\bassinatura\b/i,
  /d[eé]bito\s*(?:em\s*conta|autom[aá]tico)/i,
  /\bboleto\b/i,
  /\bfatura\b/i,
  /cobran[cç]a/i,
  /pix\s*enviad/i,
  /transfer[eê]ncia\s*enviad/i,
];

const GENERIC_BANK_LABELS = new Set([
  'banco / cartão',
  'sms',
  'mensagens (sms)',
  'app manual',
]);

function stripNoiseBeforeParsing(text: string): string {
  return text
    .replace(/\b(?:cart[aã]o\s*)?(?:final|terminado\s*em)\s*[•*xX]*\d{4}\b/gi, ' ')
    .replace(/[•*xX]{2,}\s*\d{4}\b/g, ' ')
    .replace(/\(\d{2}\)\s*9?\d{4}[-.\s]?\d{4}\b/g, ' ')
    .replace(/\b(?:NSU|AUT|COD|DOC|PROTOCOLO)\s*[:#-]?\s*\d+\b/gi, ' ')
    .replace(/\b\d{2}[:h]\d{2}\b/gi, ' ')
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g, ' ');
}

export function extractBRLAmount(rawText: string): number | null {
  const sanitized = stripNoiseBeforeParsing(rawText);

  // 1. Explicit R$, RS, or BRL currency pattern (strongest signal, with or without space)
  const rDollarMatch = sanitized.match(
    /(?:R\$|RS|BRL)\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+(?:,\d{1,2})?|\d+(?:\.\d{2}))/i
  );
  if (rDollarMatch?.[1]) {
    const num = parseBrazilianNumber(rDollarMatch[1]);
    if (num !== null && num > 0) return num;
  }

  // 2. "valor de 123,45" or decimal with comma/dot
  const valorDeMatch = sanitized.match(
    /\bvalor\s*(?:aproximado\s*|previsto\s*|total\s*)?(?:de|:)?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{1,2}|\d+\.\d{2})\b/i
  );
  if (valorDeMatch?.[1]) {
    const num = parseBrazilianNumber(valorDeMatch[1]);
    if (num !== null && num > 0) return num;
  }

  // 3. Any clear Brazilian decimal like 1.250,00 or 45,90
  const decimalCommaMatch = sanitized.match(/\b(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\b/);
  if (decimalCommaMatch?.[1]) {
    const num = parseBrazilianNumber(decimalCommaMatch[1]);
    if (num !== null && num > 0) return num;
  }

  // 4. Dot decimal like 45.90
  const decimalDotMatch = sanitized.match(/\b(\d+\.\d{2})\b/);
  if (decimalDotMatch?.[1]) {
    const num = parseBrazilianNumber(decimalDotMatch[1]);
    if (num !== null && num > 0) return num;
  }

  return null;
}

function parseBrazilianNumber(raw: string): number | null {
  const cleaned = raw.trim();
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

export function detectBankNameFromText(text: string): string {
  for (const bank of KNOWN_BANKS) {
    if (bank.patterns.some((p) => p.test(text))) {
      return bank.label;
    }
  }
  return 'Banco / Cartão';
}

function inferPaymentMethod(
  text: string,
  sourceKind?: BankCaptureSourceKind
): Transaction['paymentMethod'] {
  if (/\bpix\b/i.test(text)) return 'pix';
  if (/\bcr[eé]dito\b/i.test(text)) return 'cartao_credito';
  if (/\bd[eé]bito\b/i.test(text)) return 'cartao_debito';
  if (/\bted\b|\bdoc\b|\btransfer[eê]ncia\b|\bboleto\b|\bfatura\b/i.test(text)) return 'transferencia';
  if (
    sourceKind === 'wallet' ||
    /\bcompra\b|\bcart[aã]o\b|\bvisa\b|\bmastercard\b|\belo\b|\bamex\b/i.test(text)
  ) {
    return 'cartao_credito';
  }
  return 'transferencia';
}

function inferCategory(text: string, type: TransactionType): FinanceCategory {
  if (type === 'receita') {
    if (/\bsal[aá]rio\b|\bholerite\b|\bfolha\b/i.test(text)) return 'salario';
    if (/\bdividendo\b|\brendimento\b|\btesouro\b|\bcdb\b|\bfii\b|\bjcp\b/i.test(text)) {
      return 'investimentos';
    }
    if (/\bfreelance\b|\bservi[cç]o\b/i.test(text)) return 'freelance';
    return 'outros';
  }

  if (
    /\b(?:ifood|rappi|z[eé]\s*delivery|supermercado|mercado|atacad[aã]o|padaria|restaurante|lanchonete|caf[eé](?![A-Za-zÀ-ÿ0-9_])|a[cç]ougue|hortifruti|mc\s?donald|burger\s?king|pizza|sushi|carrefour|assai|p[aã]o\s*de\s*a[cç][uú]car|extra)\b/i.test(
      text
    )
  ) {
    return 'alimentacao';
  }

  if (
    /\b(?:uber|99|99app|indrive|posto|combust[ií]vel|gasolina|etanol|ipiranga|shell|petrobras|estacionamento|ped[aá]gio|sem\s*parar|veloe|metr[oô](?![A-Za-zÀ-ÿ0-9_])|[oô]nibus|passagem)\b/i.test(
      text
    )
  ) {
    return 'transporte';
  }

  if (
    /\b(?:farm[aá]cia|drogaria|droga\s*raia|drogasil|pague\s*menos|panvel|hospital|cl[ií]nica|laborat[oó]rio|m[eé]dico|dentista|academia|smart\s*fit|bluefit)\b/i.test(
      text
    )
  ) {
    return 'saude';
  }

  if (
    /\b(?:aluguel|condom[ií]nio|energia|enel|cemig|copel|celesc|light|equatorial|[aá]gua|sabesp|sanepar|internet|vivo|claro|tim|oi|g[aá]s|iptu)\b/i.test(
      text
    )
  ) {
    return 'moradia';
  }

  if (/\b(?:faculdade|escola|curso|livraria|livro|udemy|alura|est[aá]cio|unip)\b/i.test(text)) {
    return 'educacao';
  }

  if (
    /\b(?:netflix|spotify|amazon\s*prime|disney|hbo|max|cinema|cinemark|ingresso|steam|playstation|xbox|nintendo|show|teatro|hotel|airbnb)\b/i.test(
      text
    )
  ) {
    return 'lazer';
  }

  return 'outros';
}

function cleanMerchantSegment(segment: string): string {
  return segment
    .replace(/\b(?:no|na)\s*valor\s*de.*$/i, '')
    .replace(/\b(?:com|no|pelo|via)\s*(?:seu\s*)?(?:cart[aã]o|visa|mastercard|elo|amex).*$/i, '')
    .replace(/\b(?:aprovad[oa]|realizad[oa]|efetuad[oa]|agendad[oa]|programad[oa])\b.*$/i, '')
    .replace(/\b(?:em|para|vence\s*em|vencimento)\s*\d{2}\/\d{2}.*$/i, '')
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b.*$/i, '')
    .replace(/\b(?:às|as)\s*\d{2}[:h]\d{2}.*$/i, '')
    .replace(/\b(?:R\$|RS|BRL)\s*[\d.,]+.*$/i, '')
    .replace(/\b(?:NSU|AUT|COD)\b.*$/i, '')
    .replace(/[.\-–—:;!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonDescriptiveTitleHint(hint: string, bankName: string): boolean {
  const lower = hint.toLowerCase();
  if (lower === bankName.toLowerCase()) return true;
  if (KNOWN_BANKS.some((b) => b.label.toLowerCase() === lower)) return true;
  return /^(?:compra\s*aprovada|transa[cç][aã]o\s*aprovada|notifica[cç][aã]o|alerta|aviso|pix\s*(?:recebido|enviado|agendado)|pagamento\s*(?:aprovado|agendado)|fatura\s*fechada|google\s*wallet|carteira\s*do\s*google|samsung\s*wallet|mensagem\s*de\s*texto|sms)$/i.test(
    lower
  );
}

function extractTitle(
  combined: string,
  titleHint: string | undefined,
  bankName: string,
  type: TransactionType,
  paymentMethod: Transaction['paymentMethod'],
  sourceKind?: BankCaptureSourceKind
): string {
  // Wallet notifications typically use the notification title as the merchant name (e.g. "Padaria Central" + "R$ 24,50 com Visa •••• 1234")
  if (sourceKind === 'wallet' && titleHint) {
    const trimmedHint = cleanMerchantSegment(titleHint);
    if (
      trimmedHint.length >= 2 &&
      trimmedHint.length <= 48 &&
      !/^\s*(?:R\$|RS|BRL)/i.test(trimmedHint) &&
      !isNonDescriptiveTitleHint(trimmedHint, bankName)
    ) {
      return trimmedHint;
    }
  }

  // Pattern: "... em <Estabelecimento>" (avoid "em conta", "em 2x", "em 12/05")
  const emMatch = combined.match(
    /\bem\s+(?!conta\b)(?!\d+[xX]\b)(?!\d{2}\/\d{2})([A-Za-zÀ-ÿ0-9*&'._/\- ]{2,45})/i
  );
  if (emMatch?.[1]) {
    const cleaned = cleanMerchantSegment(emMatch[1]);
    if (cleaned.length >= 2 && !/^(?:cart[aã]o|cr[eé]dito|d[eé]bito)$/i.test(cleaned)) {
      return cleaned;
    }
  }

  // Pattern: "para <Destinatário>" or "de <Remetente>" (ignoring "de R$", "de compra", "de pagamento")
  const partyMatch = combined.match(
    /\b(?:para|de)\s+(?!R\$)(?!RS\b)(?!BRL\b)(?!compra\b)(?!pagamento\b)(?!transfer[eê]ncia\b)(?!pix\b)(?!valor\b)(?!d[eé]bito\b)(?!cr[eé]dito\b)([A-Za-zÀ-ÿ0-9*&'._/\- ]{3,45})/i
  );
  if (partyMatch?.[1]) {
    const cleaned = cleanMerchantSegment(partyMatch[1]);
    if (cleaned.length >= 2 && !/^(?:amanh[aã]|hoje|dia\s*\d{1,2})$/i.test(cleaned)) {
      return `${type === 'receita' ? 'Recebido de' : 'Pagamento para'} ${cleaned}`;
    }
  }

  // Pattern: compact SMS "<Banco>: Compra aprovada R$ 62,40 MERCADO BOM DIA 23/11"
  const afterCurrencyMatch = combined.match(
    /(?:R\$|RS|BRL)\s*(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+(?:,\d{1,2})?|\d+\.\d{2})\s+(?:em\s+|no\s+|na\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9*&'._/\- ]{2,42})/i
  );
  if (afterCurrencyMatch?.[1]) {
    const candidate = cleanMerchantSegment(afterCurrencyMatch[1]);
    if (
      candidate.length >= 3 &&
      !/^(?:com\s+(?:visa|master|elo|amex|cart[aã]o)|no\s+cart[aã]o|via\s+pix|em\s+\d|vence|vencimento)/i.test(
        candidate
      )
    ) {
      return candidate;
    }
  }

  // Fallback to notification title if concise and not just the bank name or generic header
  if (titleHint) {
    const trimmedHint = cleanMerchantSegment(titleHint);
    if (
      trimmedHint.length >= 3 &&
      trimmedHint.length <= 48 &&
      !/^\s*(?:R\$|RS|BRL)/i.test(trimmedHint) &&
      !isNonDescriptiveTitleHint(trimmedHint, bankName)
    ) {
      return trimmedHint;
    }
  }

  const methodLabel =
    paymentMethod === 'pix'
      ? 'Pix'
      : paymentMethod === 'cartao_credito'
      ? 'Cartão de Crédito'
      : paymentMethod === 'cartao_debito'
      ? 'Cartão de Débito'
      : 'Transferência';

  return `${bankName} • ${methodLabel} (${type === 'receita' ? 'Entrada' : 'Saída'})`;
}

function extractDate(
  text: string,
  timestamp?: number,
  isScheduled?: boolean
): { date: string; scheduledLabel?: string } {
  const ref = new Date(timestamp || Date.now());

  if (isScheduled && /\bamanh[aã]\b/i.test(text)) {
    const tomorrow = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const ddmm = `${String(tomorrow.getDate()).padStart(2, '0')}/${String(
      tomorrow.getMonth() + 1
    ).padStart(2, '0')}`;
    return { date: iso, scheduledLabel: `Programado para ${ddmm}` };
  }

  const scheduledDateMatch = text.match(
    /(?:agendad[oa]\s*para|programad[oa]\s*para|vence\s*em|vencimento\s*(?:em|para|:)?|para)\s*(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/i
  );
  const genericDateMatch = text.match(/\b(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/);
  const chosenMatch = isScheduled && scheduledDateMatch ? scheduledDateMatch : genericDateMatch;

  if (chosenMatch) {
    const day = Number(chosenMatch[1]);
    const month = Number(chosenMatch[2]);
    let year = chosenMatch[3] ? Number(chosenMatch[3]) : ref.getFullYear();
    if (year < 100) year += 2000;
    if (!chosenMatch[3] && isScheduled && month < ref.getMonth() + 1) {
      year += 1;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const ddmm = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
      return {
        date: iso,
        scheduledLabel: isScheduled
          ? /fatura|venc/i.test(text)
            ? `Vence em ${ddmm}`
            : `Agendado para ${ddmm}`
          : undefined,
      };
    }
  }

  if (isScheduled) {
    const diaMatch = text.match(/\bdia\s+(\d{1,2})\b/i);
    if (diaMatch) {
      const targetDay = Math.max(1, Math.min(31, Number(diaMatch[1])));
      let targetMonth = ref.getMonth();
      let targetYear = ref.getFullYear();
      if (targetDay < ref.getDate()) {
        targetMonth += 1;
        if (targetMonth > 11) {
          targetMonth = 0;
          targetYear += 1;
        }
      }
      const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
      const clampedDay = Math.min(targetDay, maxDays);
      const iso = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(
        clampedDay
      ).padStart(2, '0')}`;
      const ddmm = `${String(clampedDay).padStart(2, '0')}/${String(targetMonth + 1).padStart(
        2,
        '0'
      )}`;
      return { date: iso, scheduledLabel: `Programado para ${ddmm}` };
    }
  }

  const iso = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(
    ref.getDate()
  ).padStart(2, '0')}`;
  return {
    date: iso,
    scheduledLabel: isScheduled ? 'Mensagem programada' : undefined,
  };
}

export function buildNotificationSignature(params: {
  bankName: string;
  type: TransactionType;
  amount: number;
  date: string;
  title: string;
}): string {
  const normBank = params.bankName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normTitle = params.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  return `${normBank}|${params.type}|${params.amount.toFixed(2)}|${params.date}|${normTitle}`;
}

export function parseBankNotificationText(
  params: ParseBankNotificationParams
): Omit<PendingBankNotification, 'id'> | null {
  const titlePart = (params.title || '').trim();
  const bodyPart = (params.rawText || '').trim();
  const combined = [titlePart, bodyPart].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  if (!combined) return null;

  const hasStrongVerb = STRONG_TRANSACTION_VERBS.some((p) => p.test(combined));
  const isAlwaysBlacklisted = ALWAYS_BLACKLIST.some((p) => p.test(combined));
  if (isAlwaysBlacklisted && !hasStrongVerb) {
    return null;
  }

  const isExecutedScheduled = EXECUTED_SCHEDULED_PATTERNS.some((p) => p.test(combined));
  const isScheduledCandidate =
    !isExecutedScheduled && SCHEDULED_PATTERNS.some((p) => p.test(combined));

  if (isScheduledCandidate && !params.includeScheduledMessages) {
    return null;
  }

  const amount = extractBRLAmount(combined);
  if (amount === null || amount <= 0) {
    return null;
  }

  const isWalletSignal =
    params.sourceKind === 'wallet' ||
    WALLET_OR_CARD_TAP_PATTERNS.some((p) => p.test(combined));

  const isIncome = INCOME_KEYWORDS.some((p) => p.test(combined));
  const isExpense =
    EXPENSE_KEYWORDS.some((p) => p.test(combined)) || isWalletSignal || isScheduledCandidate;

  if (!isIncome && !isExpense && !params.allowAmbiguous) {
    return null;
  }

  const resolvedSourceKind: BankCaptureSourceKind | undefined =
    params.sourceKind || (isWalletSignal ? 'wallet' : undefined);

  // Prioritize income when explicitly stated (e.g., "compra estornada" -> receita)
  const type: TransactionType = isIncome ? 'receita' : 'despesa';

  const detectedFromText = detectBankNameFromText(combined);
  const providedBank = params.bankName?.trim() || '';
  const bankName =
    providedBank &&
    (!GENERIC_BANK_LABELS.has(providedBank.toLowerCase()) ||
      detectedFromText === 'Banco / Cartão')
      ? providedBank
      : detectedFromText !== 'Banco / Cartão'
      ? detectedFromText
      : resolvedSourceKind === 'wallet'
      ? 'Google Wallet'
      : 'Banco / Cartão';

  const paymentMethod = inferPaymentMethod(combined, resolvedSourceKind);
  const category = inferCategory(combined, type);
  const title = extractTitle(
    combined,
    params.title,
    bankName,
    type,
    paymentMethod,
    resolvedSourceKind
  );
  const { date, scheduledLabel } = extractDate(combined, params.timestamp, isScheduledCandidate);
  const receivedAt = new Date(params.timestamp || Date.now()).toISOString();

  const signature = buildNotificationSignature({
    bankName,
    type,
    amount,
    date,
    title,
  });

  return {
    signature,
    bankName,
    rawText: combined,
    title,
    amount,
    type,
    category,
    paymentMethod,
    date,
    receivedAt,
    source: params.source || 'android',
    sourceKind: resolvedSourceKind,
    packageName: params.packageName,
    isScheduled: isScheduledCandidate || undefined,
    scheduledLabel,
  };
}
